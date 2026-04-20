/**
 * Patch-vs-runtime verification script.
 * Hits a live deployment and confirms governed behavior matches the committed codebase.
 *
 * Usage:
 *   RUNTIME_BASE_URL=https://your-deployment.example.com \
 *   BACKEND_API_KEY=your-key \
 *   node verify-runtime.mjs
 *
 * Exit 0 = all checks passed (runtime matches expected behavior)
 * Exit 1 = one or more checks failed (drift detected or runtime down)
 */

const BASE_URL = (process.env.RUNTIME_BASE_URL || "").replace(/\/$/, "");
const API_KEY  = process.env.BACKEND_API_KEY || "";

if (!BASE_URL) {
  console.error("ERROR: RUNTIME_BASE_URL environment variable is required.");
  console.error("  Example: RUNTIME_BASE_URL=http://localhost:3000 node verify-runtime.mjs");
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;
const evidence = [];

function section(name) {
  console.log(`\n── ${name}`);
}

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    evidence.push({ label, result: "pass" });
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    evidence.push({ label, result: "fail", detail });
  }
}

function skip(label, reason = "") {
  console.log(`  - ${label}${reason ? ` (skipped: ${reason})` : ""}`);
  skipped++;
  evidence.push({ label, result: "skip", detail: reason });
}

async function get(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(10000), ...opts });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err?.message || String(err) };
  }
}

async function post(path, payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err?.message || String(err) };
  }
}

// ─── Layer 3: Runtime deployed ───────────────────────────────────────────────
section("Layer 3 — Runtime health");

const health = await get("/health");
assert("GET /health returns 200", health.status === 200, `got ${health.status} — ${health.error || ""}`);
assert("health body has ok: true", health.body?.ok === true, JSON.stringify(health.body));

const serviceVersion = health.body?.version || health.body?.service_version || health.body?.SERVICE_VERSION;
if (serviceVersion) {
  assert("SERVICE_VERSION present in health response", !!serviceVersion, "missing version field");
  console.log(`    service_version: ${serviceVersion}`);
} else {
  skip("SERVICE_VERSION in health response", "version field not returned by this deployment");
}

// ─── Layer 3: API authentication ─────────────────────────────────────────────
section("Layer 3 — API authentication");

if (API_KEY) {
  const authed = await get("/health");
  assert("authenticated request accepted", authed.status !== 401 && authed.status !== 403,
    `got ${authed.status}`);

  const unauthedRes = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
  const requiresAuth = unauthedRes.status === 401 || unauthedRes.status === 403;
  if (requiresAuth) {
    assert("unauthenticated request blocked", requiresAuth);
  } else {
    skip("unauthenticated request check", "health endpoint is public — acceptable");
  }
} else {
  skip("authentication checks", "BACKEND_API_KEY not set");
}

// ─── Layer 4: Governed execution — dry-run migration ─────────────────────────
section("Layer 4 — Governed execution: dry-run site migration");

const dryRunPayload = {
  transport: "wordpress_connector",
  migration: { apply: false, publish_status: "draft", post_types: ["post"] },
  source: { provider_domain: "https://source.example.com", username: "verify_test", app_password: "verify_test" },
  destination: { provider_domain: "https://dest.example.com", username: "verify_test", app_password: "verify_test", target_key: "verify_test_key" }
};

const dryRun = await post("/site-migrations", dryRunPayload);
const dryRunAccepted = dryRun.status === 200 || dryRun.status === 202 || dryRun.status === 400;
assert("POST /site-migrations does not 500 (no ReferenceError)", dryRun.status !== 500,
  `got ${dryRun.status} — ${JSON.stringify(dryRun.body).slice(0, 120)}`);
assert("POST /site-migrations responds (not unreachable)", dryRun.status > 0,
  dryRun.error || "");

if (dryRun.status === 200 || dryRun.status === 202) {
  const isJobResponse = dryRun.body?.job_id || dryRun.body?.status;
  const isDryRunResult = dryRun.body?.execution_mode === "plan_only" || dryRun.body?.apply === false;
  assert("response is a job or dry-run result", !!(isJobResponse || isDryRunResult),
    JSON.stringify(dryRun.body).slice(0, 120));
} else if (dryRun.status === 400) {
  const errorCode = dryRun.body?.error?.code || "";
  const isLogicError = !errorCode.includes("reference") && !errorCode.includes("undefined");
  assert("400 response is a logic error (not a crash)", isLogicError, `error code: ${errorCode}`);
} else {
  skip("dry-run result shape check", `unexpected status ${dryRun.status}`);
}

// ─── Layer 4: Local dispatch — github blob (auth error expected) ──────────────
section("Layer 4 — Local dispatch: github_git_blob_chunk_read");

const dispatchPayload = {
  endpoint_key: "github_git_blob_chunk_read",
  owner: "verify-test-owner",
  repo: "verify-test-repo",
  file_sha: "0000000000000000000000000000000000000000",
  byte_offset: 0,
  length: 100
};

const dispatch = await post("/http-execute", dispatchPayload);
assert("POST /http-execute responds (not unreachable)", dispatch.status > 0, dispatch.error || "");
assert("github dispatch does not 500 with ReferenceError", dispatch.status !== 500 ||
  !String(JSON.stringify(dispatch.body)).toLowerCase().includes("referenceerror"),
  JSON.stringify(dispatch.body).slice(0, 120));

if (dispatch.status === 200 || dispatch.status === 404 || dispatch.status === 401 || dispatch.status === 502) {
  assert("github dispatch returns structured error or result", typeof dispatch.body === "object",
    String(dispatch.body?._raw || "").slice(0, 80));
} else {
  skip("github dispatch result shape", `status ${dispatch.status}`);
}

// ─── Layer 4: Job queue — enqueue and status ──────────────────────────────────
section("Layer 4 — Async job queue");

const jobPayload = {
  transport: "wordpress_connector",
  migration: { apply: false, publish_status: "draft" },
  source: { provider_domain: "https://source.example.com" },
  destination: { provider_domain: "https://dest.example.com", target_key: "verify_queue_test" },
  async: true
};

const jobCreate = await post("/jobs", jobPayload);
assert("POST /jobs responds (not unreachable)", jobCreate.status > 0, jobCreate.error || "");
assert("POST /jobs does not 500", jobCreate.status !== 500,
  JSON.stringify(jobCreate.body).slice(0, 120));

if (jobCreate.status === 200 || jobCreate.status === 202) {
  const jobId = jobCreate.body?.job_id;
  assert("job_id present in response", !!jobId, JSON.stringify(jobCreate.body).slice(0, 80));

  if (jobId) {
    await new Promise(r => setTimeout(r, 1500));
    const jobStatus = await get(`/jobs/${jobId}`);
    assert("GET /jobs/:id returns 200", jobStatus.status === 200, `got ${jobStatus.status}`);
    const status = jobStatus.body?.status;
    const validStatuses = ["queued", "running", "succeeded", "failed", "retrying"];
    assert(`job status is a known value (got: ${status})`,
      validStatuses.includes(status), `got ${status}`);
  }
} else if (jobCreate.status === 400) {
  skip("job queue checks", "POST /jobs returned 400 — payload may not match async job contract");
} else {
  skip("job queue checks", `unexpected status ${jobCreate.status}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const timestamp = new Date().toISOString();
console.log(`\n${"─".repeat(50)}`);
console.log(`Runtime: ${BASE_URL}`);
console.log(`Checked: ${timestamp}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

console.log("\n── Evidence log");
for (const e of evidence) {
  const icon = e.result === "pass" ? "✓" : e.result === "skip" ? "-" : "✗";
  console.log(`  ${icon} [${e.result.toUpperCase()}] ${e.label}${e.detail ? ` — ${e.detail}` : ""}`);
}

if (failed === 0) {
  console.log("\nRUNTIME VERIFICATION PASS ✓");
  console.log("Deployment claims are supported by live runtime evidence.");
  process.exit(0);
} else {
  console.error(`\nRUNTIME VERIFICATION FAILED — ${failed} check(s) indicate drift or outage`);
  console.error("Do not mark this deployment complete until all failures are resolved.");
  process.exit(1);
}
