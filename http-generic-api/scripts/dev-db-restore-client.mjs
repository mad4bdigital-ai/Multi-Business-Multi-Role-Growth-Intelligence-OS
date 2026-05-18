#!/usr/bin/env node

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: "https://dev.mad4b.com" };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

function required(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) url.searchParams.set("token", "<redacted>");
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 900000)),
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
  const artifactUrl = required(args, "artifact_url");
  const manifestUrl = required(args, "manifest_url");
  const keyUrl = required(args, "key_url");

  const statusBefore = await requestJson(`${base}/dev/db/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout_ms: 60000,
  });

  const restore = await requestJson(`${base}/dev/db/restore-from-backup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      artifact_url: artifactUrl,
      manifest_url: manifestUrl,
      key_url: keyUrl,
      confirm: "RESTORE_DEV_DB",
    }),
    timeout_ms: Number(args.timeout_ms || 900000),
  });

  const statusAfter = await requestJson(`${base}/dev/db/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout_ms: 60000,
  });

  const ok = restore.status === 200 && restore.body?.ok === true;
  console.log(JSON.stringify({
    ok,
    base_url: base,
    status_before: {
      status: statusBefore.status,
      ok: statusBefore.body?.ok === true,
      db_name: statusBefore.body?.db_name || null,
      table_count: statusBefore.body?.table_count ?? null,
      row_count: statusBefore.body?.row_count ?? null,
      error_code: statusBefore.body?.error?.code || null,
    },
    restore: {
      status: restore.status,
      ok: restore.body?.ok === true,
      db_name: restore.body?.db_name || null,
      export_id: restore.body?.export_id || null,
      source_database_name: restore.body?.source_database_name || null,
      manifest_table_count: restore.body?.manifest_table_count ?? null,
      manifest_row_count: restore.body?.manifest_row_count ?? null,
      table_count: restore.body?.table_count ?? null,
      row_count: restore.body?.row_count ?? null,
      executed_statements: restore.body?.executed_statements ?? null,
      duration_ms: restore.body?.duration_ms ?? null,
      error_code: restore.body?.error?.code || null,
      error_message: restore.body?.error?.message || null,
    },
    status_after: {
      status: statusAfter.status,
      ok: statusAfter.body?.ok === true,
      db_name: statusAfter.body?.db_name || null,
      table_count: statusAfter.body?.table_count ?? null,
      row_count: statusAfter.body?.row_count ?? null,
      error_code: statusAfter.body?.error?.code || null,
    },
    requested_urls: {
      artifact_url: redactUrl(artifactUrl),
      manifest_url: redactUrl(manifestUrl),
      key_url: redactUrl(keyUrl),
    },
    secrets_included: false,
  }, null, 2));

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "dev_db_restore_client_failed", message: err.message }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
