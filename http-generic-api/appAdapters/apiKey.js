// appAdapters/apiKey.js — Generic REST API adapter with API key / bearer token auth.
// Supports: api_key (X-API-Key header), bearer_token (Authorization: Bearer),
//           basic_auth (Authorization: Basic base64(user:pass)).

export const apiKeyAdapter = {
  getDefaultGrants() {
    return [{ action_key: "call_api", auto_approve: true }];
  },

  buildAuthUrl() { throw new Error("api_key connections do not use OAuth"); },
  async exchangeCode() { throw new Error("api_key connections do not use OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const url = connection.api_base_url;
    if (!url) return { ok: false, account_label: null, account_metadata: { error: "api_base_url not set" } };
    return { ok: true, account_label: url, account_metadata: { base_url: url } };
  },

  async call(action_key, args, creds, connection) {
    if (action_key !== "call_api") throw new Error(`api_key: unknown action '${action_key}'`);

    const { endpoint, method = "GET", body, headers: extraHeaders = {}, params = {} } = args;
    const base = connection.api_base_url || "";
    if (!endpoint && !base) throw new Error("endpoint or api_base_url required");

    const url = new URL(endpoint?.startsWith("http") ? endpoint : `${base}${endpoint || ""}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers = { "Content-Type": "application/json", ...extraHeaders };

    // Auth header selection
    if (creds.api_key) {
      headers["X-API-Key"] = creds.api_key;
    } else if (creds.bearer_token || creds.access_token) {
      headers["Authorization"] = `Bearer ${creds.bearer_token || creds.access_token}`;
    } else if (creds.username && creds.password) {
      const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      ...(body && method !== "GET" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });

    const text = await res.text().catch(() => "");
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok) throw new Error(`API returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    return { ok: true, result, status: res.status };
  },
};
