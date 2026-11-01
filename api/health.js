"use strict";
const { getDatabase } = require("../server/mongodb");
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }
  const identityToolkitConfigured = true;
  const mongoUri = String(process.env.MONGODB_URI || "").trim();
  const mongoConfigured = /^mongodb(?:\+srv)?:\/\//i.test(mongoUri) && Boolean(String(process.env.MONGODB_DATABASE || "").trim());
  let mongoReachable = null, mongoError = null;
  if (mongoConfigured) {
    try { const db = await getDatabase(); await db.command({ ping: 1 }); mongoReachable = true; }
    catch (error) { mongoReachable = false; mongoError = error.message; console.error("Health check MongoDB error:", error); }
  }
  const ready = identityToolkitConfigured && mongoConfigured && mongoReachable === true;
  return res.status(ready ? 200 : 503).json({
    ok: ready, service: "alhloo2026-api", storage: "mongodb", authentication: "firebase-identity-toolkit",
    checks: { identityToolkitConfigured, mongoConfigured, mongoReachable, mongoError }
  });
};
