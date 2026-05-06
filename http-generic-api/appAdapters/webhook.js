// appAdapters/webhook.js — Generic outbound webhook adapter.
// Stores: webhook_url (non-secret) + optional webhook_secret (encrypted, for HMAC signing).

import { createHmac } from "node:crypto";

export const webhookAdapter = {
  getDefaultGrants() {
    return [{ action_key: "call_webhook", auto_approve: true }];
  },

  buildAuthUrl() { throw new Error("webhook connections do not use OAuth"); },
  async exchangeCode() { throw new Error("webhook connections do not use OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const url = connection.webhook_url;
    if (!url) return { ok: false, account_label: null, account_metadata: { error: "webhook_url not set" } };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ping", timestamp: Date.now() }),
    }).catch(e => ({ ok: false, statusText: e.message }));
    return {
      ok:               res.ok !== false,
      account_label:    url,
      account_metadata: { url, status: res.status || null },
    };
  },

  async call(action_key, args, creds, connection) {
    if (action_key !== "call_webhook") throw new Error(`webhook: unknown action '${action_key}'`);

    const url = connection.webhook_url;
    if (!url) throw new Error("webhook_url is not configured on this connection");

    const { payload = {}, method = "POST", headers: extraHeaders = {} } = args;
    const body = JSON.stringify(payload);

    const headers = { "Content-Type": "application/json", ...extraHeaders };

    // Sign with HMAC-SHA256 if secret is present (like GitHub webhooks)
    if (creds.webhook_secret) {
      const sig = createHmac("sha256", creds.webhook_secret).update(body).digest("hex");
      headers["X-Hub-Signature-256"] = `sha256=${sig}`;
    }

    const res = await fetch(url, { method, headers, body });
    const text = await res.text().catch(() => "");
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { ok: true, result, status: res.status };
  },
};
