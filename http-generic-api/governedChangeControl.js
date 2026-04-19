export async function loadLiveGovernedChangeControlPolicies(deps = {}) {
  const {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    fetchRange,
    getCell,
    getGoogleClientsForSpreadsheet,
    headerMap,
    toValuesApiRange
  } = deps;

  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const rows = await fetchRange(sheets, toValuesApiRange(EXECUTION_POLICY_SHEET, "A:H"));

  if (!rows.length) {
    const err = new Error("Execution Policy Registry is empty.");
    err.code = "policy_registry_unavailable";
    err.status = 500;
    throw err;
  }

  const header = rows[0].map(value => String(value || "").trim());
  const map = headerMap(header, EXECUTION_POLICY_SHEET);
  const body = rows.slice(1);

  return body
    .filter(row => {
      const group = String(getCell(row, map, "policy_group") || "").trim();
      const active = String(getCell(row, map, "active") || "").trim().toUpperCase();
      return group === "Governed Change Control" && active === "TRUE";
    })
    .map(row => ({
      policy_group: String(getCell(row, map, "policy_group") || "").trim(),
      policy_key: String(getCell(row, map, "policy_key") || "").trim(),
      policy_value: String(getCell(row, map, "policy_value") || "").trim(),
      active: String(getCell(row, map, "active") || "").trim(),
      execution_scope: String(getCell(row, map, "execution_scope") || "").trim(),
      owner_module: String(getCell(row, map, "owner_module") || "").trim(),
      enforcement_required: String(getCell(row, map, "enforcement_required") || "").trim(),
      notes: String(getCell(row, map, "notes") || "").trim()
    }));
}

export function governedPolicyValue(policies = [], key = "", fallback = "") {
  const row = (policies || []).find(
    policy => String(policy.policy_key || "").trim() === String(key || "").trim()
  );
  return row ? String(row.policy_value || "").trim() : fallback;
}

export function governedPolicyEnabled(policies = [], key = "", fallback = false) {
  const fallbackText = fallback ? "TRUE" : "FALSE";
  return (
    String(governedPolicyValue(policies, key, fallbackText)).trim().toUpperCase() === "TRUE"
  );
}

export async function readRelevantExistingRowWindow(
  spreadsheetId,
  sheetName,
  scanRangeA1 = "A:Z",
  deps = {}
) {
  const { getGoogleClientsForSpreadsheet, headerMap, toValuesApiRange } = deps;
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, scanRangeA1)
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(value => String(value || "").trim());
  const rows = values.slice(1);

  return {
    header,
    headerMap: headerMap(header, sheetName),
    rows
  };
}

export function normalizeSemanticValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findSemanticDuplicateRows(header = [], rows = [], rowObject = {}) {
  if (!header.length || !rows.length) return [];

  const candidateKeys = Object.keys(rowObject).filter(
    key => normalizeSemanticValue(rowObject[key]) !== ""
  );

  if (!candidateKeys.length) return [];

  return rows
    .map((row, idx) => {
      let score = 0;
      for (const key of candidateKeys) {
        const colIdx = header.indexOf(key);
        if (colIdx === -1) continue;
        if (normalizeSemanticValue(row[colIdx]) === normalizeSemanticValue(rowObject[key])) {
          score += 1;
        }
      }
      return { rowNumber: idx + 2, score, row };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}
