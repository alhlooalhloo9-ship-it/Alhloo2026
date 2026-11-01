"use strict";

const { getDatabase } = require("../server/mongodb");
const admin = require("firebase-admin");
const { parseServiceAccount } = require("../server/firebase");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let firebaseConfigured = false;
  let firebaseError = null;
  try {
    parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    firebaseConfigured = true;
  } catch (error) {
    firebaseError = error.message;
  }

  const firebaseAdminInitialized = admin.apps.length > 0;
  const mongoConfigured = Boolean(process.env.MONGODB_URI && process.env.MONGODB_DATABASE);
  let mongoReachable = null;
  if (mongoConfigured) {
    try {
      const db = await getDatabase();
      await db.command({ ping: 1 });
      mongoReachable = true;
    } catch (error) {
      mongoReachable = false;
      console.error("Health check MongoDB error:", error);
    }
  }

  const ready = firebaseConfigured && mongoConfigured && mongoReachable === true;
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "alhloo2026-api",
    checks: {
      firebaseAdminConfigured: firebaseConfigured,
      firebaseAdminInitialized,
      firebaseError,
      mongoConfigured,
      mongoReachable
    }
  });
};
