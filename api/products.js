"use strict";

const { getDatabase } = require("../server/mongodb");
const { authenticate, methodNotAllowed } = require("../server/http");

module.exports = async function productsHandler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const db = await getDatabase();
    const products = db.collection("products");
    const tombstones = db.collection("product_tombstones");
    const userId = user.uid;

    if (req.method === "GET") {
      const skipValue = Number.parseInt(req.query && req.query.skip, 10);
      const limitValue = Number.parseInt(req.query && req.query.limit, 10);
      const skip = Number.isFinite(skipValue) ? Math.max(0, Math.min(100000, skipValue)) : 0;
      const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(5000, limitValue)) : 500;
      const [rows, deletedRows] = await Promise.all([
        products.find({userId}).sort({id:1}).skip(skip).limit(limit).toArray(),
        tombstones.find({userId}).project({_id:0,id:1}).toArray()
      ]);
      return res.status(200).json({ok:true,products:rows.map(({_id,...product})=>product),deletedIds:deletedRows.map(row=>String(row.id))});
    }

    if (req.method === "DELETE") {
      const ids=req.body&&req.body.ids;if(!Array.isArray(ids)||ids.length>5000||ids.some(id=>id==null||String(id).length>200))return res.status(400).json({ok:false,error:"Invalid product deletion payload"});
      const clean=[...new Set(ids.map(String))];if(clean.length){const now=new Date().toISOString();await tombstones.bulkWrite(clean.map(id=>({updateOne:{filter:{userId,id},update:{$set:{userId,id,deletedAt:now}},upsert:true}})),{ordered:false});await products.deleteMany({userId,id:{$in:clean}});}return res.status(200).json({ok:true,deleted:clean.length});
    }

    if (req.method === "POST") {
      const list = req.body && req.body.products;
      if (!Array.isArray(list) || list.length > 5000) {
        return res.status(400).json({ ok: false, error: "Invalid products payload" });
      }

      const now = new Date().toISOString();
      const candidates=list.filter(product=>product&&product.id!==undefined&&product.id!==null);const candidateIds=[...new Set(candidates.map(product=>String(product.id)))];
      const deletedRows=candidateIds.length?await tombstones.find({userId,id:{$in:candidateIds}}).project({_id:0,id:1}).toArray():[];const deletedSet=new Set(deletedRows.map(row=>String(row.id)));
      const operations = candidates.filter(product=>!deletedSet.has(String(product.id))).map((product) => ({
          updateOne: {
            filter: { userId, id: String(product.id) },
            update: {
              $set: {
                ...product,
                id: String(product.id),
                userId,
                updatedAt: now
              },
              $setOnInsert: { createdAt: now }
            },
            upsert: true
          }
        }));

      if (operations.length) {
        await products.bulkWrite(operations, { ordered: false });
      }

      return res.status(200).json({ ok: true, saved: operations.length });
    }

    return methodNotAllowed(res, ["GET", "POST", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("Products API error:", error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: "Products service unavailable"
    });
  }
};
