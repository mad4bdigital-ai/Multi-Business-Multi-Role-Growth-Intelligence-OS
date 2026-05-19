#!/usr/bin/env node

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: "https://auth.mad4b.com", device_id: "essam-pc", user_id: "admin", tenant_id: "platform" };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function requestJson(url, { apiKey = null, method = "GET", body = null } = {}) {
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
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw_preview: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: data };
}

function assertCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}

function hasForbiddenKey(value, forbidden = [/connector_secret/i, /cf_token/i, /download_url/i, /install_ps1/i, /install_bat/i, /tunnel_command/i, /BACKEND_API_KEY/i]) {
  const text = JSON.stringify(value || {});
  return forbidden.some((rx) => rx.test(text));
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.BACKEND_API_KEY;
  if (!apiKey) throw new Error("BACKEND_API_KEY is not configured in caller environment.");
  const base = String(args.base_url || "https://auth.mad4b.com").replace(/\/$/, "");
  const deviceId = String(args.device_id || "").trim();
  const userId = String(args.user_id || "admin").trim();
  const tenantId = String(args.tenant_id || "platform").trim();
  const checks = [];

  const statusPath = `/local-connector/install/status?user_id=${encodeURIComponent(userId)}&tenant_id=${encodeURIComponent(tenantId)}&device_id=${encodeURIComponent(deviceId)}`;
  const unauth = await requestJson(`${base}${statusPath}`);
  assertCheck(checks, "install status rejects unauthenticated access", unauth.status === 401 || unauth.status === 403, { status: unauth.status, code: unauth.body?.error?.code || null });

  const missing = await requestJson(`${base}/local-connector/install/status`, { apiKey });
  assertCheck(checks, "install status rejects missing device_id", missing.status === 400 && missing.body?.error?.code === "missing_fields", { status: missing.status, code: missing.body?.error?.code || null });

  const status = await requestJson(`${base}${statusPath}`, { apiKey });
  assertCheck(checks, "install status returns OK", status.status === 200 && status.body?.ok === true, { status: status.status, installed: status.body?.installed ?? null });
  assertCheck(checks, "install status is read-only and marks secrets excluded", status.body?.read_only === true && status.body?.secrets_included === false, { read_only: status.body?.read_only ?? null, secrets_included: status.body?.secrets_included ?? null });
  assertCheck(checks, "install status does not include installer bodies or raw tokens", !hasForbiddenKey(status.body), { top_level_keys: Object.keys(status.body || {}) });
  assertCheck(checks, "install status exposes safe install capability metadata", status.body?.install?.download_link_endpoint === "/local-connector/install/download-link" && status.body?.install?.reprovision_supported === true, status.body?.install || {});
  assertCheck(checks, "install status exposes aliases without command templates", Array.isArray(status.body?.aliases) && status.body.aliases.every((alias) => !Object.prototype.hasOwnProperty.call(alias, "command_template")), { alias_count: status.body?.aliases?.length || 0 });

  const invalidDownload = await requestJson(`${base}/local-connector/install/download?token=invalid`);
  assertCheck(checks, "invalid installer download token is rejected", invalidDownload.status === 401 && invalidDownload.body?.error?.code === "invalid_download_token", { status: invalidDownload.status, code: invalidDownload.body?.error?.code || null });

  const missingInstall = await requestJson(`${base}/local-connector/install`, { apiKey, method: "POST", body: {} });
  assertCheck(checks, "install endpoint rejects empty body before provisioning side effects", missingInstall.status === 400 && missingInstall.body?.error?.code === "missing_fields", { status: missingInstall.status, code: missingInstall.body?.error?.code || null });

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  console.log(JSON.stringify({
    ok: failed === 0,
    base_url: base,
    device_id: deviceId,
    passed,
    failed,
    checks,
    status_summary: {
      installed: status.body?.installed ?? null,
      config_id: status.body?.config_id || null,
      route_count: Array.isArray(status.body?.app_routes) ? status.body.app_routes.length : 0,
      alias_count: Array.isArray(status.body?.aliases) ? status.body.aliases.length : 0,
      download_link_available: status.body?.install?.download_link_available ?? null,
      reprovision_supported: status.body?.install?.reprovision_supported ?? null,
    },
    dry_run: true,
    writes_attempted: false,
    secrets_included: false,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "installer_reprovision_smoke_failed", message: err.message }, dry_run: true, writes_attempted: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
