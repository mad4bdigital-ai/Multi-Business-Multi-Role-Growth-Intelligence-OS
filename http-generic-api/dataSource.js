import * as sql from "./sqlAdapter.js";

// DATA_SOURCE controls routing:
//   sheets → Google Sheets only        (current default — zero behaviour change)
//   dual   → SQL primary, Sheets fallback on reads + async mirror on writes
//   sql    → SQL reads, async Sheets mirror on writes (Sheets stays human-readable)
const MODE = (process.env.DATA_SOURCE || "sheets").trim().toLowerCase();

// ── Sheets passthrough (injected by server.js via init()) ─────────────────────
let _readSheets  = null;
let _appendSheets = null;
let _updateSheets = null;
let _deleteSheets = null;

export function init({ readSheets, appendSheets, updateSheets, deleteSheets }) {
  _readSheets   = readSheets;
  _appendSheets = appendSheets;
  _updateSheets = updateSheets;
  _deleteSheets = deleteSheets;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function readTable(sheetName, opts = {}) {
  if (MODE === "sheets") return _readSheets(sheetName, opts);

  try {
    const rows = await sql.readTable(sheetName);
    if (rows.length > 0) return rows;
    // SQL empty (pre-seed) → fall through to Sheets
  } catch (err) {
    _warn("readTable", sheetName, err);
  }

  return _readSheets(sheetName, opts);
}

export async function findRows(sheetName, col, value) {
  if (MODE === "sheets") {
    const all = await _readSheets(sheetName, {});
    return all.filter((r) => r[col] === value);
  }

  try {
    return await sql.findRows(sheetName, col, value);
  } catch (err) {
    _warn("findRows", sheetName, err);
    const all = await _readSheets(sheetName, {});
    return all.filter((r) => r[col] === value);
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────
export async function appendRow(sheetName, rowObject, sheetsArgs = {}) {
  if (MODE === "sheets") return _appendSheets(sheetName, rowObject, sheetsArgs);

  const result = await sql.appendRow(sheetName, rowObject);
  _mirrorAppend(sheetName, rowObject, sheetsArgs);
  return result;
}

export async function updateRow(sheetName, rowObject, id, sheetsArgs = {}) {
  if (MODE === "sheets") return _updateSheets(sheetName, rowObject, sheetsArgs);

  await sql.updateRow(sheetName, rowObject, id);
  _mirrorUpdate(sheetName, rowObject, sheetsArgs);
}

export async function deleteRow(sheetName, id, sheetsArgs = {}) {
  if (MODE === "sheets") return _deleteSheets(sheetName, sheetsArgs);

  await sql.deleteRow(sheetName, id);
  _mirrorDelete(sheetName, sheetsArgs);
}

// ── Async Sheets mirror (non-blocking — never fails the request) ──────────────
function _mirrorAppend(sheetName, rowObject, sheetsArgs) {
  if (!_appendSheets) return;
  Promise.resolve()
    .then(() => _appendSheets(sheetName, rowObject, sheetsArgs))
    .catch((err) => _warn("mirror:append", sheetName, err));
}

function _mirrorUpdate(sheetName, rowObject, sheetsArgs) {
  if (!_updateSheets) return;
  Promise.resolve()
    .then(() => _updateSheets(sheetName, rowObject, sheetsArgs))
    .catch((err) => _warn("mirror:update", sheetName, err));
}

function _mirrorDelete(sheetName, sheetsArgs) {
  if (!_deleteSheets) return;
  Promise.resolve()
    .then(() => _deleteSheets(sheetName, sheetsArgs))
    .catch((err) => _warn("mirror:delete", sheetName, err));
}

function _warn(op, sheetName, err) {
  console.warn(`[dataSource] ${op} "${sheetName}" fallback/mirror failed: ${err.message}`);
}

export { MODE as DATA_SOURCE_MODE };
