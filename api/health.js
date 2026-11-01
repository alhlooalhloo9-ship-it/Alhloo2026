"use strict";

const { getMongoClient } = require("./_lib/mongodb");
const { getFirebaseAdmin } = (() => {
  // Keep health checks independent from exposing credentials or account details.
  return { getFirebaseAdmin: () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return false;
    try {
      const value = JSON.parse(raw);
      return Boolean(value.project_id && value.client_email && value.private_key);
    } catch (_) {
      return false;
    }
  }};
})();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const firebaseConfigured = Boolean(getFirebaseAdmin());
  const mongoConfigured = Boolean(process.env.MONGODB_URI);
  let mongoReachable = null;

  if (mongoConfigured) {
    try {
      const client = await getMongoClient();
      await client.db().command({ ping: 1 });
      mongoReachable = true;
    } catch (_) {
      mongoReachable = false;
    }
  }

  const ready = firebaseConfigured && mongoConfigured && mongoReachable === true;
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "alhloo2026-api",
    checks: {
      firebaseAdminConfigured: firebaseConfigured,
      mongoConfigured,
      mongoReachable
    }
  });
};
