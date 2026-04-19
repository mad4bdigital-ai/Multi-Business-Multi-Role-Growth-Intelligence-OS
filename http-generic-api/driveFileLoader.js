import YAML from "yaml";

function debugLog(...args) {
  if (String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true") {
    console.log(...args);
  }
}

async function readDriveFileRaw(drive, fileId, mimeType) {
  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    return String(exported.data || "");
  }
  const content = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "text" }
  );
  return String(content.data || "");
}

function parseFileContent(raw, name, mimeType) {
  if (name.endsWith(".json") || mimeType.includes("json")) {
    return JSON.parse(raw);
  }
  return YAML.parse(raw);
}

export async function fetchSchemaContract(drive, fileId) {
  if (!fileId) {
    const err = new Error("Missing openai_schema_file_id.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const { mimeType = "", name = "" } = meta.data || {};

  const raw = await readDriveFileRaw(drive, fileId, mimeType);

  let parsed;
  try {
    parsed = parseFileContent(raw, name, mimeType);
  } catch {
    const err = new Error(`Unable to parse schema file ${fileId}.`);
    err.code = "schema_parse_failed";
    err.status = 500;
    throw err;
  }

  return { fileId, name, mimeType, raw, parsed };
}

export async function fetchOAuthConfigContract(drive, action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  if (!fileId) return null;

  try {
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
    const { mimeType = "", name = "" } = meta.data || {};

    const raw = await readDriveFileRaw(drive, fileId, mimeType);

    let parsed;
    try {
      parsed = parseFileContent(raw, name, mimeType);
    } catch {
      parsed = JSON.parse(raw);
    }

    return { fileId, name, mimeType, raw, parsed };
  } catch (err) {
    debugLog("OAUTH_CONFIG_READ_FAILED:", {
      action_key: action.action_key,
      oauth_config_file_id: fileId,
      message: err?.message || String(err)
    });
    return null;
  }
}
