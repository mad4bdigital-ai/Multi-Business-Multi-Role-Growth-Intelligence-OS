/**
 * rotate-and-clear-credentials.mjs
 *
 * Implements the full credential handover:
 *  1. Read current (still-live) credential cells from Google Sheets
 *  2. Rotate WordPress application passwords via WP REST API
 *  3. Clear all embedded credential cells from Google Sheets
 *  4. Audit Activity Workbook AppScript triggers via Drive API
 *  5. Print new env-var assignments ready to paste into .env
 *
 * Run (dry-run):  node rotate-and-clear-credentials.mjs
 * Run (apply):    node rotate-and-clear-credentials.mjs --apply
 *
 * IMPORTANT: The script reads old credentials from Sheets to authenticate
 * the WP rotation.  Run BEFORE the next --merge, which would overwrite
 * the cleared cells with whatever is still in Sheets.
 */

import { readFileSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env loader ───────────────────────────────────────────────────────────────
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq < 1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* ignore */ }

const APPLY = process.argv.includes("--apply");
const REGISTRY_ID = process.env.REGISTRY_SPREADSHEET_ID || "";
const ACTIVITY_ID = process.env.ACTIVITY_SPREADSHEET_ID || REGISTRY_ID;

// ── Google auth ───────────────────────────────────────────────────────────────
async function getSheets() {
  const tokenPath   = resolve(__dirname, "google-oauth-token.json");
  const secretsPath = resolve(__dirname, "../secrets/oauth-client.json");
  const tokens  = JSON.parse(readFileSync(tokenPath, "utf8"));
  const secrets = JSON.parse(readFileSync(secretsPath, "utf8")).installed;
  const oauth2  = new google.auth.OAuth2(secrets.client_id, secrets.client_secret, "http://localhost:8765");
  oauth2.setCredentials(tokens);
  return { sheets: google.sheets({ version: "v4", auth: oauth2 }), drive: google.drive({ version: "v3", auth: oauth2 }) };
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────
async function readSheet(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:AZ` });
  const [headerRow, ...dataRows] = res.data.values || [];
  if (!headerRow) return { header: [], rows: [], spreadsheetId, sheetName };
  const header = headerRow.map((v) => String(v || "").trim());
  const rows = dataRows
    .filter((r) => r.some((c) => String(c || "").trim()))
    .map((r, i) => {
      const rec = { __rowIndex: i + 2 }; // 1-indexed, skip header = row 2+
      header.forEach((k, ci) => { if (k) rec[k] = String(r[ci] ?? ""); });
      return rec;
    });
  return { header, rows, spreadsheetId, sheetName };
}

function colLetter(index) {
  // 0-based index → A, B, ... Z, AA, ...
  let s = "";
  let i = index + 1;
  while (i > 0) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

async function clearCell(sheets, spreadsheetId, sheetName, rowIndex, colIndex) {
  const a1 = `${sheetName}!${colLetter(colIndex)}${rowIndex}`;
  if (!APPLY) { console.log(`    [DRY] clear ${a1}`); return; }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: a1,
    valueInputOption: "RAW",
    requestBody: { values: [[""]] },
  });
  console.log(`    [CLEAR] ${a1}`);
}

// ── WP REST API helpers ───────────────────────────────────────────────────────
async function wpFetch(baseUrl, path, { method = "GET", body, username, password } = {}) {
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const url = baseUrl.replace(/\/?$/, "") + path;
  const opts = {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", "User-Agent": "GrowthOS/1.0" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function rotateWpAppPassword(baseUrl, username, oldPassword, brandName) {
  console.log(`\n  Rotating WP app password for ${brandName} (${baseUrl})`);

  // List existing app passwords to find which one to delete
  const listRes = await wpFetch(baseUrl, "/wp/v2/users/me/application-passwords",
    { username, password: oldPassword });

  if (!listRes.ok) {
    console.error(`    [ERROR] Could not list app passwords: HTTP ${listRes.status}`);
    if (typeof listRes.data === "object") console.error("   ", JSON.stringify(listRes.data).slice(0, 200));
    return null;
  }

  const existing = Array.isArray(listRes.data) ? listRes.data : [];
  const growthOsEntry = existing.find((p) =>
    /growth.?os|gpt|claude|api/i.test(p.name)
  ) || existing[0];

  if (!APPLY) {
    console.log(`    [DRY] would delete app password uuid=${growthOsEntry?.uuid} name="${growthOsEntry?.name}"`);
    console.log(`    [DRY] would create new app password named "GrowthOS"`);
    return "__dry_run_placeholder__";
  }

  // Delete old
  if (growthOsEntry?.uuid) {
    await wpFetch(baseUrl, `/wp/v2/users/me/application-passwords/${growthOsEntry.uuid}`,
      { method: "DELETE", username, password: oldPassword });
    console.log(`    [DELETE] old app password "${growthOsEntry.name}"`);
  }

  // Create new
  const createRes = await wpFetch(baseUrl, "/wp/v2/users/me/application-passwords",
    { method: "POST", body: { name: "GrowthOS" }, username, password: oldPassword });

  if (!createRes.ok || !createRes.data?.password) {
    console.error(`    [ERROR] Could not create new app password: HTTP ${createRes.status}`);
    if (typeof createRes.data === "object") console.error("   ", JSON.stringify(createRes.data).slice(0, 300));
    return null;
  }

  const newPassword = createRes.data.password; // WordPress returns it once, never again
  console.log(`    [OK] New app password created (${newPassword.length} chars)`);
  return newPassword;
}

// ── AppScript audit ───────────────────────────────────────────────────────────
async function auditAppScript(drive, spreadsheetId) {
  console.log("\n── AppScript audit ────────────────────────────────────────");
  try {
    // Find bound script project via Drive API
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.script' and parents in '${spreadsheetId}'`,
      fields: "files(id,name,modifiedTime)",
      spaces: "drive",
    });
    const files = res.data.files || [];
    if (!files.length) {
      console.log("  No bound AppScript project found on Activity Workbook.");
      return;
    }
    for (const f of files) {
      console.log(`  Found AppScript project: "${f.name}" (id=${f.id}, modified=${f.modifiedTime})`);
    }

    // Try to read the script content
    for (const f of files) {
      try {
        const content = await drive.files.export({ fileId: f.id, mimeType: "application/vnd.google-apps.script+json" });
        const source = typeof content.data === "string" ? content.data : JSON.stringify(content.data);
        const files2 = JSON.parse(source).files || [];
        console.log(`  Script files: ${files2.map((s) => s.name).join(", ")}`);

        // Scan for triggers writing to credential columns
        const credPatterns = /application.password|api.key.value|api.key.reference|setValues|setValue/gi;
        for (const sf of files2) {
          const src = sf.source || "";
          const hits = src.match(credPatterns) || [];
          if (hits.length) {
            console.log(`  [WARN] "${sf.name}" references: ${[...new Set(hits)].join(", ")}`);
          } else {
            console.log(`  [OK]   "${sf.name}" — no credential column writes detected`);
          }
        }
      } catch (e) {
        console.log(`  [INFO] Could not export script content (scope may not allow it): ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  Drive API lookup failed: ${e.message}`);
    console.log("  Manual step: open Activity Workbook → Extensions → Apps Script → review all triggers.");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n═══ Credential Rotation & Sheet Cleanup — ${APPLY ? "APPLY" : "DRY RUN"} ═══\n`);

const { sheets, drive } = await getSheets();

// ─── STEP 1: Read Brand Registry from Sheets ──────────────────────────────────
console.log("── Step 1: Read Brand Registry from Sheets");
const { header: brandHeader, rows: brandRows } = await readSheet(sheets, REGISTRY_ID, "Brand Registry");
const appPwdColIdx  = brandHeader.indexOf("application_password");
const targetKeyIdx  = brandHeader.indexOf("target_key");
const baseUrlIdx    = brandHeader.indexOf("base_url");
const usernameIdx   = brandHeader.indexOf("username");
const brandNameIdx  = brandHeader.indexOf("Brand Name");

if (appPwdColIdx === -1) {
  console.error("  [ERROR] application_password column not found in Brand Registry");
  process.exit(1);
}
console.log(`  application_password is column ${colLetter(appPwdColIdx)} (index ${appPwdColIdx})`);

const BRANDS_TO_ROTATE = ["donatours_wp", "allroyalegypt_wp", "almallah_wp"];
const wpBrands = brandRows.filter(
  (r) => BRANDS_TO_ROTATE.includes(r["target_key"]) && r["application_password"]
);
console.log(`  Found ${wpBrands.length} brand rows with embedded application_password`);

// ─── STEP 2: Rotate WP passwords ─────────────────────────────────────────────
console.log("\n── Step 2: Rotate WordPress application passwords");
const newPasswords = {};

for (const brand of wpBrands) {
  const baseUrl  = brand["base_url"] || brand[brandHeader[baseUrlIdx]] || "";
  const username = brand["username"] || brand[brandHeader[usernameIdx]] || "gpt";
  const oldPw    = brand["application_password"];
  const target   = brand["target_key"];
  const name     = brand["Brand Name"] || target;

  if (!baseUrl) { console.error(`  [SKIP] ${name} — no base_url`); continue; }
  if (!oldPw)   { console.error(`  [SKIP] ${name} — application_password already empty in Sheets`); continue; }

  const newPw = await rotateWpAppPassword(baseUrl, username, oldPw, name);
  if (newPw) newPasswords[target] = newPw;
}

// ─── STEP 3: Clear Brand Registry credential cells ────────────────────────────
console.log("\n── Step 3: Clear Brand Registry — application_password cells");
for (const brand of brandRows) {
  if (!brand["application_password"]) continue;
  console.log(`  ${brand["Brand Name"] || brand["target_key"]} row ${brand.__rowIndex}`);
  await clearCell(sheets, REGISTRY_ID, "Brand Registry", brand.__rowIndex, appPwdColIdx);
}

// ─── STEP 4: Clear Actions Registry — api_key_value cells ────────────────────
console.log("\n── Step 4: Clear Actions Registry — api_key_value cells");
const { header: actionHeader, rows: actionRows } = await readSheet(sheets, REGISTRY_ID, "Actions Registry");
const apiKeyValIdx = actionHeader.indexOf("api_key_value");
const storageIdx   = actionHeader.indexOf("api_key_storage_mode");
const SECRET_ACTIONS = new Set(["serpapi_search","scraperapi_scrape","abstractapi_scrape",
  "googleads_api","github_api_mcp","make_mcp_server"]);

if (apiKeyValIdx === -1) {
  console.error("  [ERROR] api_key_value column not found in Actions Registry");
} else {
  console.log(`  api_key_value is column ${colLetter(apiKeyValIdx)}`);
  for (const row of actionRows) {
    const key = row["action_key"] || row["action_id"] || "";
    if (!SECRET_ACTIONS.has(key)) continue;
    const val = row["api_key_value"] || "";
    if (!val || val === "embedded_sheet") continue;
    console.log(`  ${key} row ${row.__rowIndex}`);
    await clearCell(sheets, REGISTRY_ID, "Actions Registry", row.__rowIndex, apiKeyValIdx);
    // Also update storage mode cell to secret_reference in the Sheet
    if (storageIdx !== -1 && APPLY) {
      const a1 = `Actions Registry!${colLetter(storageIdx)}${row.__rowIndex}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: REGISTRY_ID, range: a1, valueInputOption: "RAW",
        requestBody: { values: [["secret_reference"]] },
      });
      console.log(`    [SET] api_key_storage_mode = secret_reference @ ${a1}`);
    }
  }
}

// ─── STEP 5: Clear Hosting Account Registry — api_key_reference cells ─────────
console.log("\n── Step 5: Clear Hosting Account Registry — api_key_reference cells");
const { header: hostHeader, rows: hostRows } = await readSheet(sheets, REGISTRY_ID, "Hosting Account Registry");
const apiKeyRefIdx    = hostHeader.indexOf("api_key_reference");
const hostStorageIdx  = hostHeader.indexOf("api_key_storage_mode");
const HOSTING_TO_CLEAR = new Set(["hostinger_cloud_plan_01", "hostinger_shared_manager_01"]);
const HOSTING_ENV_MAP  = {
  hostinger_cloud_plan_01:     "ref:secret:HOSTINGER_CLOUD_PLAN_01_API_KEY",
  hostinger_shared_manager_01: "ref:secret:HOSTINGER_SHARED_MANAGER_01_API_KEY",
};

if (apiKeyRefIdx === -1) {
  console.error("  [ERROR] api_key_reference column not found in Hosting Account Registry");
} else {
  console.log(`  api_key_reference is column ${colLetter(apiKeyRefIdx)}`);
  for (const row of hostRows) {
    const key = row["hosting_account_key"] || "";
    if (!HOSTING_TO_CLEAR.has(key)) continue;
    const val = row["api_key_reference"] || "";
    if (!val || val.startsWith("ref:secret:")) continue;
    console.log(`  ${key} row ${row.__rowIndex}`);
    // Replace raw key with ref:secret: pointer rather than blank, so the sheet self-documents
    if (APPLY) {
      const refVal = HOSTING_ENV_MAP[key] || "";
      const a1 = `Hosting Account Registry!${colLetter(apiKeyRefIdx)}${row.__rowIndex}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: REGISTRY_ID, range: a1, valueInputOption: "RAW",
        requestBody: { values: [[refVal]] },
      });
      console.log(`    [SET] api_key_reference = ${refVal}`);
      if (hostStorageIdx !== -1) {
        const sa1 = `Hosting Account Registry!${colLetter(hostStorageIdx)}${row.__rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: REGISTRY_ID, range: sa1, valueInputOption: "RAW",
          requestBody: { values: [["secret_reference"]] },
        });
        console.log(`    [SET] api_key_storage_mode = secret_reference`);
      }
    } else {
      console.log(`    [DRY] would replace raw key with ${HOSTING_ENV_MAP[key] || "ref:secret:..."} and set storage_mode=secret_reference`);
    }
  }
}

// ─── STEP 6: AppScript audit ──────────────────────────────────────────────────
await auditAppScript(drive, ACTIVITY_ID);

// ─── STEP 7: Write env var additions ─────────────────────────────────────────
console.log("\n── Step 7: New env var values");

const envLines = [];

// WP passwords
for (const [target, pw] of Object.entries(newPasswords)) {
  const envKey = target.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_APP_PASSWORD";
  if (pw && pw !== "__dry_run_placeholder__") {
    envLines.push(`${envKey}=${pw}`);
    console.log(`  ${envKey}=<new password — ${pw.length} chars>`);
  } else {
    console.log(`  ${envKey}=<pending — dry-run>`);
  }
}

// Placeholders for credentials requiring manual rotation
const MANUAL_ROTATIONS = [
  "SERPAPI_API_KEY",
  "SCRAPERAPI_API_KEY",
  "ABSTRACTAPI_API_KEY",
  "GOOGLEADS_DEVELOPER_TOKEN",
  "MAKE_MCP_TOKEN",
  "HOSTINGER_CLOUD_PLAN_01_API_KEY",
  "HOSTINGER_SHARED_MANAGER_01_API_KEY",
];
const ALREADY_IN_ENV = ["GITHUB_TOKEN"];

for (const k of MANUAL_ROTATIONS) {
  if (!process.env[k]) {
    envLines.push(`# ${k}=<rotate at provider dashboard, then fill>`);
    console.log(`  ${k}=<manual rotation required>`);
  }
}
for (const k of ALREADY_IN_ENV) {
  console.log(`  ${k}=<already in .env — confirm it was rotated>`);
}

if (APPLY && envLines.length) {
  const envPath = resolve(__dirname, ".env");
  appendFileSync(envPath, "\n# ── Rotated credentials (added by rotate-and-clear-credentials.mjs) ──\n" + envLines.join("\n") + "\n");
  console.log(`\n  Appended ${envLines.length} line(s) to .env`);
}

// ─── Final report ─────────────────────────────────────────────────────────────
console.log("\n═══ Summary ═══");
console.log(`  Mode          : ${APPLY ? "APPLIED" : "DRY RUN"}`);
console.log(`  WP passwords  : ${Object.keys(newPasswords).length} rotated`);
console.log(`  Actions cells : ${wpBrands.length > 0 ? "cleared" : "nothing to clear"}`);

if (!APPLY) {
  console.log("\n  Re-run with --apply to execute all changes.");
}
console.log("\n  Manual steps still required:");
console.log("  1. Rotate at provider dashboards: SerpAPI, ScraperAPI, AbstractAPI, Google Ads, Make.com");
console.log("  2. Rotate Hostinger API tokens at hpanel.hostinger.com → API Tokens");
console.log("  3. Confirm GITHUB_TOKEN in .env is current (or rotate at github.com → Settings → PATs)");
console.log("  4. Add rotated values to .env for the [manual] items above");
console.log("  5. Review AppScript triggers manually if audit above was incomplete");
