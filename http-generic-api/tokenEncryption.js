// tokenEncryption.js — AES-256-GCM symmetric encryption for stored OAuth tokens,
// API keys, webhook secrets, and MCP bearer tokens.
//
// Env: TOKEN_ENCRYPTION_KEY — 64 hex chars (32 bytes). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Stored format (JSON string): { iv: hex, tag: hex, data: hex }
// IV is unique per encrypt call — never reused.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO    = "aes-256-gcm";
const IV_LEN  = 12;  // 96-bit IV recommended for GCM
const TAG_LEN = 16;

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  return key;
}

export function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key  = getKey();
  const iv   = randomBytes(IV_LEN);
  const ciph = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const enc  = Buffer.concat([ciph.update(String(plaintext), "utf8"), ciph.final()]);
  const tag  = ciph.getAuthTag();
  return JSON.stringify({
    iv:   iv.toString("hex"),
    tag:  tag.toString("hex"),
    data: enc.toString("hex"),
  });
}

export function decryptToken(stored) {
  if (!stored) return null;
  const key  = getKey();
  const { iv, tag, data } = JSON.parse(stored);
  const deci = createDecipheriv(ALGO, key, Buffer.from(iv, "hex"), { authTagLength: TAG_LEN });
  deci.setAuthTag(Buffer.from(tag, "hex"));
  const dec  = Buffer.concat([deci.update(Buffer.from(data, "hex")), deci.final()]);
  return dec.toString("utf8");
}

// Encrypt a credentials object (access_token, refresh_token, api_key, etc.)
// into a single stored blob.
export function encryptCredentials(credObj) {
  if (!credObj) return null;
  return encryptToken(JSON.stringify(credObj));
}

export function decryptCredentials(stored) {
  if (!stored) return null;
  const plain = decryptToken(stored);
  try { return JSON.parse(plain); } catch { return { raw: plain }; }
}

// Timing-safe comparison for webhook HMAC verification.
export function safeCompare(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
