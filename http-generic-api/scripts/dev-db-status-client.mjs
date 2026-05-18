#!/usr/bin/env node

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: "https://dev.mad4b.com" };
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
    signal: AbortSignal.timeout(Number(options.timeout_ms || 60000)),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.BACKEND_API_KEY;
  if (!apiKey) throw new Error("BACKEND_API_KEY is not configured in caller environment.");
  const base = String(args.base_url || "https://dev.mad4b.com").replace(/\/$/, "");

  const [health, deployment, dbStatus] = await Promise.all([
    requestJson(`${base}/health`, { timeout_ms: 60000 }),
    requestJson(`${base}/deployment-info`, { timeout_ms: 60000 }),
    requestJson(`${base}/dev/db/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout_ms: 60000,
    }),
  ]);

  const ok = dbStatus.status === 200 && dbStatus.body?.ok === true;
  console.log(JSON.stringify({
    ok,
    base_url: base,
    health: {
      status: health.status,
      ok: health.body?.ok === true,
      service: health.body?.service || null,
      version: health.body?.version || null,
      db_connected: health.body?.dependencies?.db?.connected ?? null,
      error_code: health.body?.error?.code || null,
    },
    deployment: {
      status: deployment.status,
      ok: deployment.body?.ok === true,
      service: deployment.body?.service || null,
      branch: deployment.body?.branch || deployment.body?.git_branch || null,
      commit_sha: deployment.body?.commit_sha || deployment.body?.git_sha || null,
      error_code: deployment.body?.error?.code || null,
    },
    db_status: {
      status: dbStatus.status,
      ok: dbStatus.body?.ok === true,
      db_name: dbStatus.body?.db_name || null,
      table_count: dbStatus.body?.table_count ?? null,
      row_count: dbStatus.body?.row_count ?? null,
      error_code: dbStatus.body?.error?.code || null,
      error_message: dbStatus.body?.error?.message || null,
    },
    secrets_included: false,
  }, null, 2));

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "dev_db_status_client_failed", message: err.message }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
