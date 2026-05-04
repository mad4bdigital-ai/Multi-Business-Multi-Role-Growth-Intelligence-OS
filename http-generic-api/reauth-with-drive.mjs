/**
 * reauth-with-drive.mjs
 * Re-runs the OAuth2 flow requesting BOTH spreadsheets + drive.readonly scopes.
 * This is needed so that recover-credentials.mjs can call drive.revisions.list().
 * Run once: node http-generic-api/reauth-with-drive.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import http from "http";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS_PATH = resolve(__dirname, "../secrets/oauth-client.json");
const TOKEN_PATH   = resolve(__dirname, "google-oauth-token.json");
const REDIRECT_URI = "http://localhost:8765";

let secrets;
try {
  secrets = JSON.parse(readFileSync(SECRETS_PATH, "utf8")).installed;
} catch {
  console.error("✗ Could not read", SECRETS_PATH);
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(secrets.client_id, secrets.client_secret, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  prompt: "consent",  // force re-consent so refresh_token is returned
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Error: ${error}. Close this tab.</h2>`);
    server.close(); process.exit(1);
  }
  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Waiting for auth code…</h2>"); return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h2>Authentication complete! Close this tab.</h2>");
  server.close();

  try {
    const { tokens } = await oauth2.getToken(code);
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log("\n✓ Token saved to:", TOKEN_PATH);
    console.log("  Scopes granted:", tokens.scope);
    console.log("\n  Now run: node http-generic-api/recover-credentials.mjs\n");
  } catch (err) {
    console.error("✗ Token exchange failed:", err.message);
  }
  process.exit(0);
});

server.listen(8765, () => {
  console.log("━━━ Re-authorize with drive.readonly scope ━━━");
  console.log("Opening browser — sign in and allow both requested scopes.");
  console.log("If browser doesn't open, visit:\n");
  console.log(authUrl, "\n");
  exec(`start "" "${authUrl}"`);
});

server.on("error", (err) => {
  console.error("✗ Port 8765 in use:", err.message);
  console.log("\nVisit this URL manually:\n", authUrl);
  process.exit(1);
});
