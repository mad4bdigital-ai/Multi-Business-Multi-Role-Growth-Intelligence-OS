#!/usr/bin/env node
const DEFAULT_BASE = "https://auth.mad4b.com";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: DEFAULT_BASE };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function request(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
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
  const base = String(args.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const manifest = await request(`${base}/connector-agent/manifest.json`);
  assertOk(manifest.status === 200 && manifest.body?.ok === true, "manifest_request_failed", { status: manifest.status, body: manifest.body });
  assertOk(manifest.body.agent === "mad4b-local-connector", "manifest_agent_mismatch", { body: manifest.body });
  assertOk(manifest.body.files?.["server.mjs"]?.sha256, "manifest_missing_server_hash", { body: manifest.body });
  assertOk(manifest.body.files?.["connector-watchdog.ps1"]?.sha256, "manifest_missing_watchdog_hash", { body: manifest.body });
  assertOk(manifest.body.files?.["connector-safe-upgrade.ps1"]?.sha256, "manifest_missing_safe_upgrade_hash", { body: manifest.body });

  const serverUrl = manifest.body.files["server.mjs"].url;
  const server = await request(serverUrl);
  assertOk(server.status === 200, "server_file_request_failed", { status: server.status, body: server.body });
  const headerHash = server.headers.get("x-mad4b-sha256");
  assertOk(headerHash === manifest.body.files["server.mjs"].sha256, "server_hash_header_mismatch", { headerHash, manifestHash: manifest.body.files["server.mjs"].sha256 });

  console.log(JSON.stringify({
    ok: true,
    base_url: base,
    manifest_status: manifest.status,
    version: manifest.body.version,
    file_count: Object.keys(manifest.body.files || {}).length,
    server_size: manifest.body.files["server.mjs"].size,
    server_hash_prefix: manifest.body.files["server.mjs"].sha256.slice(0, 12),
    secrets_included: false,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "connector_agent_smoke_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
