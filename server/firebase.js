"use strict";

function parseServiceAccount(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing");
  }

  let raw = rawValue.replace(/^\uFEFF/, "").trim();
  if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") {
    raw = raw.slice(1, -1).trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    let repaired = "";
    let inString = false;
    let escaped = false;
    for (const character of raw) {
      if (inString && (character === "\n" || character === "\r" || character === "\t")) {
        repaired += character === "\n" ? "\\n" : character === "\r" ? "\\r" : "\\t";
        escaped = false;
        continue;
      }
      repaired += character;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
    }
    try {
      parsed = JSON.parse(repaired);
    } catch (_) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON; check the full service-account JSON value and private_key formatting");
    }
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON contains a JSON string, not a service-account object");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain project_id, client_email and private_key");
  }
  if (parsed.project_id !== "alhlooapp") {
    throw new Error("Firebase service account project_id does not match alhlooapp");
  }

  parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
  return parsed;
}

module.exports = { parseServiceAccount };
