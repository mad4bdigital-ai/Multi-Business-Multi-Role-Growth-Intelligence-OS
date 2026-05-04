/**
 * reconcile-catalog.mjs
 *
 * Reads the live Registry Surfaces Catalog and the actual workbook tab list,
 * then reports and optionally fixes four classes of issue:
 *
 *   1. Duplicate surface_id values (flagged — manual fix required)
 *   2. Workbook tabs not registered in the catalog (can auto-register)
 *   3. Catalog worksheet rows referencing tabs that no longer exist
 *   4. expected_column_count mismatches vs. live tab header (can auto-refresh)
 *
 * Usage:
 *   node reconcile-catalog.mjs                          # full report, no writes
 *   node reconcile-catalog.mjs --refresh-columns --apply  # fix column counts
 *   node reconcile-catalog.mjs --register-tabs --apply    # add rows for unregistered tabs
 *   node reconcile-catalog.mjs --refresh-columns --register-tabs --apply
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

// ── Load .env ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* rely on process.env */ }

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY            = args.includes("--apply");
const REFRESH_COLUMNS  = args.includes("--refresh-columns");
const REGISTER_TABS    = args.includes("--register-tabs");
const FIX_DUPLICATES   = args.includes("--fix-duplicates");
const RETIRE_DELETED   = args.includes("--retire-deleted");
const DEMOTE_REQUIRED  = args.includes("--demote-required");
const FIX_GIDS         = args.includes("--fix-gids");
const DRY_RUN          = !APPLY;

const CATALOG_SHEET    = "Registry Surfaces Catalog";
const REGISTRY_ID      = process.env.REGISTRY_SPREADSHEET_ID || "";

// ── Google Sheets auth ─────────────────────────────────────────────────────────
async function getSheets() {
  const tokenPath   = resolve(__dirname, "google-oauth-token.json");
  const secretsPath = resolve(__dirname, "../secrets/oauth-client.json");
  try {
    const tokens  = JSON.parse(readFileSync(tokenPath, "utf8"));
    const secrets = JSON.parse(readFileSync(secretsPath, "utf8")).installed;
    const oauth2  = new google.auth.OAuth2(
      secrets.client_id, secrets.client_secret, "http://localhost:8765"
    );
    oauth2.setCredentials(tokens);
    return google.sheets({ version: "v4", auth: oauth2 });
  } catch { /* fall through to ADC */ }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function colLetter(zeroBasedIndex) {
  let result = "";
  let n = zeroBasedIndex + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function cell(colIdx, rowIdx) {
  return `${colLetter(colIdx)}${rowIdx}`;
}

function normalizeId(v) {
  return String(v || "").trim();
}

// Strip optional cell-range suffix: "Sheet Name!A1:Z" → "Sheet Name"
function normalizeTabName(v) {
  return String(v || "").trim().replace(/![A-Z0-9:]+$/i, "").trim();
}

function isTruthy(v) {
  const s = String(v || "").trim().toUpperCase();
  return s === "TRUE" || s === "YES" || s === "1";
}

const RETIRED_STATUSES = new Set(["retired", "deleted", "inactive", "archived", "deprecated"]);
function isRetired(r) {
  return RETIRED_STATUSES.has(String(r.active_status || "").trim().toLowerCase());
}

// ── Read catalog with row positions ───────────────────────────────────────────
async function readCatalog(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${CATALOG_SHEET}!A:AZ`,
  });
  const values = response.data.values || [];
  if (!values.length) return { header: [], rows: [] };

  const header = values[0].map((v) => String(v || "").trim());
  const rows = values.slice(1).map((row, idx) => {
    const record = { _rowIndex: idx + 2 }; // 1-based; 1=header, so data starts at 2
    header.forEach((key, i) => {
      if (key) record[key] = String(row[i] ?? "");
    });
    return record;
  }).filter((r) => {
    // Skip fully blank rows
    return header.some((k) => k && normalizeId(r[k]));
  });

  return { header, rows };
}

// ── Read workbook tab structure ────────────────────────────────────────────────
async function getWorkbookTabs(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,index)",
  });
  const result = {};
  for (const sheet of response.data.sheets || []) {
    const p = sheet.properties || {};
    const title = String(p.title || "").trim();
    if (!title) continue;
    result[title] = { gid: String(p.sheetId), index: p.index };
  }
  return result;
}

// ── Read a tab's header row (first row only) ───────────────────────────────────
async function readTabHeader(sheets, spreadsheetId, tabName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName.replace(/'/g, "''")}'!1:1`,
    });
    const row = (response.data.values || [])[0] || [];
    return row.map((v) => String(v || "").trim()).filter(Boolean);
  } catch {
    return null; // tab may not be readable
  }
}

// ── Build column index map from header ────────────────────────────────────────
function colIndex(header, name) {
  const idx = header.indexOf(name);
  return idx === -1 ? null : idx;
}

// ── Update a single cell ───────────────────────────────────────────────────────
async function updateCell(sheets, spreadsheetId, sheetName, colIdx, rowIdx, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!${cell(colIdx, rowIdx)}`,
    valueInputOption: "RAW",
    requestBody: { values: [[String(value)]] },
  });
}

// ── Append rows to the catalog ─────────────────────────────────────────────────
async function appendCatalogRows(sheets, spreadsheetId, header, newRows) {
  const values = newRows.map((row) =>
    header.map((col) => row[col] ?? "")
  );
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${CATALOG_SHEET.replace(/'/g, "''")}'!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━ Registry Surfaces Catalog Reconciliation ━━━");
  console.log(`Mode      : ${DRY_RUN ? "REPORT ONLY (no writes)" : "APPLY"}`);
  if (!DRY_RUN) {
    const fixes = [
      FIX_DUPLICATES  && "--fix-duplicates",
      REFRESH_COLUMNS && "--refresh-columns",
      REGISTER_TABS   && "--register-tabs",
      RETIRE_DELETED  && "--retire-deleted",
      DEMOTE_REQUIRED && "--demote-required",
      FIX_GIDS        && "--fix-gids",
    ].filter(Boolean);
    console.log(`Fixes     : ${fixes.join(", ") || "none specified — pass --refresh-columns and/or --register-tabs"}`);
  }
  console.log(`Workbook  : ${REGISTRY_ID || "(not set)"}`);
  console.log("");

  if (!REGISTRY_ID) {
    console.error("ERROR: REGISTRY_SPREADSHEET_ID not set in .env");
    process.exit(1);
  }

  let sheets;
  try {
    sheets = await getSheets();
    console.log("✓ Google Sheets auth OK");
  } catch (err) {
    console.error("✗ Auth failed:", err.message);
    process.exit(1);
  }

  // ── Load data ──────────────────────────────────────────────────────────────
  console.log("  Reading catalog...");
  const { header: catalogHeader, rows: catalogRows } = await readCatalog(sheets, REGISTRY_ID);
  console.log(`  Catalog : ${catalogRows.length} rows, ${catalogHeader.length} columns`);

  console.log("  Reading workbook tabs...");
  const tabMap = await getWorkbookTabs(sheets, REGISTRY_ID);
  const tabNames = Object.keys(tabMap);
  console.log(`  Workbook: ${tabNames.length} tabs`);
  console.log("");

  // ── Locate key catalog columns ─────────────────────────────────────────────
  const COL = {
    surface_id:            colIndex(catalogHeader, "surface_id"),
    surface_name:          colIndex(catalogHeader, "surface_name"),
    worksheet_name:        colIndex(catalogHeader, "worksheet_name"),
    worksheet_gid:         colIndex(catalogHeader, "worksheet_gid"),
    file_id:               colIndex(catalogHeader, "file_id"),
    active_status:         colIndex(catalogHeader, "active_status"),
    authority_status:      colIndex(catalogHeader, "authority_status"),
    required_for_execution:colIndex(catalogHeader, "required_for_execution"),
    schema_ref:            colIndex(catalogHeader, "schema_ref"),
    schema_version:        colIndex(catalogHeader, "schema_version"),
    header_signature:      colIndex(catalogHeader, "header_signature"),
    expected_column_count: colIndex(catalogHeader, "expected_column_count"),
    binding_mode:          colIndex(catalogHeader, "binding_mode"),
    sheet_role:            colIndex(catalogHeader, "sheet_role"),
    audit_mode:            colIndex(catalogHeader, "audit_mode"),
  };

  const missingCols = Object.entries(COL)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missingCols.length) {
    console.warn(`⚠  Catalog header is missing expected columns: ${missingCols.join(", ")}`);
    console.warn("   Column count refresh and registration may be degraded.");
    console.warn("");
  }

  // ── 1. Duplicate surface_id ────────────────────────────────────────────────
  const surfaceIdCount = new Map();
  for (const row of catalogRows) {
    const id = normalizeId(row.surface_id);
    if (!id) continue;
    surfaceIdCount.set(id, (surfaceIdCount.get(id) || 0) + 1);
  }
  const duplicateIds = [...surfaceIdCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));

  // ── 2. Worksheet-type rows: separate from file/doc rows ────────────────────
  const worksheetRows = catalogRows.filter((r) => {
    const wn = normalizeId(r.worksheet_name);
    return wn.length > 0;
  });
  // worksheet_names scoped to the main registry workbook only (for unregistered-tab check)
  const registryWorksheetNames = new Set(
    worksheetRows
      .filter((r) => !normalizeId(r.file_id) || normalizeId(r.file_id) === REGISTRY_ID)
      .map((r) => normalizeTabName(r.worksheet_name))
  );

  // ── Pre-fetch tab lists for all referenced spreadsheets ───────────────────
  const tabMapCache = { [REGISTRY_ID]: tabMap };
  const foreignSpreadsheetIds = [...new Set(
    worksheetRows
      .map((r) => normalizeId(r.file_id))
      .filter((id) => id && id !== REGISTRY_ID)
  )];
  if (foreignSpreadsheetIds.length) {
    console.log(`  Fetching tabs from ${foreignSpreadsheetIds.length} additional workbook(s)...`);
    for (const sid of foreignSpreadsheetIds) {
      try {
        tabMapCache[sid] = await getWorkbookTabs(sheets, sid);
        console.log(`    ${sid} → ${Object.keys(tabMapCache[sid]).length} tabs`);
      } catch (err) {
        console.warn(`    ⚠ Could not read workbook ${sid}: ${err.message}`);
        tabMapCache[sid] = {};
      }
    }
  }

  // Helper: resolve the tab map for a given catalog row
  function tabMapFor(row) {
    const sid = normalizeId(row.file_id) || REGISTRY_ID;
    return tabMapCache[sid] || {};
  }

  // ── 3. Tabs not in catalog (registry workbook only) ────────────────────────
  const unregisteredTabs = tabNames.filter((name) => !registryWorksheetNames.has(name));

  // ── 4. Catalog worksheet rows with missing tabs (skip already-retired rows) ─
  const missingTabRows = worksheetRows.filter((r) => {
    if (isRetired(r)) return false;
    return !tabMapFor(r)[normalizeTabName(r.worksheet_name)];
  });
  const missingRequired = missingTabRows.filter((r) => isTruthy(r.required_for_execution));
  const missingOptional = missingTabRows.filter((r) => !isTruthy(r.required_for_execution));

  // ── 5. GID mismatches (tab exists but GID differs) ────────────────────────
  const gidMismatches = worksheetRows.filter((r) => {
    const wn = normalizeTabName(r.worksheet_name);
    const catalogGid = normalizeId(r.worksheet_gid);
    const tm = tabMapFor(r);
    if (!tm[wn] || !catalogGid) return false;
    return catalogGid !== tm[wn].gid;
  });

  // ── 6. Column count mismatches (for tabs that exist) ──────────────────────
  console.log("  Reading tab headers for column count comparison...");
  const columnCountMismatches = [];

  const existingWorksheetRows = worksheetRows.filter((r) => tabMapFor(r)[normalizeTabName(r.worksheet_name)]);

  for (const row of existingWorksheetRows) {
    const tabName = normalizeTabName(row.worksheet_name);
    const catalogCount = parseInt(normalizeId(row.expected_column_count), 10);
    if (!Number.isFinite(catalogCount) || catalogCount === 0) continue;

    const sid = normalizeId(row.file_id) || REGISTRY_ID;
    const liveHeader = await readTabHeader(sheets, sid, tabName);
    if (!liveHeader) continue;

    const liveCount = liveHeader.length;
    if (liveCount !== catalogCount) {
      columnCountMismatches.push({
        surface_id: normalizeId(row.surface_id),
        worksheet_name: tabName,
        catalog_count: catalogCount,
        live_count: liveCount,
        delta: liveCount - catalogCount,
        _rowIndex: row._rowIndex,
      });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log("");
  console.log("━━━ REPORT ━━━");
  console.log("");

  // 1. Duplicates
  console.log(`── 1. Duplicate surface_id (${duplicateIds.length} found) ──`);
  if (duplicateIds.length === 0) {
    console.log("   None.");
  } else {
    duplicateIds.forEach(({ id, count }) => {
      const rows = catalogRows
        .filter((r) => normalizeId(r.surface_id) === id)
        .sort((a, b) => a._rowIndex - b._rowIndex);
      console.log(`   surface_id: ${id}  (${count}×)`);
      rows.forEach((r, i) => {
        const action = i === 0 ? "KEEP " : "DELETE";
        console.log(`     row ${String(r._rowIndex).padEnd(4)}  [${action}]  worksheet_name: ${normalizeId(r.worksheet_name) || "(blank)"}`);
      });
    });
    if (FIX_DUPLICATES && !DRY_RUN) {
      console.log("   → Will delete trailing duplicate rows (keeping first occurrence).");
    } else {
      console.log("   → Pass --fix-duplicates --apply to auto-delete trailing duplicates (keeps first row).");
    }
  }
  console.log("");

  // 2. Unregistered tabs
  console.log(`── 2. Workbook tabs not in catalog (${unregisteredTabs.length} found) ──`);
  if (unregisteredTabs.length === 0) {
    console.log("   None.");
  } else {
    unregisteredTabs.forEach((t) => {
      const info = tabMap[t];
      console.log(`   ${t.padEnd(45)} GID: ${info.gid}`);
    });
    if (REGISTER_TABS && !DRY_RUN) {
      console.log("   → Will register as candidate rows (see Apply section below).");
    } else {
      console.log(`   → Pass --register-tabs --apply to add catalog rows.`);
    }
  }
  console.log("");

  // 3. Missing tabs (required)
  console.log(`── 3. Catalog rows referencing missing tabs ──`);
  console.log(`   Required (required_for_execution=TRUE): ${missingRequired.length}`);
  console.log(`   Optional:                               ${missingOptional.length}`);
  if (missingRequired.length) {
    console.log("");
    console.log("   ⚠  Required missing tabs — manual decision needed:");
    console.log("      Options: set file_id to the correct workbook, create the tab,");
    console.log("      set required_for_execution=FALSE, or change surface_type to file/doc.");
    missingRequired.slice(0, 15).forEach((r) => {
      const sid = normalizeId(r.file_id);
      const wb  = sid && sid !== REGISTRY_ID ? ` [workbook: ${sid}]` : "";
      console.log(`   row ${String(r._rowIndex).padEnd(4)}  ${normalizeId(r.surface_id).padEnd(55)} ${normalizeTabName(r.worksheet_name)}${wb}`);
    });
    if (missingRequired.length > 15) {
      console.log(`   ... and ${missingRequired.length - 15} more`);
    }
  }
  if (missingOptional.length) {
    console.log("");
    console.log("   Optional missing tabs (not required for execution):");
    missingOptional.slice(0, 10).forEach((r) => {
      const sid = normalizeId(r.file_id);
      const wb  = sid && sid !== REGISTRY_ID ? ` [workbook: ${sid}]` : "";
      console.log(`   row ${String(r._rowIndex).padEnd(4)}  ${normalizeId(r.surface_id).padEnd(55)} ${normalizeTabName(r.worksheet_name)}${wb}`);
    });
    if (missingOptional.length > 10) {
      console.log(`   ... and ${missingOptional.length - 10} more`);
    }
  }
  console.log("");

  // 3b. GID mismatches
  console.log(`── 3b. GID mismatches for existing tabs (${gidMismatches.length} found) ──`);
  if (gidMismatches.length === 0) {
    console.log("   None.");
  } else {
    gidMismatches.forEach((r) => {
      const wn     = normalizeTabName(r.worksheet_name);
      const liveGid = tabMapFor(r)[wn]?.gid ?? "?";
      console.log(`   ${wn.padEnd(45)} catalog GID: ${normalizeId(r.worksheet_gid).padEnd(12)} live GID: ${liveGid}`);
    });
  }
  console.log("");

  // 4. Column count mismatches
  console.log(`── 4. expected_column_count mismatches (${columnCountMismatches.length} found) ──`);
  if (columnCountMismatches.length === 0) {
    console.log("   None.");
  } else {
    const maxWn = Math.max(...columnCountMismatches.map((m) => m.worksheet_name.length), 20);
    columnCountMismatches.forEach((m) => {
      const dir = m.delta > 0 ? `+${m.delta}` : String(m.delta);
      console.log(`   ${m.worksheet_name.padEnd(maxWn + 2)}  catalog: ${String(m.catalog_count).padEnd(4)}  live: ${String(m.live_count).padEnd(4)}  (${dir})`);
    });
    if (REFRESH_COLUMNS && !DRY_RUN) {
      console.log("   → Will update expected_column_count to match live headers.");
    } else {
      console.log("   → Pass --refresh-columns --apply to update catalog.");
    }
  }
  console.log("");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("━━━ Summary ━━━");
  console.log(`  Duplicate surface_ids      : ${duplicateIds.length}  (manual fix required)`);
  console.log(`  Unregistered tabs          : ${unregisteredTabs.length}`);
  console.log(`  Missing tabs (required)    : ${missingRequired.length}  (manual decision)`);
  console.log(`  Missing tabs (optional)    : ${missingOptional.length}`);
  console.log(`  GID mismatches             : ${gidMismatches.length}`);
  console.log(`  Column count mismatches    : ${columnCountMismatches.length}`);
  console.log("");

  if (DRY_RUN) {
    console.log("No changes written (dry-run). Pass --apply with --refresh-columns and/or --register-tabs to write.");
    process.exit(0);
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  console.log("━━━ Applying fixes ━━━");
  console.log("");

  let totalWrites = 0;

  // Fix A: delete duplicate surface_id rows (keep first occurrence, delete later ones)
  if (FIX_DUPLICATES) {
    if (duplicateIds.length === 0) {
      console.log("  ✓ Duplicates: nothing to fix.");
    } else {
      console.log(`  Fixing ${duplicateIds.length} duplicate surface_id(s)...`);
      let deleted = 0;
      // Resolve catalog tab sheetId
      const catalogGid = tabMap[CATALOG_SHEET]?.gid;
      if (!catalogGid) {
        console.log("  ✗ Cannot resolve sheetId for catalog tab — skipping.");
      } else {
        for (const { id } of duplicateIds) {
          const rows = catalogRows
            .filter((r) => normalizeId(r.surface_id) === id)
            .sort((a, b) => a._rowIndex - b._rowIndex);
          // Delete all but the first, in reverse order so earlier deletions don't shift later indices
          const toDelete = rows.slice(1).sort((a, b) => b._rowIndex - a._rowIndex);
          for (const row of toDelete) {
            const zeroBasedRow = row._rowIndex - 1; // _rowIndex is 1-based (1 = header)
            try {
              await sheets.spreadsheets.batchUpdate({
                spreadsheetId: REGISTRY_ID,
                requestBody: {
                  requests: [{
                    deleteDimension: {
                      range: {
                        sheetId: parseInt(catalogGid, 10),
                        dimension: "ROWS",
                        startIndex: zeroBasedRow,
                        endIndex: zeroBasedRow + 1,
                      },
                    },
                  }],
                },
              });
              console.log(`  ✓  Deleted duplicate row ${row._rowIndex} for surface_id: ${id}`);
              deleted++;
              totalWrites++;
            } catch (err) {
              console.log(`  ✗  Failed to delete row ${row._rowIndex} for ${id}: ${err.message}`);
            }
          }
        }
      }
      console.log(`  Duplicates fixed: ${deleted} row(s) deleted`);
    }
    console.log("");
  }

  // Fix B: refresh expected_column_count
  if (REFRESH_COLUMNS) {
    if (COL.expected_column_count === null) {
      console.log("  ✗ Cannot refresh columns — expected_column_count column not found in catalog header.");
    } else if (columnCountMismatches.length === 0) {
      console.log("  ✓ Column counts: nothing to update.");
    } else {
      console.log(`  Refreshing expected_column_count for ${columnCountMismatches.length} tab(s)...`);
      let updated = 0;
      for (const m of columnCountMismatches) {
        try {
          await updateCell(
            sheets,
            REGISTRY_ID,
            CATALOG_SHEET,
            COL.expected_column_count,
            m._rowIndex,
            m.live_count
          );
          console.log(`  ✓  ${m.worksheet_name}: ${m.catalog_count} → ${m.live_count}`);
          updated++;
          totalWrites++;
        } catch (err) {
          console.log(`  ✗  ${m.worksheet_name}: update failed — ${err.message}`);
        }
      }
      console.log(`  Column counts updated: ${updated}/${columnCountMismatches.length}`);
    }
    console.log("");
  }

  // Fix C: register unregistered tabs
  if (REGISTER_TABS) {
    if (unregisteredTabs.length === 0) {
      console.log("  ✓ Tab registration: nothing to register.");
    } else {
      console.log(`  Registering ${unregisteredTabs.length} unregistered tab(s)...`);
      const newRows = unregisteredTabs.map((tabName) => {
        const info = tabMap[tabName];
        const surfaceKey = tabName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        return {
          surface_id: `surface.${surfaceKey}`,
          surface_name: tabName,
          worksheet_name: tabName,
          worksheet_gid: info.gid,
          active_status: "active",
          authority_status: "candidate",
          required_for_execution: "FALSE",
          schema_ref: "",
          schema_version: "",
          header_signature: "",
          expected_column_count: "",
          binding_mode: "gid_based",
          sheet_role: "candidate_surface",
          audit_mode: "pending",
        };
      });

      try {
        await appendCatalogRows(sheets, REGISTRY_ID, catalogHeader, newRows);
        newRows.forEach((r) => {
          console.log(`  ✓  ${r.worksheet_name.padEnd(45)} → surface_id: ${r.surface_id}`);
        });
        totalWrites += newRows.length;
        console.log(`  Registered: ${newRows.length} tab(s)`);
      } catch (err) {
        console.log(`  ✗ Registration failed: ${err.message}`);
      }
    }
    console.log("");
  }

  // Fix C2: correct worksheet_gid from live tab list
  if (FIX_GIDS) {
    if (COL.worksheet_gid === null) {
      console.log("  ✗ Cannot fix GIDs — worksheet_gid column not found in catalog header.");
    } else if (gidMismatches.length === 0) {
      console.log("  ✓ GIDs: nothing to fix.");
    } else {
      console.log(`  Correcting worksheet_gid for ${gidMismatches.length} row(s)...`);
      let fixed = 0;
      for (const r of gidMismatches) {
        const wn      = normalizeTabName(r.worksheet_name);
        const liveGid = tabMapFor(r)[wn]?.gid;
        if (!liveGid) {
          console.log(`  ✗  row ${r._rowIndex}  ${wn}: live GID not found — skipping`);
          continue;
        }
        try {
          await updateCell(sheets, REGISTRY_ID, CATALOG_SHEET, COL.worksheet_gid, r._rowIndex, liveGid);
          console.log(`  ✓  row ${r._rowIndex}  ${wn.padEnd(45)} ${normalizeId(r.worksheet_gid)} → ${liveGid}`);
          fixed++;
          totalWrites++;
        } catch (err) {
          console.log(`  ✗  row ${r._rowIndex}  ${wn}: ${err.message}`);
        }
      }
      console.log(`  GIDs fixed: ${fixed}/${gidMismatches.length}`);
    }
    console.log("");
  }

  // Fix D: demote required missing tabs to required_for_execution=FALSE
  if (DEMOTE_REQUIRED) {
    if (COL.required_for_execution === null) {
      console.log("  ✗ Cannot demote — required_for_execution column not found in catalog header.");
    } else if (missingRequired.length === 0) {
      console.log("  ✓ Demote required: nothing to update.");
    } else {
      console.log(`  Demoting ${missingRequired.length} required missing tab(s) to required_for_execution=FALSE...`);
      let demoted = 0;
      for (const r of missingRequired) {
        try {
          await updateCell(sheets, REGISTRY_ID, CATALOG_SHEET, COL.required_for_execution, r._rowIndex, "FALSE");
          console.log(`  ✓  row ${r._rowIndex}  ${normalizeId(r.surface_id)}  required_for_execution → FALSE`);
          demoted++;
          totalWrites++;
        } catch (err) {
          console.log(`  ✗  row ${r._rowIndex}  ${normalizeId(r.surface_id)}: ${err.message}`);
        }
      }
      console.log(`  Demoted: ${demoted}/${missingRequired.length}`);
    }
    console.log("");
  }

  // Fix E: mark optional missing tabs as retired
  if (RETIRE_DELETED) {
    if (COL.active_status === null) {
      console.log("  ✗ Cannot retire — active_status column not found in catalog header.");
    } else if (missingOptional.length === 0) {
      console.log("  ✓ Retire deleted tabs: nothing to update.");
    } else {
      console.log(`  Marking ${missingOptional.length} deleted optional tab(s) as retired...`);
      let retired = 0;
      for (const r of missingOptional) {
        try {
          await updateCell(sheets, REGISTRY_ID, CATALOG_SHEET, COL.active_status, r._rowIndex, "retired");
          console.log(`  ✓  row ${r._rowIndex}  ${normalizeId(r.surface_id)}  active_status → retired`);
          retired++;
          totalWrites++;
        } catch (err) {
          console.log(`  ✗  row ${r._rowIndex}  ${normalizeId(r.surface_id)}: ${err.message}`);
        }
      }
      console.log(`  Retired: ${retired}/${missingOptional.length}`);
    }
    console.log("");
  }

  console.log(`━━━ Done — ${totalWrites} catalog cells/rows written ━━━`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
