// appAdapters/googleDrive.js — Google Drive OAuth2 adapter.
// Scopes: drive.readonly (read), drive.file (write files the app created),
//         userinfo.email (account label).

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

async function driveGet(path, token, params = {}) {
  const url = new URL(`${DRIVE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Drive API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function drivePost(path, token, body, params = {}) {
  const url = new URL(`${DRIVE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Drive API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const googleDriveAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "list_files",   auto_approve: true  },
      { action_key: "read_file",    auto_approve: true  },
      { action_key: "search_files", auto_approve: true  },
      { action_key: "write_file",   auto_approve: false },
      { action_key: "create_folder",auto_approve: false },
    ];
  },

  buildAuthUrl(config, state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id",     config.client_id);
    url.searchParams.set("redirect_uri",  config.redirect_uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
    url.searchParams.set("access_type",   "offline");
    url.searchParams.set("prompt",        "consent"); // force refresh_token
    url.searchParams.set("state",         state);
    return url.toString();
  },

  async exchangeCode(code, config) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     config.client_id,
        client_secret: config.client_secret,
        redirect_uri:  config.redirect_uri,
        grant_type:    "authorization_code",
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
    return res.json();
  },

  async refreshAccessToken(creds, config) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: creds.refresh_token,
        client_id:     config.client_id,
        client_secret: config.client_secret,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
    return res.json();
  },

  async testConnection(creds) {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${creds.access_token}` },
    }).then(r => r.json());
    return {
      ok: !!info.email,
      account_label:    info.email    || null,
      account_metadata: { name: info.name, picture: info.picture, id: info.id },
    };
  },

  async call(action_key, args, creds) {
    const token = creds.access_token;

    switch (action_key) {

      case "list_files": {
        const { folder_id, page_size = 20, fields } = args;
        const q = folder_id ? `'${folder_id}' in parents` : undefined;
        const data = await driveGet("/files", token, {
          pageSize: page_size,
          fields:   fields || "files(id,name,mimeType,modifiedTime,size,webViewLink)",
          ...(q ? { q } : {}),
        });
        return { ok: true, result: data };
      }

      case "read_file": {
        const { file_id } = args;
        if (!file_id) throw new Error("file_id required");
        // For Google Docs/Sheets/Slides export as text; for binary use alt=media
        const meta = await driveGet(`/files/${file_id}`, token, { fields: "id,name,mimeType" });
        const isDoc = meta.mimeType?.includes("google-apps");
        if (isDoc) {
          const exportMime = meta.mimeType.includes("document") ? "text/plain"
                           : meta.mimeType.includes("spreadsheet") ? "text/csv"
                           : "application/pdf";
          const res = await fetch(`${DRIVE_BASE}/files/${file_id}/export?mimeType=${encodeURIComponent(exportMime)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
          const content = await res.text();
          return { ok: true, result: { ...meta, content, export_mime: exportMime } };
        }
        const res = await fetch(`${DRIVE_BASE}/files/${file_id}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Download failed: ${await res.text()}`);
        const content = await res.text();
        return { ok: true, result: { ...meta, content } };
      }

      case "search_files": {
        const { query, page_size = 20 } = args;
        if (!query) throw new Error("query required");
        const data = await driveGet("/files", token, {
          q:         `fullText contains '${query.replace(/'/g, "\\'")}'`,
          pageSize:  page_size,
          fields:    "files(id,name,mimeType,modifiedTime,webViewLink)",
        });
        return { ok: true, result: data };
      }

      case "write_file": {
        const { name, content, folder_id, mime_type = "text/plain" } = args;
        if (!name || content === undefined) throw new Error("name and content required");
        const meta = { name, ...(folder_id ? { parents: [folder_id] } : {}) };
        const boundary = "boundary_" + Date.now();
        const body = [
          `--${boundary}`,
          "Content-Type: application/json",
          "",
          JSON.stringify(meta),
          `--${boundary}`,
          `Content-Type: ${mime_type}`,
          "",
          content,
          `--${boundary}--`,
        ].join("\r\n");
        const res = await fetch(`${UPLOAD_BASE}/files?uploadType=multipart`, {
          method: "POST",
          headers: {
            Authorization:  `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        });
        if (!res.ok) throw new Error(`Write failed: ${await res.text()}`);
        return { ok: true, result: await res.json() };
      }

      case "create_folder": {
        const { name, parent_id } = args;
        if (!name) throw new Error("name required");
        const data = await drivePost("/files", token, {
          name,
          mimeType: "application/vnd.google-apps.folder",
          ...(parent_id ? { parents: [parent_id] } : {}),
        });
        return { ok: true, result: data };
      }

      default:
        throw new Error(`google_drive: unknown action '${action_key}'`);
    }
  },
};
