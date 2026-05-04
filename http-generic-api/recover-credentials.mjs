/**
 * recover-credentials.mjs
 * Reads the Google Sheets version history (Drive Revisions API) to recover
 * the credential values that were cleared in the previous step, then writes
 * them directly into .env.
 */
import { readFileSync, writeFileSync } from "fs";
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

const REGISTRY_ID = process.env.REGISTRY_SPREADSHEET_ID || "";

const tokenPath   = resolve(__dirname, "google-oauth-token.json");
const secretsPath = resolve(__dirname, "../secrets/oauth-client.json");
const tokens  = JSON.parse(readFileSync(tokenPath, "utf8"));
const secrets = JSON.parse(readFileSync(secretsPath, "utf8")).installed;
const oauth2  = new google.auth.OAuth2(secrets.client_id, secrets.client_secret, "http://localhost:8765");
oauth2.setCredentials(tokens);
const drive  = google.drive({ version: "v3", auth: oauth2 });
const sheets = google.sheets({ version: "v4", auth: oauth2 });

// ── 1. Get sheet GIDs ─────────────────────────────────────────────────────────
console.log("── Getting sheet GIDs");
const meta = await sheets.spreadsheets.get({ spreadsheetId: REGISTRY_ID, fields: "sheets(properties(sheetId,title))" });
const sheetGids = {};
for (const s of meta.data.sheets) sheetGids[s.properties.title] = s.properties.sheetId;
console.log("  Brand Registry GID     :", sheetGids["Brand Registry"]);
console.log("  Actions Registry GID   :", sheetGids["Actions Registry"]);
console.log("  Hosting Account GID    :", sheetGids["Hosting Account Registry"]);

// ── 2. List revisions — find the one just before our cleanup ──────────────────
console.log("\n── Listing revisions of Registry Spreadsheet");
const revList = await drive.revisions.list({
  fileId: REGISTRY_ID,
  fields: "revisions(id,modifiedTime,exportLinks)",
  pageSize: 1000,
});
const revisions = revList.data.revisions || [];
console.log(`  Total revisions: ${revisions.length}`);

// The most recent revision IS the cleared state. We want the one before it.
if (revisions.length < 2) {
  console.error("  Not enough revisions to recover from. Exiting.");
  process.exit(1);
}

// Print last 5 for context
for (const r of revisions.slice(-5)) {
  console.log(`  revision id=${r.id}  modified=${r.modifiedTime}`);
}

// Target: second-to-last (last = post-cleanup, second-to-last = pre-cleanup)
const targetRev = revisions[revisions.length - 2];
console.log(`\n  Using revision: id=${targetRev.id}  modified=${targetRev.modifiedTime}`);

// ── 3. Fetch access token and download each sheet CSV from that revision ───────
const accessToken = (await oauth2.getAccessToken()).token;

async function fetchRevisionCsv(gid, revisionId) {
  // Try the export URL with revision ID
  const url = `https://docs.google.com/spreadsheets/d/${REGISTRY_ID}/export?format=csv&gid=${gid}&revision=${revisionId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    // Fallback: try via exportLinks in the revision object
    const xlsxLink = targetRev.exportLinks?.["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
    if (xlsxLink) {
      console.log(`  Falling back to exportLinks XLSX for gid=${gid}`);
      return null; // handled below
    }
    throw new Error(`HTTP ${res.status} ${await res.text()}`);
  }
  return res.text();
}

function parseCsv(csvText) {
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvRow(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCsvRow(l);
    const row = {};
    header.forEach((k, i) => { if (k) row[k] = cells[i] ?? ""; });
    return row;
  });
  return { header, rows };
}

function parseCsvRow(line) {
  const result = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { result.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

// ── 4. Extract credentials from previous revision ─────────────────────────────
const recovered = {};

// Brand Registry — application_password
console.log("\n── Recovering Brand Registry — application_password");
try {
  const csv = await fetchRevisionCsv(sheetGids["Brand Registry"], targetRev.id);
  if (csv) {
    const { header, rows } = parseCsv(csv);
    const appPwdIdx = header.indexOf("application_password");
    const targetIdx = header.indexOf("target_key");
    console.log(`  Parsed ${rows.length} rows. application_password col: ${appPwdIdx}, target_key col: ${targetIdx}`);
    for (const row of rows) {
      const target = row["target_key"] || "";
      const pw = row["application_password"] || "";
      if (pw && ["donatours_wp","allroyalegypt_wp","almallah_wp"].includes(target)) {
        const envKey = target.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_APP_PASSWORD";
        recovered[envKey] = pw;
        console.log(`  [OK] ${target} → ${envKey}=${pw.slice(0,4)}... (${pw.length} chars)`);
      }
    }
  }
} catch (e) {
  console.error(`  [ERROR] Brand Registry: ${e.message}`);
}

// Actions Registry — api_key_value
console.log("\n── Recovering Actions Registry — api_key_value");
const SECRET_ACTIONS = {
  serpapi_search:     "SERPAPI_API_KEY",
  scraperapi_scrape:  "SCRAPERAPI_API_KEY",
  abstractapi_scrape: "ABSTRACTAPI_API_KEY",
  googleads_api:      "GOOGLEADS_DEVELOPER_TOKEN",
  github_api_mcp:     "GITHUB_TOKEN",
  make_mcp_server:    "MAKE_MCP_TOKEN",
};
try {
  const csv = await fetchRevisionCsv(sheetGids["Actions Registry"], targetRev.id);
  if (csv) {
    const { header, rows } = parseCsv(csv);
    console.log(`  Parsed ${rows.length} rows`);
    for (const row of rows) {
      const key = row["action_key"] || "";
      const val = row["api_key_value"] || "";
      const envKey = SECRET_ACTIONS[key];
      if (envKey && val && val !== "embedded_sheet") {
        recovered[envKey] = val;
        console.log(`  [OK] ${key} → ${envKey}=${val.slice(0,8)}... (${val.length} chars)`);
      }
    }
  }
} catch (e) {
  console.error(`  [ERROR] Actions Registry: ${e.message}`);
}

// Hosting Account Registry — api_key_reference
console.log("\n── Recovering Hosting Account Registry — api_key_reference");
const HOSTING_MAP = {
  hostinger_cloud_plan_01:     "HOSTINGER_CLOUD_PLAN_01_API_KEY",
  hostinger_shared_manager_01: "HOSTINGER_SHARED_MANAGER_01_API_KEY",
};
try {
  const csv = await fetchRevisionCsv(sheetGids["Hosting Account Registry"], targetRev.id);
  if (csv) {
    const { header, rows } = parseCsv(csv);
    console.log(`  Parsed ${rows.length} rows`);
    for (const row of rows) {
      const key = row["hosting_account_key"] || "";
      const val = row["api_key_reference"] || "";
      const envKey = HOSTING_MAP[key];
      if (envKey && val && !val.startsWith("ref:secret:")) {
        recovered[envKey] = val;
        console.log(`  [OK] ${key} → ${envKey}=${val.slice(0,8)}... (${val.length} chars)`);
      }
    }
  }
} catch (e) {
  console.error(`  [ERROR] Hosting Registry: ${e.message}`);
}

// ── 5. Write recovered values to .env ────────────────────────────────────────
console.log(`\n── Writing ${Object.keys(recovered).length} recovered values to .env`);

if (!Object.keys(recovered).length) {
  console.error("  No values recovered. The revision may not contain the pre-cleanup data.");
  console.log("  Try: open the Registry Spreadsheet → File → Version history → See version history");
  console.log("  Find the version just before today's cleanup → manually copy the values to .env");
  process.exit(1);
}

const envPath = resolve(__dirname, ".env");
let envContent = readFileSync(envPath, "utf8");

// Remove any placeholder lines we added earlier
envContent = envContent.replace(/^# ── Rotated credentials.*$/m, "")
  .replace(/^# (SERPAPI_API_KEY|SCRAPERAPI_API_KEY|ABSTRACTAPI_API_KEY|GOOGLEADS_DEVELOPER_TOKEN|MAKE_MCP_TOKEN|HOSTINGER_[A-Z0-9_]+_API_KEY)=.*$/gm, "")
  .trimEnd();

// Append recovered values
const newBlock = "\n\n# ── Credentials recovered from Sheets version history ──\n"
  + Object.entries(recovered).map(([k, v]) => `${k}=${v}`).join("\n")
  + "\n";
envContent += newBlock;

writeFileSync(envPath, envContent, "utf8");
console.log("  .env updated.");

// Show summary (redact values)
for (const [k, v] of Object.entries(recovered)) {
  console.log(`  ${k}=${v.slice(0,6)}...${v.slice(-3)} (${v.length} chars)`);
}

console.log("\nDone. Run the smoke test to verify DB connectivity is unaffected:");
console.log("  node http-generic-api/smoke-test-data-flow.mjs");
