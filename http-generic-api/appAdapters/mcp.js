// appAdapters/mcp.js — Model Context Protocol adapter.
// Supports any MCP server via JSON-RPC 2.0 over HTTP (stateless or SSE).
// Auth: bearer token stored in encrypted_credentials.mcp_bearer.

import { randomUUID } from "node:crypto";

async function mcpCall(endpoint, token, method, params = {}) {
  const body = { jsonrpc: "2.0", id: randomUUID(), method, params };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`MCP server returned HTTP ${res.status}: ${await res.text().catch(() => "")}`);

  const ct = res.headers.get("content-type") || "";
  let data;
  if (ct.includes("event-stream")) {
    const text = await res.text();
    const lines = text.split("\n").filter(l => l.startsWith("data:"));
    if (!lines.length) throw new Error("MCP SSE: no data lines in response");
    data = JSON.parse(lines[lines.length - 1].slice(5).trim());
  } else {
    data = await res.json();
  }

  if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
  return data.result ?? data;
}

export const mcpAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "tools_list", auto_approve: true  },
      { action_key: "tools_call", auto_approve: true  },
    ];
  },

  buildAuthUrl() { throw new Error("MCP connections do not use OAuth"); },
  async exchangeCode() { throw new Error("MCP connections do not use OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const endpoint = connection.mcp_endpoint;
    if (!endpoint) return { ok: false, account_label: null, account_metadata: { error: "mcp_endpoint not set" } };
    try {
      const result = await mcpCall(endpoint, creds.mcp_bearer, "tools/list", {});
      const toolCount = Array.isArray(result?.tools) ? result.tools.length : "?";
      return {
        ok:               true,
        account_label:    endpoint,
        account_metadata: { endpoint, tool_count: toolCount },
      };
    } catch (e) {
      return { ok: false, account_label: endpoint, account_metadata: { endpoint, error: e.message } };
    }
  },

  async call(action_key, args, creds, connection) {
    const endpoint = connection.mcp_endpoint;
    if (!endpoint) throw new Error("mcp_endpoint is not configured on this connection");
    const token = creds.mcp_bearer || creds.access_token || creds.api_key || null;

    switch (action_key) {

      case "tools_list": {
        const result = await mcpCall(endpoint, token, "tools/list", {});
        return { ok: true, result };
      }

      case "tools_call": {
        const { tool, arguments: toolArgs = {}, name } = args;
        const toolName = tool || name;
        if (!toolName) throw new Error("tool (or name) required for tools_call");
        const result = await mcpCall(endpoint, token, "tools/call", {
          name: toolName,
          arguments: toolArgs,
        });
        return { ok: true, result };
      }

      // Resources support (optional MCP capability)
      case "resources_list": {
        const result = await mcpCall(endpoint, token, "resources/list", {});
        return { ok: true, result };
      }

      case "resources_read": {
        const { uri } = args;
        if (!uri) throw new Error("uri required");
        const result = await mcpCall(endpoint, token, "resources/read", { uri });
        return { ok: true, result };
      }

      // Prompts support
      case "prompts_list": {
        const result = await mcpCall(endpoint, token, "prompts/list", {});
        return { ok: true, result };
      }

      case "prompts_get": {
        const { name, arguments: promptArgs = {} } = args;
        if (!name) throw new Error("name required");
        const result = await mcpCall(endpoint, token, "prompts/get", { name, arguments: promptArgs });
        return { ok: true, result };
      }

      default:
        throw new Error(`mcp: unknown action '${action_key}'`);
    }
  },
};
