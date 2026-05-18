#!/usr/bin/env node
import jwt from "jsonwebtoken";

const DEFAULT_BASE = "https://local.mad4b.com";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    base_url: DEFAULT_BASE,
    device_id: "essam-pc",
    user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
  };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 30000)),
  });
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body };
}

function assertOk(condition, code, details = {}) {
  if (condition) return;
  const err = new Error(code);
  err.code = code;
  err.details = details;
  throw err;
}

async function main() {
  const args = parseArgs();
  const token = process.env.BACKEND_API_KEY;
  if (!token) throw Object.assign(new Error("BACKEND_API_KEY is not configured."), { code: "backend_api_key_missing" });
  const base = String(args.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const health = await requestJson(`${base}/health`);
  assertOk(health.status === 200 && health.body?.ok === true, "health_check_failed", { status: health.status, body: health.body });

  const unauthTools = await requestJson(`${base}/local/tools`);
  assertOk(unauthTools.status === 401, "unauthenticated_tools_should_be_401", { status: unauthTools.status, body: unauthTools.body });

  const tools = await requestJson(`${base}/local/tools?include_planned=true`, { headers: authHeaders });
  assertOk(tools.status === 200 && tools.body?.ok === true && Number(tools.body?.count || 0) >= 10, "authenticated_tools_list_failed", { status: tools.status, body: tools.body });

  const call = await requestJson(`${base}/local/tools/call`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "local.connector.health",
      tool_args: {
        device_id: args.device_id,
        user_id: args.user_id,
      },
    }),
  });
  assertOk(call.status === 200 && call.body?.ok === true && call.body?.local_gateway?.call_id, "local_gateway_health_call_failed", { status: call.status, body: call.body });

  let tenantChecks = null;
  if (process.env.JWT_SECRET) {
    const tenantId = args.tenant_id || "00000000-0000-0000-0000-000000000000";
    const tenantJwt = jwt.sign({
      user_id: args.user_id,
      tenant_id: tenantId,
      email: "local-gateway-smoke@mad4b.local",
      smoke_test: true,
    }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const tenantHeaders = { Authorization: `Bearer ${tenantJwt}` };
    const tenantTools = await requestJson(`${base}/local/tools`, { headers: tenantHeaders });
    assertOk(tenantTools.status === 200 && tenantTools.body?.caller_type === "tenant", "tenant_tools_list_failed", { status: tenantTools.status, body: tenantTools.body });
    const tenantToolKeys = Array.isArray(tenantTools.body?.tools) ? tenantTools.body.tools.map((tool) => tool.tool_key || tool.name) : [];
    assertOk(!tenantToolKeys.some((key) => String(key || "").startsWith("local.admin.")), "tenant_tools_leaked_admin_tools", { tenantToolKeys });

    const tenantCall = await requestJson(`${base}/local/tools/call`, {
      method: "POST",
      headers: { ...tenantHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "local.connector.health",
        tool_args: { device_id: args.device_id },
      }),
    });
    assertOk(tenantCall.status === 200 && tenantCall.body?.ok === true && tenantCall.body?.local_gateway?.call_id, "tenant_local_gateway_health_call_failed", { status: tenantCall.status, body: tenantCall.body });
    tenantChecks = {
      tenant_tools_status: tenantTools.status,
      tenant_tools_count: tenantTools.body.count,
      tenant_admin_tools_visible: tenantToolKeys.filter((key) => String(key || "").startsWith("local.admin.")).length,
      tenant_call_status: tenantCall.status,
      tenant_call_id: tenantCall.body.local_gateway.call_id,
    };
  }

  console.log(JSON.stringify({
    ok: true,
    base_url: base,
    checks: {
      public_health_status: health.status,
      unauthenticated_tools_status: unauthTools.status,
      authenticated_tools_status: tools.status,
      authenticated_tools_count: tools.body.count,
      call_status: call.status,
      call_id: call.body.local_gateway.call_id,
      dispatch_tool_key: call.body.local_gateway.dispatch_tool_key,
      hostname: call.body.hostname || null,
      platform: call.body.platform || null,
      tenant_jwt_path: tenantChecks,
    },
    secrets_included: false,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_gateway_public_smoke_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
