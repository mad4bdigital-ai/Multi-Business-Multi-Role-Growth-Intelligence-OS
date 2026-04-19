// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { google } from "googleapis";

export async function getGoogleClients() {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

export async function getGoogleClientsForSpreadsheet(spreadsheetId) {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  if (!String(spreadsheetId || "").trim()) {
    const err = new Error("Missing required spreadsheet id for governed sink.");
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    spreadsheetId: String(spreadsheetId || "").trim(),
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

export async function fetchRange(sheets, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    range
  });
  return response.data.values || [];
}

export async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const row2 = (values[1] || []).map(v => String(v || "").trim());

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

export async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title,index)"
  });

  const map = {};
  for (const sheet of response.data.sheets || []) {
    const props = sheet?.properties || {};
    const title = String(props.title || "").trim();
    if (!title) continue;
    map[title] = {
      sheetId: props.sheetId,
      title,
      index: props.index
    };
  }
  return map;
}

export async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  const sheetMap = await getSpreadsheetSheetMap(sheets, spreadsheetId);
  if (!sheetMap[sheetName]) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: String(spreadsheetId || "").trim(),
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "1:2")
  });

  const values = response.data.values || [];
  const existingHeader = (values[0] || []).map(v => String(v || "").trim()).filter(Boolean);

  if (!existingHeader.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: String(spreadsheetId || "").trim(),
      range: toValuesApiRange(sheetName, "A1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [columns]
      }
    });
    return { created: true, header_written: true };
  }

  const existingSignature = computeHeaderSignature(existingHeader);
  const expectedSignature = computeHeaderSignature(columns);
  if (existingSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch.`);
    err.code = "sheet_schema_mismatch";
    err.status = 409;
    throw err;
  }

  return { created: false, header_written: false };
}
