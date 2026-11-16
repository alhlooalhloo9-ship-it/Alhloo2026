"use strict";

const { getDatabase } = require("../server/mongodb");
const { authenticate, methodNotAllowed } = require("../server/http");

const MAX_STATE_BYTES = 4 * 1024 * 1024;
const ALLOWED_KEYS = [
  "products", "cart", "shops", "savedInvoices", "salesLog",
  "settings", "ui", "cardShow", "sortMode"
];

function validState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_KEYS.includes(key))) return false;
  for (const key of keys) {
    const v = value[key];
    if (key === "products" || key === "shops" || key === "savedInvoices" || key === "salesLog") {
      if (!Array.isArray(v)) return false;
      if (v.length > (key === "products" ? 5000 : 10000)) return false;
    } else if (key === "cart" || key === "settings" || key === "ui" || key === "cardShow") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    } else if (key === "sortMode" && typeof v !== "string") return false;
  }
  return true;
}

module.exports = async function stateHandler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  try {
    const collection = (await getDatabase()).collection("user_app_state");
    const filter = { userId: user.uid };
    if (req.method === "GET") {
      const doc = await collection.findOne(filter, { projection: { _id: 0, userId: 0 } });
      return res.status(200).json({ ok: true, state: doc ? doc.state : null, updatedAt: doc ? doc.updatedAt : null });
    }
    if (req.method === "PUT") {
      const state = req.body && req.body.state;
      if (!validState(state) || Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_STATE_BYTES) {
        return res.status(400).json({ ok: false, error: "Invalid or oversized application state" });
      }
      const now = new Date().toISOString();
      await collection.updateOne(filter, {
        $set: { userId: user.uid, state, updatedAt: now },
        $setOnInsert: { createdAt: now }
      }, { upsert: true });
      return res.status(200).json({ ok: true, updatedAt: now });
    }
    return methodNotAllowed(res, ["GET", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("User state API error:", error);
    return res.status(error.statusCode || 500).json({ ok: false, error: "User state service unavailable" });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: "5mb" } } };
