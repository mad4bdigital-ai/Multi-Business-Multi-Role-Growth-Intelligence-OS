function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function hasFunction(value) {
  return typeof value === "function";
}

function buildHeaderMap(header = []) {
  const map = {};
  header.forEach((column, index) => {
    const key = normalize(column);
    if (key) map[key] = index;
  });
  return map;
}

function getCell(row = [], headerMap = {}, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(headerMap, name)) {
      return normalize(row[headerMap[name]]);
    }
  }
  return "";
}

async function readSheetRows({ sheetName, columnEnd = "AZ", dataEndRow = 2500, deps = {} }) {
  const spreadsheetId = deps.REGISTRY_SPREADSHEET_ID;
  if (!spreadsheetId) return [];

  if (!hasFunction(deps.getGoogleClientsForSpreadsheet)) return [];

  const { sheets } = await deps.getGoogleClientsForSpreadsheet(spreadsheetId);

  let values = [];
  if (hasFunction(deps.fetchChunkedTable)) {
    values = await deps.fetchChunkedTable(sheets, {
      spreadsheetId,
      sheetName,
      columnStart: "A",
      columnEnd,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow
    });
  } else {
    const escaped = sheetName.replace(/'/g, "''");
    const range = `'${escaped}'!A1:${columnEnd}${dataEndRow}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    values = response.data.values || [];
  }

  if (values.length < 2) return [];

  const header = values[0].map(value => normalize(value));
  const headerMap = hasFunction(deps.headerMap)
    ? deps.headerMap(header, sheetName)
    : buildHeaderMap(header);

  const cell = hasFunction(deps.getCell)
    ? (row, ...names) => {
        for (const name of names) {
          const value = deps.getCell(row, headerMap, name);
          if (normalize(value)) return normalize(value);
        }
        return "";
      }
    : (row, ...names) => getCell(row, headerMap, ...names);

  return values.slice(1).map(row => ({ row, cell }));
}

export async function loadSchemaOverlayJsonAssetById(assetId = "", deps = {}) {
  const normalizedAssetId = normalize(assetId);
  if (!normalizedAssetId) return null;

  if (!deps.REGISTRY_SPREADSHEET_ID || !hasFunction(deps.getGoogleClientsForSpreadsheet)) {
    return null;
  }

  const entries = await readSheetRows({
    sheetName: "JSON Asset Registry",
    columnEnd: "Q",
    dataEndRow: 3000,
    deps
  });

  for (const { row, cell } of entries) {
    const rowAssetId = cell(
      row,
      "asset_id",
      "json_asset_id",
      "asset_key",
      "schema_asset_key",
      "file_id",
      "schema_asset_id"
    );
    const rowStatus = lower(cell(row, "status", "active_status"));
    const validationStatus = lower(cell(row, "validation_status", "state"));
    const readinessState = lower(cell(row, "readiness_state", "readiness"));

    if (lower(rowAssetId) !== lower(normalizedAssetId)) continue;
    if (rowStatus && !["active", "ready", "validated"].includes(rowStatus)) continue;
    if (validationStatus && !["validated", "ready"].includes(validationStatus)) continue;
    if (readinessState && !["ready", "validated", "active"].includes(readinessState)) continue;

    const rawJson = cell(
      row,
      "json",
      "asset_json",
      "schema_json",
      "json_content",
      "content",
      "contract"
    );
    const parsed = parseJson(rawJson, null);

    if (!parsed) continue;

    return {
      asset_id: normalizedAssetId,
      asset_json: parsed,
      method: cell(row, "method"),
      path: cell(row, "path", "endpoint_path"),
      operation_id: cell(row, "operation_id", "operationId"),
      status: cell(row, "status", "active_status"),
      validation_status: cell(row, "validation_status", "state")
    };
  }

  return null;
}
