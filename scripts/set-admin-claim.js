/**
 * One-time, trusted-environment utility for granting/revoking the admin claim.
 * Never run this in browser code or commit service-account credentials.
 *
 * Usage:
 *   ADMIN_UID="Firebase-Auth-UID" node scripts/set-admin-claim.js grant
 *   ADMIN_UID="Firebase-Auth-UID" node scripts/set-admin-claim.js revoke
 */
const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "alhlooapp";
const uid = process.env.ADMIN_UID;
const action = process.argv[2];

if (!uid || !["grant", "revoke"].includes(action)) {
  console.error("Usage: ADMIN_UID=<Firebase UID> node scripts/set-admin-claim.js <grant|revoke>");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });

async function main() {
  const user = await admin.auth().getUser(uid);
  const claims = { ...(user.customClaims || {}) };

  if (action === "grant") claims.admin = true;
  else delete claims.admin;

  await admin.auth().setCustomUserClaims(uid, claims);
  console.log(action === "grant"
    ? "Admin claim granted to UID: " + uid
    : "Admin claim revoked from UID: " + uid);
  console.log("The user must refresh their Firebase ID token (sign out/in or force token refresh).");
}

main()
  .catch(error => {
    console.error("Admin claim update failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.app().delete();
  });
