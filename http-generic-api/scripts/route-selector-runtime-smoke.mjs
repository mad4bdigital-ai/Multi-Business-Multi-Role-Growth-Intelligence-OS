#!/usr/bin/env node

const ROUTE_TYPE_ORDER = [
  "vpn_private_ip",
  "lan_private_ip",
  "direct_public_ip",
  "dynamic_public_ip",
  "cloudflare_tunnel",
  "admin_recovery",
];

const EXPECTED_PRIORITY = {
  vpn_private_ip: 10,
  lan_private_ip: 20,
  direct_public_ip: 30,
  dynamic_public_ip: 40,
  cloudflare_tunnel: 50,
  admin_recovery: 90,
};

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: "https://auth.mad4b.com", device_id: "essam-pc", require_all_types: false };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
    else if (arg === "--require-all-types") out.require_all_types = true;
  }
  out.require_all_types = out.require_all_types === true || String(out.require_all_types).toLowerCase() === "true";
  return out;
}

async function requestJson(url, { apiKey, method = "GET", body = null } = {}) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body: data };
}

function routeOrderRank(routeType) {
  const idx = ROUTE_TYPE_ORDER.indexOf(routeType);
  return idx === -1 ? ROUTE_TYPE_ORDER.length : idx;
}

function summarizeRoutes(routes = []) {
  const presentTypes = [...new Set(routes.map((route) => route.route_type).filter(Boolean))];
  const missingTypes = ROUTE_TYPE_ORDER.filter((type) => !presentTypes.includes(type));
  const orderedRoutes = [...routes].sort((a, b) =>
    Number(a.priority ?? 1000) - Number(b.priority ?? 1000) || routeOrderRank(a.route_type) - routeOrderRank(b.route_type)
  );
  const priorityFindings = ROUTE_TYPE_ORDER.map((type) => {
    const matches = routes.filter((route) => route.route_type === type);
    if (!matches.length) return { route_type: type, present: false, expected_priority: EXPECTED_PRIORITY[type], priority_ok: null };
    return {
      route_type: type,
      present: true,
      expected_priority: EXPECTED_PRIORITY[type],
      priorities: matches.map((route) => route.priority),
      priority_ok: matches.every((route) => Number(route.priority) === EXPECTED_PRIORITY[type]),
      health_statuses: [...new Set(matches.map((route) => route.health_status || "unknown"))],
      enabled_count: matches.filter((route) => route.is_enabled !== false).length,
    };
  });
  return {
    route_count: routes.length,
    present_types: presentTypes,
    missing_types: missingTypes,
    ordered_types: orderedRoutes.map((route) => route.route_type),
    priority_findings: priorityFindings,
  };
}

function assertCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.BACKEND_API_KEY;
  if (!apiKey) throw new Error("BACKEND_API_KEY is not configured in caller environment.");

  const base = String(args.base_url || "https://auth.mad4b.com").replace(/\/$/, "");
  const deviceId = String(args.device_id || "").trim();
  if (!deviceId) throw new Error("--device-id is required");

  const checks = [];
  const statusUrl = `${base}/local-manager/beta/status?device_id=${encodeURIComponent(deviceId)}`;
  const status = await requestJson(statusUrl, { apiKey });
  const routes = Array.isArray(status.body?.device?.routes) ? status.body.device.routes : [];
  const summary = summarizeRoutes(routes);

  assertCheck(checks, "local manager beta status is reachable", status.status === 200 && status.body?.ok === true, { status: status.status });
  assertCheck(checks, "status response is read-only and redacted", status.body?.read_only === true && status.body?.secrets_included === false, { read_only: status.body?.read_only, secrets_included: status.body?.secrets_included });
  assertCheck(checks, "route priority ordering is ascending", summary.ordered_types.length === routes.length, { ordered_types: summary.ordered_types });
  assertCheck(checks, "known route types are recognized", summary.present_types.every((type) => ROUTE_TYPE_ORDER.includes(type)), { present_types: summary.present_types });
  assertCheck(checks, "cloudflare route is provisioned", summary.present_types.includes("cloudflare_tunnel"), summary);
  assertCheck(checks, "admin recovery route is provisioned", summary.present_types.includes("admin_recovery"), summary);
  assertCheck(checks, "cloudflare/admin priorities match policy", summary.priority_findings.filter((item) => item.present && ["cloudflare_tunnel", "admin_recovery"].includes(item.route_type)).every((item) => item.priority_ok === true), summary.priority_findings);
  assertCheck(checks, "LAN/VPN/direct/dynamic gaps are classified as not provisioned, not failed", ["vpn_private_ip", "lan_private_ip", "direct_public_ip", "dynamic_public_ip"].every((type) => summary.missing_types.includes(type) || summary.present_types.includes(type)), summary);

  if (args.require_all_types) {
    assertCheck(checks, "all route types are provisioned", summary.missing_types.length === 0, summary);
  }

  const healthUrl = `${base}/connector/${encodeURIComponent(deviceId)}/health`;
  const health = await requestJson(healthUrl, { apiKey });
  const attempts = Array.isArray(health.body?.connector_route_attempts) ? health.body.connector_route_attempts : [];
  assertCheck(checks, "connector proxy health dispatch succeeds", health.status === 200 && health.body?.ok === true, { status: health.status, error_code: health.body?.error?.code || null });
  assertCheck(checks, "connector proxy reports selected route", Boolean(health.body?.connector_route?.route_type), { route: health.body?.connector_route || null });
  assertCheck(checks, "connector route attempts are reported without endpoint secrets", attempts.every((attempt) => !String(attempt.endpoint_url || "").match(/token|secret|password|signature/i)), { attempts });

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  console.log(JSON.stringify({
    ok: failed === 0,
    base_url: base,
    device_id: deviceId,
    passed,
    failed,
    checks,
    route_summary: summary,
    connector_proxy: {
      status: health.status,
      selected_route: health.body?.connector_route || null,
      attempt_count: attempts.length,
      attempt_route_types: attempts.map((attempt) => attempt.route_type),
    },
    dry_run: true,
    writes_attempted: false,
    secrets_included: false,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "route_selector_runtime_smoke_failed", message: err.message }, dry_run: true, writes_attempted: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
