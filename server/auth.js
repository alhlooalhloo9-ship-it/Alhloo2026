"use strict";

const admin = require("firebase-admin");
const { parseServiceAccount } = require("./firebase");

function getFirebaseAdmin() {
  let serviceAccount;
  try {
    serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (error) {
    error.statusCode = 503;
    throw error;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
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
