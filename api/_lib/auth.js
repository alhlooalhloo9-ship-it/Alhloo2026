"use strict";

const admin = require("firebase-admin");

function getFirebaseAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
    error.statusCode = 503;
    throw error;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (_) {
    const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    error.statusCode = 503;
    throw error;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin;
}

async function requireFirebaseUser(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  const firebaseAdmin = getFirebaseAdmin();
  try {
    return await firebaseAdmin.auth().verifyIdToken(match[1]);
  } catch (_) {
    const error = new Error("Invalid or expired authentication token");
    error.statusCode = 401;
    throw error;
  }
}

module.exports = { requireFirebaseUser };
