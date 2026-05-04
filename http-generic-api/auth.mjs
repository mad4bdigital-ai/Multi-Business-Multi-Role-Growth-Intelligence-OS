/**
 * auth.mjs  — one-time OAuth2 flow for Sheets write access
 *
 * Prerequisites:
 *   1. In Google Cloud Console → APIs & Services → Credentials:
 *      Create an OAuth 2.0 Client ID  (Application type: Desktop app)
 *      Download the JSON and save it as:  secrets/oauth-client.json
 *      (in the project root, one level above this file)
 *
 *   2. Run:  node http-generic-api/auth.mjs
 *      A browser tab will open — sign in and grant access.
 *      Tokens are saved to:  http-generic-api/google-oauth-token.json
 *
 *   3. Then run:
 *      node reconcile-catalog.mjs --fix-duplicates --refresh-columns --register-tabs --apply
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createServer } from "http";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const CLIENT_FILE = resolve(__dirname, "../secrets/oauth-client.json");
const TOKEN_FILE  = resolve(__dirname, "google-oauth-token.json");
const PORT        = 8765;
const REDIRECT    = `http://localhost:${PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
];

if (!existsSync(CLIENT_FILE)) {
  console.error(`\nERROR: Missing ${CLIENT_FILE}`);
  console.error("Steps:");
  console.error("  1. Google Cloud Console → APIs & Services → Credentials");
  console.error("  2. Create OAuth 2.0 Client ID  (type: Desktop app)");
  console.error("  3. Download JSON → save as  secrets/oauth-client.json");
  process.exit(1);
}

const raw      = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
const creds    = raw.installed || raw.web;
if (!creds) {
  console.error("ERROR: oauth-client.json must have an 'installed' or 'web' key");
  process.exit(1);
}

const oauth2   = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT);
const authUrl  = oauth2.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });

console.log("\n── Google OAuth2 ──────────────────────────────────────────");
console.log("Open this URL in your browser:\n");
console.log("  " + authUrl);
console.log("\nWaiting for redirect on " + REDIRECT + " …\n");

const server = createServer(async (req, res) => {
  const url   = new URL(req.url, REDIRECT);
  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Error: ${error}</h2><p>Check the terminal for details.</p>`);
    console.error("OAuth error:", error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Waiting for authorization code…</h2>");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Auth successful — you can close this tab.</h2>");

    console.log("Tokens saved to: " + TOKEN_FILE);
    console.log("\nNext step:");
    console.log("  node reconcile-catalog.mjs --fix-duplicates --refresh-columns --register-tabs --apply\n");
  } catch (err) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
    console.error("Token exchange error:", err.message);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`Server listening on ${REDIRECT}`);
});
