/**
 * generate-google-refresh-token.mjs
 *
 * One-time helper: exchanges a Google authorization code for a refresh token
 * using the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET already in .env.
 *
 * Steps:
 *   1. node http-generic-api/generate-google-refresh-token.mjs
 *   2. Open the printed URL in a browser and authorize.
 *   3. Copy the `code=` param from the redirect URL.
 *   4. node http-generic-api/generate-google-refresh-token.mjs --code=<PASTE_CODE>
 *   5. Copy the printed GOOGLE_REFRESH_TOKEN value into .env.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq < 1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* ignore */ }

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in .env");
  process.exit(1);
}

// The redirect URI registered in Google Cloud Console.
// For local scripts, use the OOB (out-of-band) redirect or localhost.
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/analytics.manage.users",
  "https://www.googleapis.com/auth/analytics.provision",
  "https://www.googleapis.com/auth/doubleclicksearch",
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.manage.accounts",
  "https://www.googleapis.com/auth/tagmanager.manage.users",
  "https://www.googleapis.com/auth/tagmanager.delete.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  "https://www.googleapis.com/auth/adwords",
];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// ── Step 2: exchange code for token ──────────────────────────────────────────
const codeArg = process.argv.find(a => a.startsWith("--code="));
if (codeArg) {
  const code = codeArg.slice("--code=".length).trim();
  if (!code) { console.error("Empty --code value."); process.exit(1); }

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        "\nERROR: No refresh_token returned. This happens when the app was already authorized.\n" +
        "Fix: Go to https://myaccount.google.com/permissions, revoke access for your app, then re-run step 1."
      );
      process.exit(1);
    }
    console.log("\n✓ Success! Add this to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nAccess token (expires in 1h):", tokens.access_token ? "[received]" : "[none]");
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

// ── Step 1: print authorization URL ─────────────────────────────────────────
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",   // forces refresh_token to be returned even on re-auth
});

console.log("\n=== Google Refresh Token Generator ===\n");
console.log("CLIENT_ID:", CLIENT_ID.slice(0, 30) + "...");
console.log("Scopes:   ", SCOPES.length, "scopes\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Authorize the app and copy the authorization code from the page.");
console.log('3. Run:  node http-generic-api/generate-google-refresh-token.mjs --code=<PASTE_CODE>');
console.log("4. Copy the printed GOOGLE_REFRESH_TOKEN into .env\n");
