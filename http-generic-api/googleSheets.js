import { google } from "googleapis";
import { REGISTRY_SPREADSHEET_ID } from "./config.js";
import { headerMap } from "./sheetHelpers.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

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

export async function assertSheetExistsInSpreadsheet(spreadsheetId, sheetName) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties.title"
  });

  const titles = (response.data.sheets || [])
    .map(s => String(s?.properties?.title || "").trim())
    .filter(Boolean);

  const normalizedSheetName = String(sheetName || "").trim();
  if (!titles.includes(normalizedSheetName)) {
    const err = new Error(
      `Governed sink sheet not found: ${normalizedSheetName}. Available sheets: ${titles.join(", ")}`
    );
    err.code = "sheet_not_found";
    err.status = 500;
    err.available_sheets = titles;
    err.requested_sheet = normalizedSheetName;
    err.spreadsheet_id = String(spreadsheetId || "").trim();
    throw err;
  }

  return titles;
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
    map[title] = { sheetId: props.sheetId, title, index: props.index };
  }
  return map;
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
