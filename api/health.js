"use strict";

const { getDatabase } = require("../server/mongodb");

function hasDatabaseName(uri) {
  try {
    const parsed = new URL(uri);
    return Boolean(parsed.pathname && parsed.pathname !== "/");
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // The verifier currently uses a configured Firebase Identity Toolkit API key
  // in server/auth.js. This check reports configuration only, not live auth.
  const identityToolkitConfigured = true;
  const mongoUri = String(process.env.MONGODB_URI || "").trim();
  const validMongoUri = /^mongodb(?:\+srv)?:\/\//i.test(mongoUri);
  const mongoConfigured = validMongoUri && (
    Boolean(String(process.env.MONGODB_DATABASE || "").trim()) ||
    hasDatabaseName(mongoUri)
  );

  let mongoReachable = null;
  if (mongoConfigured) {
    try {
      const db = await getDatabase();
      await db.command({ ping: 1 });
      mongoReachable = true;
    } catch (error) {
      mongoReachable = false;
      // Keep credentials, hostnames, and infrastructure details out of
      // the public health response; retain the full error only in server logs.
      console.error("Health check MongoDB error:", error);
    }
  }

  const ready = identityToolkitConfigured && mongoConfigured && mongoReachable === true;
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "alhloo2026-api",
    storage: "mongodb",
    authentication: "firebase-identity-toolkit",
    checks: { identityToolkitConfigured, mongoConfigured, mongoReachable }
  });
};
