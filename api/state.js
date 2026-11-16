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
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.includes(key))) return false;
  for (const [key, v] of Object.entries(value)) {
    if (["products", "shops", "savedInvoices", "salesLog"].includes(key)) {
      if (!Array.isArray(v) || v.length > (key === "products" ? 5000 : 10000)) return false;
    } else if (["cart", "settings", "ui", "cardShow"].includes(key)) {
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
      return res.status(200).json({
        ok: true, state: doc ? doc.state : null,
        revision: doc ? Number(doc.revision || 0) : 0,
        updatedAt: doc ? doc.updatedAt : null
      });
    }
    if (req.method === "PUT") {
      const state = req.body && req.body.state;
      const expectedRevision = Number(req.body && req.body.expectedRevision);
      if (!validState(state) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
          Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_STATE_BYTES) {
        return res.status(400).json({ ok: false, error: "Invalid state or revision" });
      }
      const now = new Date().toISOString();
      if (expectedRevision === 0) {
        try {
          await collection.insertOne({ userId: user.uid, state, revision: 1, createdAt: now, updatedAt: now });
          return res.status(200).json({ ok: true, revision: 1, updatedAt: now });
        } catch (error) {
          if (error.code !== 11000) throw error;
          return res.status(409).json({ ok: false, error: "State changed on another device" });
        }
      }
      const result = await collection.updateOne(
        { userId: user.uid, revision: expectedRevision },
        { $set: { state, revision: expectedRevision + 1, updatedAt: now } }
      );
      if (!result.matchedCount) {
        return res.status(409).json({ ok: false, error: "State changed on another device" });
      }
      return res.status(200).json({ ok: true, revision: expectedRevision + 1, updatedAt: now });
    }
    return methodNotAllowed(res, ["GET", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("User state API error:", error);
    return res.status(error.statusCode || 500).json({ ok: false, error: "User state service unavailable" });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: "5mb" } } };
