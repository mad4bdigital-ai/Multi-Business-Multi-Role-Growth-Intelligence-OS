import crypto from "node:crypto";

export function toSheetCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function toA1Start(sheetName, deps = {}) {
  return deps.toValuesApiRange(sheetName, "A1");
}

export async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1, deps = {}) {
  const { getGoogleClientsForSpreadsheet, headerMap } = deps;
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(value => String(value || "").trim());
  const row2 = (values[1] || []).map(value => String(value || "").trim());

  if (!header.length) {
    const err = new Error(`${sheetName} header row is empty.`);
    err.code = "sheet_header_missing";
    err.status = 500;
    throw err;
  }

  return {
    header,
    row2,
    headerMap: headerMap(header, sheetName),
    columnCount: header.length
  };
}

export function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return (columns || []).map(value => String(value || "").trim()).join("|");
}

export function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return Array.isArray(fallbackColumns) ? fallbackColumns.length : 0;
}

export async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}, deps = {}) {
  const row = await deps.getRegistrySurfaceCatalogRowBySurfaceId(surfaceId);

  if (!row) {
    return {
      source: "fallback_constant",
      surface_id: surfaceId,
      schema_ref: fallback.schema_ref || "",
      schema_version: fallback.schema_version || "",
      header_signature: buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
      expected_column_count: Array.isArray(fallback.columns) ? fallback.columns.length : 0,
      binding_mode: fallback.binding_mode || "constant_fallback",
      sheet_role: fallback.sheet_role || "",
      audit_mode: fallback.audit_mode || ""
    };
  }

  return {
    source: "registry_surface_catalog",
    surface_id: row.surface_id,
    schema_ref: row.schema_ref,
    schema_version: row.schema_version,
    header_signature:
      row.header_signature || buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
    expected_column_count: normalizeExpectedColumnCount(
      row.expected_column_count,
      fallback.columns || []
    ),
    binding_mode: row.binding_mode || fallback.binding_mode || "",
    sheet_role: row.sheet_role || fallback.sheet_role || "",
    audit_mode: row.audit_mode || fallback.audit_mode || "",
    authority_status: row.authority_status || "",
    active_status: row.active_status || "",
    required_for_execution: row.required_for_execution || "",
    legacy_surface_containment_required: row.legacy_surface_containment_required || ""
  };
}

export function assertHeaderMatchesSurfaceMetadata(args = {}, deps = {}) {
  const { assertCanonicalHeaderExact } = deps;
  const sheetName = String(args.sheetName || "sheet").trim();
  const actualHeader = (args.actualHeader || []).map(value => String(value || "").trim());
  const metadata = args.metadata || {};
  const fallbackColumns = args.fallbackColumns || [];

  const expectedColumnCount = normalizeExpectedColumnCount(
    metadata.expected_column_count,
    fallbackColumns
  );

  const expectedSignature =
    String(metadata.header_signature || "").trim() ||
    buildExpectedHeaderSignatureFromCanonical(fallbackColumns);

  const actualSignature = actualHeader.join("|");

  if (expectedColumnCount && actualHeader.length !== expectedColumnCount) {
    const err = new Error(
      `${sheetName} header column count mismatch from surface metadata. expected=${expectedColumnCount} actual=${actualHeader.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (expectedSignature && actualSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch from surface metadata.`);
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (String(metadata.audit_mode || "").trim() === "exact_header_match") {
    assertCanonicalHeaderExact(actualHeader, fallbackColumns, sheetName);
  }

  return true;
}

export function computeHeaderSignature(header = []) {
  return crypto
    .createHash("sha256")
    .update(header.map(value => String(value || "").trim()).join("|"))
    .digest("hex");
}

export function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  const missing = required.filter(col => !header.includes(col));
  if (missing.length) {
    const err = new Error(`${sheetName} missing required columns: ${missing.join(", ")}`);
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}
