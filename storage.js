/**
 * AlhlooStorage - hardened local persistence layer (isolated test branch).
 * Additive DB upgrade only. Never infers deletion from a missing product.
 * Does not connect to Firebase; cloud transport is deliberately a separate layer.
 */
const DB_NAME = "Alhloo2026_Enterprise_DB";
const DB_VERSION = 10;
const STORE = Object.freeze({products:"products",carts:"carts",invoices:"invoices",syncQueue:"syncQueue",legacyData:"legacyData"});

function requireUserId(value) {
  const id = String(value ?? "").trim();
  if (!id || id === "guest" || id.length > 256) throw new TypeError("A valid authenticated userId is required");
  return id;
}
function normalizeProductId(value) {
  if (value === null || value === undefined || String(value).trim() === "") throw new TypeError("Invalid product id");
  return String(value);
}
function clone(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function req(request) {
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error || new Error("IndexedDB request failed"));
  });
}
function done(tx) {
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror=()=>reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}
function numericIdForUI(id) {
  const n=Number(id);
  return Number.isSafeInteger(n) && String(n)===String(id) ? n : id;
}

class AlhlooStorageV9 {
  constructor(){ this.db=null; this.opening=null; }
  async open(){
    if(this.db) return this.db;
    if(this.opening) return this.opening;
    if(!globalThis.indexedDB) throw new Error("IndexedDB غير مدعوم بهذا المتصفح");
    this.opening=new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,DB_VERSION);
      r.onupgradeneeded=()=>{
        const db=r.result, tx=r.transaction;
        if(!db.objectStoreNames.contains(STORE.products)){
          const s=db.createObjectStore(STORE.products,{keyPath:["userId","id"]});
          s.createIndex("byUser","userId",{unique:false});
        } else {
          const s=tx.objectStore(STORE.products);
          if(!s.indexNames.contains("byUser")) s.createIndex("byUser","userId",{unique:false});
        }
        if(!db.objectStoreNames.contains(STORE.carts)) db.createObjectStore(STORE.carts,{keyPath:"userId"});
        if(!db.objectStoreNames.contains(STORE.invoices)){
          const s=db.createObjectStore(STORE.invoices,{keyPath:["userId","invoiceId"]});
          s.createIndex("byUser","userId",{unique:false});
        } else {
          const s=tx.objectStore(STORE.invoices);
          if(!s.indexNames.contains("byUser")) s.createIndex("byUser","userId",{unique:false});
        }
        if(!db.objectStoreNames.contains(STORE.syncQueue)){
          const s=db.createObjectStore(STORE.syncQueue,{keyPath:["userId","syncId"]});
          s.createIndex("byUserStatus",["userId","status"],{unique:false});
        } else {
          const s=tx.objectStore(STORE.syncQueue);
          if(!s.indexNames.contains("byUserStatus")) s.createIndex("byUserStatus",["userId","status"],{unique:false});
        }
        if(!db.objectStoreNames.contains(STORE.legacyData)) db.createObjectStore(STORE.legacyData,{keyPath:["userId","key"]});
      };
      r.onsuccess=()=>{this.db=r.result;this.db.onversionchange=()=>{this.db.close();this.db=null;};resolve(this.db);};
      r.onerror=()=>reject(r.error || new Error("تعذر فتح قاعدة البيانات"));
      r.onblocked=()=>reject(new Error("ترقية قاعدة البيانات محظورة؛ أغلق النسخ الأخرى من التطبيق"));
    }).finally(()=>{this.opening=null;});
    return this.opening;
  }

  async getWorkspace(userId){
    const uid=requireUserId(userId), db=await this.open();
    const tx=db.transaction([STORE.products,STORE.carts],"readonly"), finished=done(tx);
    const p=req(tx.objectStore(STORE.products).index("byUser").getAll(uid));
    const c=req(tx.objectStore(STORE.carts).get(uid));
    const [rows,cart]=await Promise.all([p,c]); await finished;
    return {products:rows.map(({userId:_u,id,...rest})=>({...rest,id:numericIdForUI(id)})),
      cart:cart?.items && typeof cart.items==="object" && !Array.isArray(cart.items)?cart.items:{}};
  }

  async saveWorkspace(userId, products, cart){
    const uid=requireUserId(userId);
    if(!Array.isArray(products)) throw new TypeError("products must be an array");
    if(!cart || typeof cart!=="object" || Array.isArray(cart)) throw new TypeError("cart must be an object");
    const ids=new Set();
    const normalized=products.map(p=>{
      if(!p || p.id==null) throw new TypeError("Every product must have an id");
      const id=normalizeProductId(p.id);
      if(ids.has(id)) throw new Error("Duplicate product id: "+id);
      ids.add(id);
      const stock=Number(p.stock);
      if(!Number.isFinite(stock)||stock<0) throw new TypeError("Invalid stock for product "+id);
      return {...clone(p),id,userId:uid};
    });
    for(const [id,q] of Object.entries(cart)){
      if(!ids.has(normalizeProductId(id))) throw new Error("Cart references missing product "+id);
      if(!Number.isSafeInteger(Number(q))||Number(q)<0) throw new TypeError("Invalid cart quantity for "+id);
    }
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE.products,STORE.carts,STORE.syncQueue],"readwrite");
      const ps=tx.objectStore(STORE.products), qs=tx.objectStore(STORE.syncQueue);
      const finished=done(tx);
      let count=0;
      const fail=e=>{try{tx.abort();}catch(_){} reject(e);};
      const all=ps.index("byUser").getAll(uid);
      all.onerror=()=>fail(all.error);
      all.onsuccess=()=>{
        try{
          const old=new Map(all.result.map(p=>[String(p.id),p]));
          for(const p of normalized){
            const prior=old.get(p.id);
            ps.put(p);
            // Only queue an upsert when the persisted product actually changed.
            const comparable=x=>{const y={...x};delete y.userId;return JSON.stringify(y);};
            if(!prior || comparable(prior)!==comparable(p)){
              const syncId="product-upsert:"+p.id;
              const qget=qs.get([uid,syncId]);
              qget.onsuccess=()=>{
                const prev=qget.result;
                qs.put({userId:uid,syncId,entity:"product",entityId:p.id,operation:"upsert",
                  status:"pending",attempts:prev?.attempts||0,createdAt:prev?.createdAt||Date.now(),updatedAt:Date.now()});
              };
              qget.onerror=()=>fail(qget.error);
            }
            count++;
          }
          // Deliberately do not delete records absent from this snapshot.
          tx.objectStore(STORE.carts).put({userId:uid,items:clone(cart),updatedAt:Date.now()});
        }catch(e){fail(e);}
      };
      finished.then(()=>resolve({savedProducts:count,deletedProducts:0})).catch(reject);
    });
  }

  async migrateLegacyWorkspace(userId,legacyProducts,legacyCart){
    const uid=requireUserId(userId);
    if(!Array.isArray(legacyProducts)) throw new TypeError("Legacy products must be a verified array");
    if(!legacyCart || typeof legacyCart!=="object" || Array.isArray(legacyCart)) throw new TypeError("Legacy cart must be a verified object");
    const seen=new Set();
    for(const p of legacyProducts){
      if(!p || p.id==null) throw new Error("Legacy migration stopped: product without id");
      const id=normalizeProductId(p.id);
      if(seen.has(id)) throw new Error("Legacy migration stopped: duplicate product id "+id);
      seen.add(id);
      if(!Number.isFinite(Number(p.stock))||Number(p.stock)<0) throw new Error("Legacy migration stopped: invalid stock for "+id);
    }
    for(const [id,q] of Object.entries(legacyCart)){
      if(!seen.has(normalizeProductId(id))) throw new Error("Legacy migration stopped: cart item has no product "+id);
      if(!Number.isSafeInteger(Number(q))||Number(q)<0) throw new Error("Legacy migration stopped: invalid cart quantity "+id);
    }
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE.products,STORE.carts,STORE.legacyData,STORE.syncQueue],"readwrite");
      const ps=tx.objectStore(STORE.products), cs=tx.objectStore(STORE.carts), ms=tx.objectStore(STORE.legacyData), qs=tx.objectStore(STORE.syncQueue);
      const finished=done(tx), key=[uid,"workspace-v1-migration"];
      let imported=0, skipped=false;
      const fail=e=>{try{tx.abort();}catch(_){} reject(e);};
      const marker=ms.get(key);
      marker.onerror=()=>fail(marker.error);
      marker.onsuccess=()=>{
        if(marker.result?.completed){skipped=true;return;}
        const all=ps.index("byUser").getAll(uid);
        all.onerror=()=>fail(all.error);
        all.onsuccess=()=>{
          try{
            const have=new Set(all.result.map(p=>String(p.id)));
            for(const raw of legacyProducts){
              const id=normalizeProductId(raw.id);
              if(have.has(id)) continue;
              const p={...clone(raw),id,userId:uid}; ps.put(p); imported++; have.add(id);
              const syncId="product-upsert:"+id;
              qs.put({userId:uid,syncId,entity:"product",entityId:id,operation:"upsert",status:"pending",attempts:0,createdAt:Date.now(),updatedAt:Date.now()});
            }
            const cartReq=cs.get(uid);
            cartReq.onerror=()=>fail(cartReq.error);
            cartReq.onsuccess=()=>{
              if(!cartReq.result) cs.put({userId:uid,items:clone(legacyCart),updatedAt:Date.now()});
              ms.put({userId:uid,key:"workspace-v1-migration",completed:true,completedAt:Date.now(),sourceCount:legacyProducts.length,importedProducts:imported});
            };
          }catch(e){fail(e);}
        };
      };
      finished.then(()=>resolve({migrated:!skipped,importedProducts:imported,reason:skipped?"already-migrated":undefined})).catch(reject);
    });
  }

  async enqueue(userId,item){
    const uid=requireUserId(userId);
    if(!item?.syncId) throw new TypeError("syncId is required");
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE.syncQueue,"readwrite"), store=tx.objectStore(STORE.syncQueue), key=[uid,String(item.syncId)], finished=done(tx);
      const r=store.get(key);
      r.onsuccess=()=>{const old=r.result;store.put({...old,...clone(item),userId:uid,syncId:String(item.syncId),status:item.status||old?.status||"pending",attempts:old?.attempts||0,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()});};
      r.onerror=()=>{try{tx.abort();}catch(_){} reject(r.error);};
      finished.then(resolve).catch(reject);
    });
  }

  async getPendingSyncItems(userId,limit=50){
    const uid=requireUserId(userId), db=await this.open(), tx=db.transaction(STORE.syncQueue,"readonly"), finished=done(tx);
    const rows=await req(tx.objectStore(STORE.syncQueue).index("byUserStatus").getAll(IDBKeyRange.only([uid,"pending"])));
    await finished; return rows.slice(0,Math.max(1,Math.min(200,Number(limit)||50)));
  }

  async updateSyncStatus(userId,syncId,status,extra={}){
    if(!["pending","syncing","synced","failed","conflict"].includes(status)) throw new TypeError("Invalid sync status");
    const uid=requireUserId(userId),db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE.syncQueue,"readwrite"),s=tx.objectStore(STORE.syncQueue),r=s.get([uid,String(syncId)]),finished=done(tx); let found=false;
      r.onsuccess=()=>{if(r.result){found=true;const row=r.result;row.status=status;row.updatedAt=Date.now();if(status==="syncing")row.attempts=(row.attempts||0)+1;
        if("error" in extra)row.error=String(extra.error||"");if("nextRetryAt" in extra)row.nextRetryAt=Number(extra.nextRetryAt)||0;s.put(row);}};
      r.onerror=()=>{try{tx.abort();}catch(_){}reject(r.error);};
      finished.then(()=>resolve(found)).catch(reject);
    });
  }

  async completeSale(userId,cart,invoiceId){
    const uid=requireUserId(userId);
    if(!cart||typeof cart!=="object"||Array.isArray(cart)||!Object.keys(cart).length) throw new TypeError("A non-empty cart is required");
    const id=String(invoiceId||globalThis.crypto?.randomUUID?.()||("sale-"+Date.now()));
    const entries=Object.entries(cart).map(([k,v])=>[normalizeProductId(k),Number(v)]);
    if(entries.some(([,q])=>!Number.isSafeInteger(q)||q<=0)) throw new TypeError("Invalid sale quantity");
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE.products,STORE.carts,STORE.invoices,STORE.syncQueue],"readwrite");
      const ps=tx.objectStore(STORE.products), is=tx.objectStore(STORE.invoices), cs=tx.objectStore(STORE.carts), qs=tx.objectStore(STORE.syncQueue);
      const finished=done(tx), invKey=[uid,id]; let result;
      const fail=e=>{try{tx.abort();}catch(_){}reject(e);};
      const old=is.get(invKey);
      old.onerror=()=>fail(old.error);
      old.onsuccess=()=>{
        if(old.result){result={alreadyCompleted:true,invoice:old.result};return;}
        const itemRows=[], readRequests=entries.map(([pid])=>ps.get([uid,pid]));
        let completed=0, failed=false;
        readRequests.forEach((r,index)=>{
          r.onerror=()=>{if(!failed){failed=true;fail(r.error);}};
          r.onsuccess=()=>{
            if(failed)return;
            const [pid,quantity]=entries[index],p=r.result;
            if(!p){failed=true;fail(new Error("المنتج غير موجود: "+pid));return;}
            const stock=Number(p.stock);
            if(!Number.isSafeInteger(stock)||stock<quantity){failed=true;fail(new Error("المخزون غير كافٍ للمنتج: "+(p.name||pid)));return;}
            itemRows[index]={product:p,quantity};
            completed++;
            if(completed!==entries.length)return;
            try{
              let totalTry=0;
              const items=itemRows.map(({product,quantity:q})=>{
                const unit=Number(product.sellTry)||0; totalTry+=unit*q;
                product.stock=Number(product.stock)-q; ps.put(product);
                return {productId:product.id,docId:product.docId||null,name:product.name||"",quantity:q,sellTry:unit,pieces:Math.max(1,Number(product.pieces)||1),lineTotalTry:unit*q};
              });
              const invoice={userId:uid,invoiceId:id,items,totalTry,createdAt:Date.now(),status:"completed"};
              is.add(invoice);cs.put({userId:uid,items:{},updatedAt:Date.now()});
              qs.put({userId:uid,syncId:"invoice:"+id,entity:"invoice",entityId:id,operation:"create",status:"pending",attempts:0,createdAt:Date.now(),updatedAt:Date.now()});
              for(const item of items) qs.put({userId:uid,syncId:"product-upsert:"+String(item.productId),entity:"product",entityId:String(item.productId),operation:"upsert",status:"pending",attempts:0,createdAt:Date.now(),updatedAt:Date.now()});
              result={alreadyCompleted:false,invoice};
            }catch(e){fail(e);}
          };
        });
      };
      finished.then(()=>resolve(result)).catch(reject);
    });
  }

  close(){if(this.db)this.db.close();this.db=null;}
}
export const dbManager=new AlhlooStorageV9();
export {AlhlooStorageV9,DB_NAME,DB_VERSION,STORE};
