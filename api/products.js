"use strict";

const { getDatabase } = require("../server/mongodb");
const { authenticate, methodNotAllowed } = require("../server/http");

module.exports = async function productsHandler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const db = await getDatabase();
    const products = db.collection("products");
    const userId = user.uid;

    if (req.method === "GET") {
      const skipValue = Number.parseInt(req.query && req.query.skip, 10);
      const limitValue = Number.parseInt(req.query && req.query.limit, 10);
      const skip = Number.isFinite(skipValue) ? Math.max(0, Math.min(100000, skipValue)) : 0;
      const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(500, limitValue)) : 500;
      const rows = await products
        .find({ userId })
        .sort({ id: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return res.status(200).json({
        ok: true,
        products: rows.map(({ _id, ...product }) => product)
      });
    }

    if (req.method === "POST") {
      const list = req.body && req.body.products;
      if (!Array.isArray(list) || list.length > 5000) {
        return res.status(400).json({ ok: false, error: "Invalid products payload" });
      }

      const now = new Date().toISOString();
      const operations = list
        .filter((product) => product && product.id !== undefined && product.id !== null)
        .map((product) => ({
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

    return methodNotAllowed(res, ["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("Products API error:", error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: "Products service unavailable"
    });
  }
};
