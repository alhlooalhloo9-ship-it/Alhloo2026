"use strict";
const FIREBASE_API_KEY = "AIzaSyD1iTNsgI-R12xywSKjyxmhQSF-sZ1qQ_Q";
const LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY;

async function requireFirebaseUser(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }
  let response;
  try {
    response = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: match[1] }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (_) {
    const error = new Error("تعذر الوصول إلى خدمة التحقق من تسجيل الدخول؛ تحقق من اتصال الخادم");
    error.statusCode = 503;
    throw error;
  }
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || !Array.isArray(data.users) || !data.users[0]?.localId) {
    const error = new Error(response.status === 400
      ? "Invalid or expired authentication token"
      : "Firebase token verification is temporarily unavailable");
    error.statusCode = response.status === 400 ? 401 : 503;
    throw error;
  }
  const user = data.users[0];
  return { uid: user.localId, email: user.email || null, emailVerified: Boolean(user.emailVerified), name: user.displayName || null };
}
module.exports = { requireFirebaseUser };
