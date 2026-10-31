/**
 * AlhlooStorage V9
 * IndexedDB persistence engine for Alhloo2026 / بضاعة الندوة.
 *
 * Safety principles:
 * - Additive schema upgrades only; never delete object stores.
 * - Legacy localStorage is read but never removed or modified.
 * - User data is partitioned by Firebase UID (guest is a separate namespace).
 * - Existing product fields and cart object shape are preserved.
 * - All local writes are transactional; IndexedDB errors never erase localStorage.
 */
const DB_NAME = "Alhloo2026_Enterprise_DB";
const DB_VERSION = 1;

const STORE = Object.freeze({
  products: "products",
  carts: "carts",
  invoices: "invoices",
  syncQueue: "syncQueue",
  legacyData: "legacyData"
});

const validUserId = value => {
  const id = String(value || "guest").trim();
  if (!id || id.length > 256) throw new TypeError("Invalid userId");
  return id;
};

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
});

const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
});

function safeClone(value) {
  return value == null ? value : structuredClone(value);
}

class AlhlooStorageV9 {
  constructor() {
    this.db = null;
    this.opening = null;
    this.writeChains = new Map();
  }

  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!globalThis.indexedDB) throw new Error("IndexedDB غير مدعوم في هذا المتصفح.");

    this.opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = event => {
        const db = request.result;
        // Never delete or recreate existing stores. Only add missing stores/indexes.
        if (!db.objectStoreNames.contains(STORE.products)) {
          const s = db.createObjectStore(STORE.products, { keyPath: ["userId", "id"] });
          s.createIndex("byUser", "userId", { unique: false });
        } else {
          const s = request.transaction.objectStore(STORE.products);
          if (!s.indexNames.contains("byUser")) s.createIndex("byUser", "userId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE.carts)) {
          db.createObjectStore(STORE.carts, { keyPath: "userId" });
        }

        if (!db.objectStoreNames.contains(STORE.invoices)) {
          const s = db.createObjectStore(STORE.invoices, { keyPath: ["userId", "invoiceId"] });
          s.createIndex("byUser", "userId", { unique: false });
        } else {
          const s = request.transaction.objectStore(STORE.invoices);
          if (!s.indexNames.contains("byUser")) s.createIndex("byUser", "userId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE.syncQueue)) {
          const s = db.createObjectStore(STORE.syncQueue, { keyPath: ["userId", "syncId"] });
          s.createIndex("byUserStatus", ["userId", "status"], { unique: false });
        } else {
          const s = request.transaction.objectStore(STORE.syncQueue);
          if (!s.indexNames.contains("byUserStatus")) {
            s.createIndex("byUserStatus", ["userId", "status"], { unique: false });
          }
        }

        if (!db.objectStoreNames.contains(STORE.legacyData)) {
          db.createObjectStore(STORE.legacyData, { keyPath: ["userId", "key"] });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };
      request.onerror = () => reject(request.error || new Error("تعذر فتح قاعدة البيانات."));
      request.onblocked = () => reject(new Error("ترقية قاعدة البيانات محظورة؛ أغلق النسخ الأخرى من التطبيق ثم أعد المحاولة."));
    }).finally(() => {
      this.opening = null;
    });

    return this.opening;
  }

  async migrateLegacyWorkspace(userId, legacyProducts, legacyCart) {
    const uid = validUserId(userId);
    const db = await this.open();
    const tx = db.transaction([STORE.products, STORE.carts, STORE.legacyData], "readwrite");
    const productsStore = tx.objectStore(STORE.products);
    const cartsStore = tx.objectStore(STORE.carts);
    const markerStore = tx.objectStore(STORE.legacyData);
    const markerKey = [uid, "workspace-v1-migration"];

    try {
      const marker = await requestResult(markerStore.get(markerKey));
      if (marker?.completed) {
        await transactionDone(tx);
        return { migrated: false, reason: "already-migrated" };
      }

      const existingRows = await requestResult(productsStore.index("byUser").getAll(uid));
      const existingIds = new Set(existingRows.map(row => String(row.id)));
      const sourceProducts = Array.isArray(legacyProducts) ? legacyProducts : [];
      let imported = 0;

      for (const product of sourceProducts) {
        if (!product || product.id === undefined || product.id === null) continue;
        const id = product.id;
        if (existingIds.has(String(id))) continue;
        // Preserve every existing field, including the distinction between id and docId.
        productsStore.put({ ...safeClone(product), userId: uid, id });
        existingIds.add(String(id));
        imported++;
      }

      const currentCart = await requestResult(cartsStore.get(uid));
      if (!currentCart) {
        const cart = legacyCart && typeof legacyCart === "object" && !Array.isArray(legacyCart)
          ? safeClone(legacyCart) : {};
        cartsStore.put({ userId: uid, items: cart, updatedAt: Date.now() });
      }

      markerStore.put({
        userId: uid,
        key: "workspace-v1-migration",
        completed: true,
        completedAt: Date.now(),
        importedProducts: imported,
        source: "localStorage"
      });

      await transactionDone(tx);
      return { migrated: true, importedProducts: imported };
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      throw error;
    }
  }

  async getWorkspace(userId) {
    const uid = validUserId(userId);
    const db = await this.open();
    const tx = db.transaction([STORE.products, STORE.carts], "readonly");
    const productRequest = tx.objectStore(STORE.products).index("byUser").getAll(uid);
    const cartRequest = tx.objectStore(STORE.carts).get(uid);
    const [rows, cartRow] = await Promise.all([
      requestResult(productRequest),
      requestResult(cartRequest)
    ]);
    await transactionDone(tx);

    return {
      products: rows.map(({ userId: _uid, ...product }) => product),
      cart: cartRow?.items && typeof cartRow.items === "object" && !Array.isArray(cartRow.items)
        ? cartRow.items : {}
    };
  }

  async saveWorkspace(userId, products, cart) {
    const uid = validUserId(userId);
    if (!Array.isArray(products)) throw new TypeError("products must be an array");
    if (!cart || typeof cart !== "object" || Array.isArray(cart)) {
      throw new TypeError("cart must be an object keyed by productId");
    }

    const db = await this.open();
    const tx = db.transaction([STORE.products, STORE.carts, STORE.syncQueue], "readwrite");
    const productStore = tx.objectStore(STORE.products);
    const queueStore = tx.objectStore(STORE.syncQueue);
    const existingRows = await requestResult(productStore.index("byUser").getAll(uid));
    const nextIds = new Set(products.filter(p => p && p.id != null).map(p => String(p.id)));
    const now = Date.now();

    for (const old of existingRows) {
      if (!nextIds.has(String(old.id))) {
        productStore.delete([uid, old.id]);
        const syncId = "product-delete:" + String(old.id);
        queueStore.put({
          userId: uid, syncId, entity: "product", entityId: String(old.id),
          operation: "delete", status: "pending", attempts: 0,
          createdAt: now, updatedAt: now
        });
      }
    }

    for (const product of products) {
      if (!product || product.id == null) continue;
      const clean = { ...safeClone(product), userId: uid };
      productStore.put(clean);
      const syncId = "product-upsert:" + String(product.id);
      const prior = await requestResult(queueStore.get([uid, syncId]));
      queueStore.put({
        userId: uid, syncId, entity: "product", entityId: String(product.id),
        operation: "upsert",
        status: prior?.status === "syncing" ? "pending" : (prior?.status || "pending"),
        attempts: prior?.attempts || 0,
        createdAt: prior?.createdAt || now, updatedAt: now
      });
    }

    tx.objectStore(STORE.carts).put({
      userId: uid, items: safeClone(cart), updatedAt: now
    });

    await transactionDone(tx);
    return { savedProducts: products.length };
  }

  async enqueue(userId, item) {
    const uid = validUserId(userId);
    if (!item || !item.syncId) throw new TypeError("syncId is required");
    const db = await this.open();
    const tx = db.transaction(STORE.syncQueue, "readwrite");
    const store = tx.objectStore(STORE.syncQueue);
    const key = [uid, String(item.syncId)];
    const previous = await requestResult(store.get(key));
    store.put({
      ...previous,
      ...safeClone(item),
      userId: uid,
      syncId: String(item.syncId),
      status: item.status || previous?.status || "pending",
      attempts: previous?.attempts || 0,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now()
    });
    await transactionDone(tx);
  }

  async getPendingSyncItems(userId, limit = 50) {
    const uid = validUserId(userId);
    const db = await this.open();
    const tx = db.transaction(STORE.syncQueue, "readonly");
    const rows = await requestResult(tx.objectStore(STORE.syncQueue).index("byUserStatus").getAll(
      IDBKeyRange.bound([uid, "pending"], [uid, "pending"])
    ));
    await transactionDone(tx);
    return rows.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  async updateSyncStatus(userId, syncId, status, extra = {}) {
    const allowed = new Set(["pending", "syncing", "synced", "failed", "conflict"]);
    if (!allowed.has(status)) throw new TypeError("Invalid sync status");
    const uid = validUserId(userId);
    const db = await this.open();
    const tx = db.transaction(STORE.syncQueue, "readwrite");
    const store = tx.objectStore(STORE.syncQueue);
    const key = [uid, String(syncId)];
    const row = await requestResult(store.get(key));
    if (row) {
      row.status = status;
      row.updatedAt = Date.now();
      if (status === "syncing") row.attempts = (row.attempts || 0) + 1;
      if (extra && typeof extra === "object") {
        if ("error" in extra) row.error = String(extra.error || "");
        if ("nextRetryAt" in extra) row.nextRetryAt = Number(extra.nextRetryAt) || 0;
        if ("remoteId" in extra) row.remoteId = String(extra.remoteId || "");
      }
      store.put(row);
    }
    await transactionDone(tx);
    return !!row;
  }

  async completeSale(userId, cart, invoiceId = (globalThis.crypto?.randomUUID?.() || ("sale-" + Date.now()))) {
    const uid = validUserId(userId);
    if (!cart || typeof cart !== "object" || Array.isArray(cart)) throw new TypeError("cart must be an object");
    const db = await this.open();
    const tx = db.transaction([STORE.products, STORE.carts, STORE.invoices, STORE.syncQueue], "readwrite");
    const productsStore = tx.objectStore(STORE.products);
    const invoiceStore = tx.objectStore(STORE.invoices);
    const queueStore = tx.objectStore(STORE.syncQueue);
    const invoiceKey = [uid, String(invoiceId)];

    try {
      const priorInvoice = await requestResult(invoiceStore.get(invoiceKey));
      if (priorInvoice) {
        await transactionDone(tx);
        return { alreadyCompleted: true, invoice: priorInvoice };
      }

      const invoiceItems = [];
      let totalTry = 0;

      for (const [productId, rawQty] of Object.entries(cart)) {
        const quantity = Number(rawQty);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
        const row = await requestResult(productsStore.get([uid, productId]));
        if (!row) throw new Error("المنتج غير موجود: " + productId);
        const stock = Math.max(0, Number(row.stock) || 0);
        if (stock < quantity) throw new Error("المخزون غير كافٍ للمنتج: " + (row.name || productId));

        row.stock = stock - quantity;
        productsStore.put(row);
        const unitPrice = Math.max(0, Number(row.sellTry) || 0);
        totalTry += unitPrice * quantity;
        invoiceItems.push({
          productId: row.id, docId: row.docId || null, name: row.name || "",
          quantity, sellTry: unitPrice, pieces: Math.max(1, Number(row.pieces) || 1),
          lineTotalTry: unitPrice * quantity
        });
      }

      if (!invoiceItems.length) throw new Error("الفاتورة فارغة؛ لم يتم تنفيذ البيع.");

      const invoice = {
        userId: uid, invoiceId: String(invoiceId), items: invoiceItems,
        totalTry, createdAt: Date.now(), status: "completed"
      };
      invoiceStore.add(invoice);
      tx.objectStore(STORE.carts).put({ userId: uid, items: {}, updatedAt: Date.now() });
      const syncId = "invoice:" + String(invoiceId);
      queueStore.put({
        userId: uid, syncId, entity: "invoice", entityId: String(invoiceId),
        operation: "create", status: "pending", attempts: 0,
        createdAt: Date.now(), updatedAt: Date.now()
      });

      await transactionDone(tx);
      return { alreadyCompleted: false, invoice };
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      throw error;
    }
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }
}

export const dbManager = new AlhlooStorageV9();
export { AlhlooStorageV9, DB_NAME, DB_VERSION, STORE };
