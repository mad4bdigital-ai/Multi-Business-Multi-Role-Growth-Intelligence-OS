// appAdapters/makecom.js — Make.com (formerly Integromat) adapter.
// Supports: webhook triggers (fire-and-forget) and REST API scenario management.
//
// Auth: api_key stored in encrypted_credentials.api_key
// connection fields:
//   api_base_url     — Make.com zone base, e.g. https://eu1.make.com/api/v2
//   webhook_url      — default webhook URL for trigger_webhook action
//   makecom_team_id  — team ID for scenario listing

async function makeReq(base, apiKey, path, { method = "GET", body } = {}) {
  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Make.com API returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export const makecomAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "trigger_webhook",   auto_approve: true  },
      { action_key: "list_scenarios",    auto_approve: true  },
      { action_key: "run_scenario",      auto_approve: false },
      { action_key: "get_scenario",      auto_approve: true  },
    ];
  },

  buildAuthUrl() { throw new Error("Make.com connections use API key, not OAuth"); },
  async exchangeCode() { throw new Error("Make.com connections use API key, not OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const base = connection.api_base_url || "https://eu1.make.com/api/v2";
    const apiKey = creds.api_key;
    if (!apiKey) return { ok: false, account_label: null, account_metadata: { error: "api_key not set" } };
    try {
      const data = await makeReq(base, apiKey, "/users/me");
      const label = data?.name || data?.email || base;
      return { ok: true, account_label: label, account_metadata: { base, user: data } };
    } catch (e) {
      return { ok: false, account_label: base, account_metadata: { base, error: e.message } };
    }
  },

  async call(action_key, args, creds, connection) {
    const apiKey = creds.api_key;
    const base   = connection.api_base_url || "https://eu1.make.com/api/v2";

    switch (action_key) {

      case "trigger_webhook": {
        // POST to a Make.com webhook URL — simplest integration
        const url = args.webhook_url || connection.webhook_url;
        if (!url) throw new Error("webhook_url required for trigger_webhook");
        const payload = args.payload || {};
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const text = await res.text().catch(() => "");
        let result;
        try { result = JSON.parse(text); } catch { result = { raw: text }; }
        if (!res.ok) throw new Error(`Make.com webhook returned HTTP ${res.status}: ${text.slice(0, 200)}`);
        return { ok: true, result, status: res.status };
      }

      case "list_scenarios": {
        const teamId = args.team_id || connection.makecom_team_id;
        if (!teamId) throw new Error("team_id required for list_scenarios");
        const data = await makeReq(base, apiKey, `/scenarios?teamId=${teamId}`);
        return { ok: true, result: data.scenarios || data };
      }

      case "get_scenario": {
        const { scenario_id } = args;
        if (!scenario_id) throw new Error("scenario_id required");
        const data = await makeReq(base, apiKey, `/scenarios/${scenario_id}`);
        return { ok: true, result: data.scenario || data };
      }

      case "run_scenario": {
        const { scenario_id, data: runData = {} } = args;
        if (!scenario_id) throw new Error("scenario_id required");
        const result = await makeReq(base, apiKey, `/scenarios/${scenario_id}/run`, {
          method: "POST",
          body: runData,
        });
        return { ok: true, result };
      }

      default:
        throw new Error(`makecom: unknown action '${action_key}'`);
    }
  },
};
