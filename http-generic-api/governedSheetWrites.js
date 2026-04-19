export function detectUnsafeColumnsFromRow2(header = [], row2 = []) {
  const unsafe = new Set();

  for (let i = 0; i < header.length; i += 1) {
    const colName = String(header[i] || "").trim();
    const sample = String(row2[i] || "").trim();

    if (!colName) continue;

    const looksFormula =
      sample.startsWith("=") ||
      sample.includes("ARRAYFORMULA(") ||
      sample.includes("=arrayformula(");

    if (looksFormula) {
      unsafe.add(colName);
    }
  }

  return unsafe;
}

export function buildGovernedWritePlan(args = {}) {
  const protectedColumns = args.protectedColumns || new Set();
  const unsafeFromRow2 = detectUnsafeColumnsFromRow2(args.header, args.row2);

  const safeColumns = [];
  const unsafeColumns = [];

  for (const col of args.requestedColumns || []) {
    if (!args.header.includes(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (protectedColumns.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (unsafeFromRow2.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    safeColumns.push(col);
  }

  return {
    header: args.header || [],
    row2: args.row2 || [],
    safeColumns,
    unsafeColumns
  };
}

export function assertExecutionLogFormulaColumnsProtected(plan = {}, deps = {}) {
  const sheetName = String(deps.sheetName || "Execution Log Unified");
  const missingRawColumns = (deps.executionLogUnifiedRawWritebackColumns || []).filter(
    col => !(plan.header || []).includes(col)
  );

  if (missingRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${missingRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

export function buildFullWidthGovernedRow(header = [], safeColumns = [], rowObject = {}, deps = {}) {
  const toSheetCellValue = deps.toSheetCellValue || (value => value);
  const safeSet = new Set(safeColumns);
  return header.map(col => {
    const columnName = String(col || "").trim();
    if (!columnName) return "";
    if (!safeSet.has(columnName)) return "";
    return toSheetCellValue(rowObject[columnName]);
  });
}

export function buildColumnSliceRow(columns = [], rowObject = {}, deps = {}) {
  const toSheetCellValue = deps.toSheetCellValue || (value => value);
  return columns.map(col => toSheetCellValue(rowObject[col]));
}

export function columnLetter(colIndex) {
  let letter = "";
  while (colIndex > 0) {
    const temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

export async function updateSheetRowGoverned(args = {}, deps = {}) {
  const {
    sheets,
    spreadsheetId,
    sheetName,
    header,
    safeColumns,
    rowObject,
    targetRowNumber,
    preflight = null
  } = args;

  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} update requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const range = `${String(sheetName || "").trim()}!A${targetRowNumber}:${columnLetter(header.length)}${targetRowNumber}`;
  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject, deps);

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range,
    valueInputOption: "RAW",
    requestBody: {
      majorDimension: "ROWS",
      values: [fullRow]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

export async function deleteSheetRowGoverned(args = {}) {
  const {
    sheets,
    spreadsheetId,
    sheetName,
    targetRowNumber,
    preflight = null
  } = args;

  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} delete requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title)"
  });

  const sheet = (meta.data.sheets || []).find(
    item => String(item?.properties?.title || "").trim() === String(sheetName || "").trim()
  );

  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    const err = new Error(`Sheet not found for delete: ${sheetName}`);
    err.code = "sheet_not_found";
    err.status = 404;
    throw err;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: String(spreadsheetId || "").trim(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: Number(sheet.properties.sheetId),
              dimension: "ROWS",
              startIndex: targetRowNumber - 1,
              endIndex: targetRowNumber
            }
          }
        }
      ]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

export async function appendSheetRowGoverned(args = {}, deps = {}) {
  const {
    sheets,
    spreadsheetId,
    sheetName,
    header,
    safeColumns,
    rowObject,
    preflight = null
  } = args;

  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject, deps);

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [fullRow]
    }
  });

  return {
    preflight
  };
}

export async function appendExecutionLogUnifiedRowGoverned(args = {}, deps = {}) {
  const {
    sheets,
    spreadsheetId,
    sheetName,
    header,
    rowObject,
    preflight = null
  } = args;

  const requiredRawColumns = (deps.executionLogUnifiedRawWritebackColumns || []).filter(
    col => !header.includes(col)
  );

  if (requiredRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${requiredRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(
    header,
    deps.executionLogUnifiedColumns || [],
    rowObject,
    deps
  );

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: false,
    requestBody: {
      values: [fullRow]
    }
  });

  const updatedRange = String(appendResponse?.data?.updates?.updatedRange || "").trim();
  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
  const appendedRowNumber = rowMatch ? Number(rowMatch[1]) : NaN;

  if (!Number.isFinite(appendedRowNumber) || appendedRowNumber < 2) {
    const err = new Error(
      `${sheetName} append succeeded but appended row number could not be determined.`
    );
    err.code = "sheet_append_row_unknown";
    err.status = 500;
    throw err;
  }

  const rawWritebackValues = buildColumnSliceRow(
    deps.executionLogUnifiedRawWritebackColumns || [],
    rowObject,
    deps
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toValuesApiRange(
      sheetName,
      `${deps.executionLogUnifiedRawWritebackStartColumn}${appendedRowNumber}:${deps.executionLogUnifiedRawWritebackEndColumn}${appendedRowNumber}`
    ),
    valueInputOption: "RAW",
    requestBody: {
      values: [rawWritebackValues]
    }
  });

  return { appendedRowNumber, preflight };
}

export async function performGovernedSheetMutation(args = {}, deps = {}) {
  const {
    spreadsheetId,
    sheetName,
    mutationType = "append",
    rowObject = {},
    safeColumns = [],
    header = [],
    targetRowNumber = null,
    scanRangeA1 = "A:Z"
  } = args;

  const { sheets } = await deps.getGoogleClientsForSpreadsheet(spreadsheetId);

  const preflight = await deps.enforceGovernedMutationPreflight(
    {
      spreadsheetId,
      sheetName,
      rowObject,
      mutationType,
      scanRangeA1,
      targetRowNumber
    },
    {
      loadLiveGovernedChangeControlPolicies: deps.loadLiveGovernedChangeControlPolicies,
      governedPolicyEnabled: deps.governedPolicyEnabled,
      readRelevantExistingRowWindow: deps.readRelevantExistingRowWindow,
      findSemanticDuplicateRows: deps.findSemanticDuplicateRows,
      highRiskGovernedSheets: deps.highRiskGovernedSheets,
      executionLogUnifiedSheetName: deps.executionLogUnifiedSheetName
    }
  );

  if (mutationType === "append") {
    if (sheetName === deps.executionLogUnifiedSheetName) {
      return appendExecutionLogUnifiedRowGoverned(
        {
          sheets,
          spreadsheetId,
          sheetName,
          header,
          rowObject,
          preflight
        },
        deps
      );
    }

    return appendSheetRowGoverned(
      {
        sheets,
        spreadsheetId,
        sheetName,
        header,
        safeColumns,
        rowObject,
        preflight
      },
      deps
    );
  }

  if (mutationType === "update" || mutationType === "repair") {
    return updateSheetRowGoverned(
      {
        sheets,
        spreadsheetId,
        sheetName,
        header,
        safeColumns,
        rowObject,
        targetRowNumber: preflight.targetRowNumber,
        preflight
      },
      deps
    );
  }

  if (mutationType === "delete") {
    return deleteSheetRowGoverned({
      sheets,
      spreadsheetId,
      sheetName,
      targetRowNumber: preflight.targetRowNumber,
      preflight
    });
  }

  const err = new Error(`Unsupported governed mutation type: ${mutationType}`);
  err.code = "unsupported_governed_mutation_type";
  err.status = 400;
  throw err;
}
