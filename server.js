
import express from "express";
import { google } from "googleapis";
import crypto from "node:crypto";
import YAML from "yaml";
import { promises as fs } from "fs";
import path from "path";

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "20mb";
const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));

const REGISTRY_SPREADSHEET_ID = process.env.REGISTRY_SPREADSHEET_ID || "";
const ACTIVITY_SPREADSHEET_ID =
  process.env.ACTIVITY_SPREADSHEET_ID || REGISTRY_SPREADSHEET_ID;
const BRAND_REGISTRY_SHEET = process.env.BRAND_REGISTRY_SHEET || "Brand Registry";
const ACTIONS_REGISTRY_SHEET = process.env.ACTIONS_REGISTRY_SHEET || "Actions Registry";
const ENDPOINT_REGISTRY_SHEET = process.env.ENDPOINT_REGISTRY_SHEET || "API Actions Endpoint Registry";
const EXECUTION_POLICY_SHEET = process.env.EXECUTION_POLICY_SHEET || "Execution Policy Registry";
const HOSTING_ACCOUNT_REGISTRY_SHEET =
  process.env.HOSTING_ACCOUNT_REGISTRY_SHEET || "Hosting Account Registry";
const SITE_RUNTIME_INVENTORY_REGISTRY_SHEET =
  process.env.SITE_RUNTIME_INVENTORY_REGISTRY_SHEET || "Site Runtime Inventory Registry";
const SITE_SETTINGS_INVENTORY_REGISTRY_SHEET =
  process.env.SITE_SETTINGS_INVENTORY_REGISTRY_SHEET || "Site Settings Inventory Registry";
const PLUGIN_INVENTORY_REGISTRY_SHEET =
  process.env.PLUGIN_INVENTORY_REGISTRY_SHEET || "Plugin Inventory Registry";
const TASK_ROUTES_SHEET =
  process.env.TASK_ROUTES_SHEET || "Task Routes";
const WORKFLOW_REGISTRY_SHEET =
  process.env.WORKFLOW_REGISTRY_SHEET || "Workflow Registry";
const REGISTRY_SURFACES_CATALOG_SHEET =
  process.env.REGISTRY_SURFACES_CATALOG_SHEET || "Registry Surfaces Catalog";
const VALIDATION_REPAIR_REGISTRY_SHEET =
  process.env.VALIDATION_REPAIR_REGISTRY_SHEET || "Validation & Repair Registry";
const EXECUTION_LOG_UNIFIED_SHEET =
  process.env.EXECUTION_LOG_UNIFIED_SHEET || "Execution Log Unified";
const JSON_ASSET_REGISTRY_SHEET =
  process.env.JSON_ASSET_REGISTRY_SHEET || "JSON Asset Registry";
const BRAND_CORE_REGISTRY_SHEET =
  process.env.BRAND_CORE_REGISTRY_SHEET || "Brand Core Registry";
const EXECUTION_LOG_UNIFIED_SPREADSHEET_ID = ACTIVITY_SPREADSHEET_ID;
const JSON_ASSET_REGISTRY_SPREADSHEET_ID = REGISTRY_SPREADSHEET_ID;
const OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID =
  String(process.env.OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID || "").trim();
const RAW_BODY_MAX_BYTES = 250_000;
const MAX_TIMEOUT_SECONDS = 300;
const port = String(process.env.PORT || 8080);
const SERVICE_VERSION =
  process.env.SERVICE_VERSION || "2.5.0-wordpress-aware-migration";
const GITHUB_API_BASE_URL =
  String(process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, "");
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || "").trim();
const GITHUB_BLOB_CHUNK_MAX_LENGTH = Math.max(
  1,
  Number(process.env.GITHUB_BLOB_CHUNK_MAX_LENGTH || 100000)
);

const DEFAULT_JOB_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.JOB_MAX_ATTEMPTS || 3)
);
const JOB_QUEUE_TICK_MS = Math.max(
  250,
  Number(process.env.JOB_QUEUE_TICK_MS || 1000)
);
const JOB_WEBHOOK_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.JOB_WEBHOOK_TIMEOUT_MS || 10000)
);
const JOB_RETRY_DELAYS_MS = [300_000, 420_000, 600_000];
const JOB_STATE_FILE =
  process.env.JOB_STATE_FILE || path.resolve("./data/http-job-state.json");
const JOB_STATE_FLUSH_DEBOUNCE_MS = Math.max(
  50,
  Number(process.env.JOB_STATE_FLUSH_DEBOUNCE_MS || 250)
);
const durableState = {
  jobs: {},
  idempotency: {},
  queue: []
};

let jobStateLoaded = false;
let jobStateFlushTimer = null;
let jobStateFlushPromise = Promise.resolve();
let jobStateLoadPromise = null;

async function ensureJobStateDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function flushJobStateToDisk() {
  await ensureJobStateDirectory(JOB_STATE_FILE);

  const payload = JSON.stringify(
    {
      jobs: durableState.jobs,
      idempotency: durableState.idempotency,
      queue: durableState.queue
    },
    null,
    2
  );

  await fs.writeFile(JOB_STATE_FILE, payload, "utf8");
}

function scheduleJobStateFlush() {
  if (jobStateFlushTimer) return;

  jobStateFlushTimer = setTimeout(() => {
    jobStateFlushTimer = null;
    jobStateFlushPromise = jobStateFlushPromise
      .then(() => flushJobStateToDisk())
      .catch(err => {
        console.error("JOB_STATE_FLUSH_FAILED:", err);
      });
  }, JOB_STATE_FLUSH_DEBOUNCE_MS);

  if (typeof jobStateFlushTimer?.unref === "function") {
    jobStateFlushTimer.unref();
  }
}

async function forceJobStateFlush() {
  if (jobStateFlushTimer) {
    clearTimeout(jobStateFlushTimer);
    jobStateFlushTimer = null;
  }

  jobStateFlushPromise = jobStateFlushPromise
    .then(() => flushJobStateToDisk())
    .catch(err => {
      console.error("JOB_STATE_FORCE_FLUSH_FAILED:", err);
    });

  await jobStateFlushPromise;
}

function reconcileLoadedJobState() {
  const knownStatuses = new Set([
    "queued",
    "running",
    "succeeded",
    "failed",
    "retrying",
    "cancelled"
  ]);
  const terminalStatuses = new Set([
    "succeeded",
    "failed",
    "cancelled"
  ]);

  let dirty = false;
  const normalizedJobs = {};

  for (const [rawJobId, rawJob] of Object.entries(durableState.jobs || {})) {
    const inferredJobId = String(rawJob?.job_id || rawJobId || "").trim();
    if (!inferredJobId) {
      dirty = true;
      continue;
    }

    const isObjectRecord =
      rawJob &&
      typeof rawJob === "object" &&
      !Array.isArray(rawJob);
    const job = isObjectRecord ? { ...rawJob } : {};
    if (!isObjectRecord) dirty = true;

    if (String(job.job_id || "").trim() !== inferredJobId) {
      dirty = true;
    }
    job.job_id = inferredJobId;

    let status = normalizeJobStatus(job.status);
    if (!knownStatuses.has(status)) {
      status = "queued";
      dirty = true;
    }

    // If the process crashed while running/retrying, requeue on boot.
    if (status === "running" || status === "retrying") {
      status = "queued";
      dirty = true;
    }

    if (String(job.status || "").trim().toLowerCase() !== status) {
      dirty = true;
    }
    job.status = status;

    const createdAt = String(job.created_at || "").trim();
    if (!createdAt) {
      job.created_at = nowIso();
      dirty = true;
    }

    const updatedAt = String(job.updated_at || "").trim();
    if (!updatedAt) {
      job.updated_at = job.created_at;
      dirty = true;
    }

    if (terminalStatuses.has(status) && !String(job.completed_at || "").trim()) {
      job.completed_at = job.updated_at;
      dirty = true;
    }

    if (status !== "retrying" && String(job.next_retry_at || "").trim()) {
      job.next_retry_at = "";
      dirty = true;
    }

    if (
      !job.request_payload ||
      typeof job.request_payload !== "object" ||
      Array.isArray(job.request_payload)
    ) {
      job.request_payload = {};
      dirty = true;
    }

    const normalizedAttemptCount = Number.isFinite(Number(job.attempt_count))
      ? Math.max(0, Math.floor(Number(job.attempt_count)))
      : 0;
    if (Number(job.attempt_count) !== normalizedAttemptCount) {
      dirty = true;
    }
    job.attempt_count = normalizedAttemptCount;

    const normalizedMaxAttempts = normalizeMaxAttempts(job.max_attempts);
    if (Number(job.max_attempts) !== normalizedMaxAttempts) {
      dirty = true;
    }
    job.max_attempts = normalizedMaxAttempts;

    if (typeof job.job_type !== "string") {
      job.job_type = String(job.job_type || "http_execute");
      dirty = true;
    }

    if (typeof job.requested_by !== "string") {
      job.requested_by = String(job.requested_by || "unknown");
      dirty = true;
    }

    if (typeof job.parent_action_key !== "string") {
      job.parent_action_key = String(job.parent_action_key || "");
      dirty = true;
    }

    if (typeof job.endpoint_key !== "string") {
      job.endpoint_key = String(job.endpoint_key || "");
      dirty = true;
    }

    if (typeof job.target_key !== "string") {
      job.target_key = String(job.target_key || "");
      dirty = true;
    }

    if (typeof job.route_id !== "string") {
      job.route_id = String(job.route_id || "");
      dirty = true;
    }

    if (typeof job.target_module !== "string") {
      job.target_module = String(job.target_module || "");
      dirty = true;
    }

    if (typeof job.target_workflow !== "string") {
      job.target_workflow = String(job.target_workflow || "");
      dirty = true;
    }

    if (typeof job.brand_name !== "string") {
      job.brand_name = String(job.brand_name || "");
      dirty = true;
    }

    const normalizedExecutionTraceId =
      String(job.execution_trace_id || job.request_payload?.execution_trace_id || "").trim() ||
      createExecutionTraceId();
    if (String(job.execution_trace_id || "").trim() !== normalizedExecutionTraceId) {
      dirty = true;
    }
    job.execution_trace_id = normalizedExecutionTraceId;

    const normalizedWebhookUrl = normalizeWebhookUrl(job.webhook_url);
    if (String(job.webhook_url || "").trim() !== normalizedWebhookUrl) {
      dirty = true;
    }
    job.webhook_url = normalizedWebhookUrl;
    if (typeof job.callback_secret !== "string") {
      job.callback_secret = String(job.callback_secret || "");
      dirty = true;
    }
    if (typeof job.idempotency_key !== "string") {
      job.idempotency_key = String(job.idempotency_key || "");
      dirty = true;
    }

    normalizedJobs[inferredJobId] = job;
  }

  durableState.jobs = normalizedJobs;

  const queueSet = new Set();
  for (const rawQueueJobId of durableState.queue || []) {
    const jobId = String(rawQueueJobId || "").trim();
    if (!jobId) {
      dirty = true;
      continue;
    }
    if (queueSet.has(jobId)) {
      dirty = true;
      continue;
    }
    queueSet.add(jobId);
  }

  for (const [jobId, job] of Object.entries(normalizedJobs)) {
    const status = normalizeJobStatus(job.status);
    if (status === "queued") {
      if (!queueSet.has(jobId)) {
        queueSet.add(jobId);
        dirty = true;
      }
      continue;
    }

    if (queueSet.delete(jobId)) {
      dirty = true;
    }
  }

  const nextQueue = [...queueSet].filter(jobId => !!normalizedJobs[jobId]);
  if (nextQueue.length !== queueSet.size) {
    dirty = true;
  }
  if (JSON.stringify(durableState.queue || []) !== JSON.stringify(nextQueue)) {
    dirty = true;
  }
  durableState.queue = nextQueue;

  const normalizedIdempotency = {};
  for (const [rawKey, rawJobId] of Object.entries(durableState.idempotency || {})) {
    const key = String(rawKey || "").trim();
    const jobId = String(rawJobId || "").trim();
    if (!key || !jobId || !normalizedJobs[jobId]) {
      dirty = true;
      continue;
    }
    normalizedIdempotency[key] = jobId;
  }

  if (
    Object.keys(normalizedIdempotency).length !==
    Object.keys(durableState.idempotency || {}).length
  ) {
    dirty = true;
  }
  durableState.idempotency = normalizedIdempotency;

  return dirty;
}

async function loadJobStateFromDisk() {
  if (jobStateLoaded) return;
  if (jobStateLoadPromise) {
    await jobStateLoadPromise;
    return;
  }

  jobStateLoadPromise = (async () => {
    try {
      const raw = await fs.readFile(JOB_STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);

      durableState.jobs =
        parsed && typeof parsed.jobs === "object" && parsed.jobs
          ? parsed.jobs
          : {};

      durableState.idempotency =
        parsed && typeof parsed.idempotency === "object" && parsed.idempotency
          ? parsed.idempotency
          : {};

      durableState.queue = Array.isArray(parsed?.queue)
        ? parsed.queue.map(v => String(v || "").trim()).filter(Boolean)
        : [];
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      await ensureJobStateDirectory(JOB_STATE_FILE);
      await flushJobStateToDisk();
    }

    const recovered = reconcileLoadedJobState();
    if (recovered) {
      await flushJobStateToDisk();
    }

    jobStateLoaded = true;
  })();

  try {
    await jobStateLoadPromise;
  } finally {
    jobStateLoadPromise = null;
  }
}

const jobRepository = {
  get(jobId) {
    return durableState.jobs[String(jobId || "").trim()] || null;
  },
  set(job) {
    const id = String(job?.job_id || "").trim();
    if (!id) return null;
    durableState.jobs[id] = job;
    scheduleJobStateFlush();
    return durableState.jobs[id];
  },
  delete(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return;
    delete durableState.jobs[id];
    durableState.queue = durableState.queue.filter(v => v !== id);
    scheduleJobStateFlush();
  },
  values() {
    return Object.values(durableState.jobs || {});
  },
  size() {
    return Object.keys(durableState.jobs || {}).length;
  }
};

const idempotencyRepository = {
  get(key) {
    return durableState.idempotency[String(key || "").trim()] || null;
  },
  set(key, jobId) {
    const k = String(key || "").trim();
    if (!k) return;
    durableState.idempotency[k] = String(jobId || "").trim();
    scheduleJobStateFlush();
  },
  delete(key) {
    const k = String(key || "").trim();
    if (!k) return;
    delete durableState.idempotency[k];
    scheduleJobStateFlush();
  },
  has(key) {
    const k = String(key || "").trim();
    return !!durableState.idempotency[k];
  }
};

const queueRepository = {
  push(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return;
    if (!durableState.queue.includes(id)) {
      durableState.queue.push(id);
      scheduleJobStateFlush();
    }
  },
  shift() {
    const id = durableState.queue.shift() || "";
    if (id) scheduleJobStateFlush();
    return id;
  },
  size() {
    return durableState.queue.length;
  }
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    const err = new Error("Missing required environment variable: GITHUB_TOKEN");
    err.code = "missing_github_token";
    err.status = 500;
    throw err;
  }
  return GITHUB_TOKEN;
}

function assertNonEmptyString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${fieldName} is required.`);
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return normalized;
}

function parseBoundedInteger(value, fieldName, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const err = new Error(
      `${fieldName} must be an integer between ${min} and ${max}.`
    );
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return parsed;
}

function decodeBase64ToBuffer(value) {
  return Buffer.from(String(value || "").replace(/\s+/g, ""), "base64");
}

async function fetchGitHubBlobPayload({ owner, repo, fileSha }) {
  const token = requireGithubToken();
  const url =
    `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(fileSha)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const err = new Error(
      payload?.message || `GitHub blob fetch failed with status ${response.status}.`
    );
    err.code =
      response.status === 404 ? "github_blob_not_found" : "github_blob_fetch_failed";
    err.status = response.status === 404 ? 404 : 502;
    throw err;
  }

  if (String(payload?.encoding || "").trim().toLowerCase() !== "base64") {
    const err = new Error("GitHub blob response encoding is not base64.");
    err.code = "github_blob_encoding_unsupported";
    err.status = 502;
    throw err;
  }

  return payload;
}

async function githubGitBlobChunkRead({ input = {} }) {
  const owner = assertNonEmptyString(input.owner, "owner");
  const repo = assertNonEmptyString(input.repo, "repo");
  const fileSha = assertNonEmptyString(
    input.file_sha || input.fileSha,
    "file_sha"
  );

  const start = parseBoundedInteger(
    input.start,
    "start",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const length = parseBoundedInteger(
    input.length,
    "length",
    1,
    GITHUB_BLOB_CHUNK_MAX_LENGTH
  );

  const blob = await fetchGitHubBlobPayload({
    owner,
    repo,
    fileSha
  });

  const blobBuffer = decodeBase64ToBuffer(blob.content);
  const totalSize = blobBuffer.length;

  if (start > totalSize) {
    return {
      ok: false,
      statusCode: 416,
      error: {
        code: "range_not_satisfiable",
        message: "start exceeds blob size."
      }
    };
  }

  const endExclusive = Math.min(start + length, totalSize);
  const chunkBuffer = blobBuffer.subarray(start, endExclusive);

  return {
    ok: true,
    statusCode: 200,
    owner,
    repo,
    file_sha: fileSha,
    start,
    length: chunkBuffer.length,
    end: endExclusive,
    total_size: totalSize,
    encoding: "base64",
    content: chunkBuffer.toString("base64"),
    has_more: endExclusive < totalSize
  };
}

function backendApiKeyEnabled() {
  return !!String(process.env.BACKEND_API_KEY || "").trim();
}

function requireBackendApiKey(req, res, next) {
  const expected = process.env.BACKEND_API_KEY;
  if (!backendApiKeyEnabled()) return next();

  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Invalid backend API key." }
    });
  }
  next();
}

function debugEnabled() {
  return String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true";
}

function debugLog(...args) {
  if (debugEnabled()) console.log(...args);
}

function jsonParseSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function boolFromSheet(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

function asBool(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

function rowToObject(header, row) {
  const out = {};
  for (let i = 0; i < header.length; i += 1) {
    out[header[i]] = row[i] ?? "";
  }
  return out;
}

function matchesHostingerSshTarget(rowObj, input = {}) {
  if ((rowObj.hosting_provider || "").trim().toLowerCase() !== "hostinger") {
    return false;
  }

  const targetKey = String(input.target_key || "").trim();
  const hostingAccountKey = String(input.hosting_account_key || "").trim();
  const accountIdentifier = String(input.account_identifier || "").trim();
  const siteUrl = String(input.site_url || "").trim().toLowerCase();

  if (hostingAccountKey && rowObj.hosting_account_key === hostingAccountKey) {
    return true;
  }

  if (accountIdentifier && rowObj.account_identifier === accountIdentifier) {
    return true;
  }

  const resolverTargetKeys = jsonParseSafe(rowObj.resolver_target_keys_json, []);
  if (
    targetKey &&
    Array.isArray(resolverTargetKeys) &&
    resolverTargetKeys.includes(targetKey)
  ) {
    return true;
  }

  const brandSites = jsonParseSafe(rowObj.brand_sites_json, []);
  if (
    siteUrl &&
    Array.isArray(brandSites) &&
    brandSites.some(
      x => String(x?.site || "").trim().toLowerCase() === siteUrl
    )
  ) {
    return true;
  }

  return false;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMethod(method) {
  const m = toUpper(method);
  const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (!allowed.includes(m)) {
    const err = new Error(`Method not allowed: ${m}`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
  return m;
}

function normalizePath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    const err = new Error("path must be a relative path starting with '/'.");
    err.code = "path_not_allowed";
    err.status = 400;
    throw err;
  }
  if (/^https?:\/\//i.test(path)) {
    const err = new Error("Full URLs are not allowed.");
    err.code = "path_not_allowed";
    err.status = 403;
    throw err;
  }
  return path;
}

function normalizeProviderDomain(providerDomain) {
  if (!providerDomain || typeof providerDomain !== "string") {
    const err = new Error("provider_domain is required.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  let url;
  try {
    url = new URL(providerDomain);
  } catch {
    const err = new Error("provider_domain must be a valid absolute URL.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    const err = new Error("provider_domain must use http or https.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function safeNormalizeProviderDomain(value) {
  try {
    return value ? normalizeProviderDomain(value) : "";
  } catch {
    return "";
  }
}

function normalizeEndpointProviderDomain(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return normalizeProviderDomain(v);
  return normalizeProviderDomain(`https://${v}`);
}

function isVariablePlaceholder(value, policies = []) {
  const v = String(value || "").trim();
  const dynamicPlaceholder = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Dynamic Provider Domain Placeholder",
      "target_resolved"
    )
  ).trim();

  return /^\{[^}]+\}$/.test(v) || v === dynamicPlaceholder;
}

function sanitizeCallerHeaders(headers = {}) {
  const forbidden = ["proxy-authorization", "host"];
  const clean = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = String(key).toLowerCase();
    if (forbidden.includes(lower)) {
      const err = new Error(`Forbidden header: ${key}`);
      err.code = "forbidden_header";
      err.status = 403;
      throw err;
    }
    if (lower === "authorization") {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function buildUrl(providerDomain, path) {
  const normalizedPath = normalizePath(path);
  const base = new URL(providerDomain);
  const basePath = base.pathname.replace(/\/+$/, "");
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const joinedPath = `${basePath}/${relativePath}`.replace(/\/+/g, "/");
  base.pathname = joinedPath;
  base.search = "";
  return base.toString();
}

function appendQuery(url, query) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

const EXECUTION_RESULT_CLASSIFICATIONS = new Set([
  "resolved_sync",
  "resolved_async",
  "resolved_live",
  "timeout_live",
  "oversized_live",
  "failed_validation",
  "auth_failed",
  "transport_failed",
  "unresolved"
]);

const EXECUTION_ENTRY_TYPES = new Set([
  "sync_execution",
  "async_job",
  "poll_read",
  "validation_run",
  "partial_harvest",
  "oversized_capture"
]);

const EXECUTION_CLASSES = new Set([
  "sync",
  "async",
  "retry",
  "poll",
  "validation",
  "partial_harvest",
  "oversized"
]);
const SMOKE_TEST_SCENARIOS = new Set([
  "sync_success",
  "queued_success",
  "timeout",
  "oversized_artifact",
  "pointer_linkage_validation"
]);
const SMOKE_TEST_RESULTS = new Set(["pass", "fail"]);

const EXECUTION_LOG_UNIFIED_COLUMNS = [
  "Run Date",
  "Start Time",
  "End Time",
  "Duration Seconds",
  "Entry Type",
  "Execution Class",
  "Source Layer",
  "User Input",
  "Matched Aliases",
  "Route Key(s)",
  "Selected Workflows",
  "Engine Chain",
  "Execution Mode",
  "Decision Trigger",
  "Score Before",
  "Score After",
  "Performance Delta",
  "Execution Status",
  "Output Summary",
  "Recovery Status",
  "Recovery Score",
  "Recovery Notes",
  "route_id",
  "route_status",
  "route_source",
  "matched_row_id",
  "intake_validation_status",
  "execution_ready_status",
  "failure_reason",
  "recovery_action",
  "artifact_json_asset_id",
  "target_module_writeback",
  "target_workflow_writeback",
  "execution_trace_id_writeback",
  "log_source_writeback",
  "monitored_row_writeback",
  "performance_impact_row_writeback"
];

const JSON_ASSET_REGISTRY_COLUMNS = [
  "asset_id",
  "brand_name",
  "asset_key",
  "asset_type",
  "cpt_slug",
  "mapping_status",
  "mapping_version",
  "storage_format",
  "google_drive_link",
  "source_mode",
  "source_asset_ref",
  "json_payload",
  "transport_status",
  "validation_status",
  "last_validated_at",
  "notes",
  "active_status"
];

const HOSTING_ACCOUNT_REGISTRY_COLUMNS = [
  "hosting_account_key",
  "hosting_provider",
  "account_identifier",
  "api_auth_mode",
  "api_key_reference",
  "api_key_storage_mode",
  "plan_label",
  "plan_type",
  "account_scope_notes",
  "status",
  "last_reviewed_at",
  "brand_sites_json",
  "resolver_target_keys_json",
  "auth_validation_status",
  "endpoint_binding_status",
  "resolver_execution_ready",
  "last_runtime_check_at",
  "ssh_available",
  "wp_cli_available",
  "shared_access_enabled",
  "account_mode",
  "ssh_host",
  "ssh_port",
  "ssh_username",
  "ssh_auth_mode",
  "ssh_credential_reference",
  "ssh_runtime_notes"
];


const SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "supported_cpts",
  "supported_taxonomies",
  "generated_endpoint_support",
  "runtime_validation_status",
  "last_runtime_validated_at",
  "active_status"
];

const SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "permalink_structure",
  "timezone_string",
  "site_language",
  "active_theme",
  "settings_validation_status",
  "last_settings_validated_at",
  "active_status"
];

const PLUGIN_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "active_plugins",
  "plugin_versions_json",
  "plugin_owned_tables",
  "plugin_owned_entities",
  "plugin_validation_status",
  "last_plugin_validated_at",
  "active_status"
];

// Canonical governance note:
// Task Routes and Workflow Registry are live authority surfaces.
// Do not reintroduce compressed SITE_MIGRATION_* route/workflow row builders.
// Migration readiness must be validated against live canonical sheets only.
const TASK_ROUTES_CANONICAL_COLUMNS = [
  "Task Key",
  "Trigger Terms",
  "Route Modules",
  "Execution Layer",
  "Priority",
  "Enabled",
  "Output Focus",
  "Notes",
  "Entry Sources",
  "Linked Starter Titles",
  "Active Starter Count",
  "Route Key Match Status",
  "row_id",
  "route_id",
  "active",
  "intent_key",
  "brand_scope",
  "request_type",
  "route_mode",
  "target_module",
  "workflow_key",
  "lifecycle_mode",
  "memory_required",
  "logging_required",
  "review_required",
  "priority",
  "allowed_states",
  "degraded_action",
  "blocked_action",
  "match_rule",
  "route_source",
  "last_validated_at"
];

const WORKFLOW_REGISTRY_CANONICAL_COLUMNS = [
  "Workflow ID",
  "Workflow Name",
  "Module Mode",
  "Trigger Source",
  "Input Type",
  "Primary Objective",
  "Mapped Engine(s)",
  "Engine Order",
  "Workflow Type",
  "Primary Output",
  "Input Detection Rules",
  "Output Template",
  "Priority",
  "Route Key",
  "Execution Mode",
  "User Facing",
  "Parent Layer",
  "Status",
  "Linked Workflows",
  "Linked Engines",
  "Notes",
  "Entry Priority Weight",
  "Dependency Type",
  "Output Artifact Type",
  "workflow_key",
  "active",
  "target_module",
  "execution_class",
  "lifecycle_mode",
  "route_compatibility",
  "memory_required",
  "logging_required",
  "review_required",
  "allowed_states",
  "degraded_action",
  "blocked_action",
  "registry_source",
  "last_validated_at"
];

const REQUIRED_SITE_MIGRATION_TASK_KEYS = Object.freeze([
  "route_site_migration",
  "route_site_migration_validation",
  "route_site_migration_repair"
]);

const REQUIRED_SITE_MIGRATION_WORKFLOW_IDS = Object.freeze([
  "wf_wordpress_site_migration",
  "wf_wordpress_runtime_inventory_refresh",
  "wf_wordpress_site_migration_repair"
]);

const GOVERNED_ADDITION_OUTCOMES = new Set([
  "reuse_existing",
  "extend_existing",
  "create_new_route",
  "create_new_workflow",
  "create_chain",
  "create_new_surface",
  "blocked_overlap_conflict",
  "degraded_missing_dependencies",
  "pending_validation"
]);

const GOVERNED_ADDITION_STATES = new Set([
  "candidate",
  "inactive",
  "pending_validation",
  "active",
  "blocked",
  "degraded"
]);

const GOVERNED_BRAND_ONBOARDING_OUTCOMES = new Set([
  "reuse_existing_brand",
  "create_brand_candidate",
  "brand_folder_required",
  "brand_folder_created",
  "brand_identity_build_required",
  "brand_identity_partial",
  "property_binding_required",
  "runtime_binding_required",
  "blocked_duplicate_brand",
  "degraded_missing_brand_dependencies",
  "pending_validation"
]);

function toValuesApiRange(sheetName, a1Tail) {
  return `${String(sheetName || "").trim()}!${a1Tail}`;
}

const EXECUTION_LOG_UNIFIED_RANGE = toValuesApiRange(EXECUTION_LOG_UNIFIED_SHEET, "A1:AQ10");
const JSON_ASSET_REGISTRY_RANGE = toValuesApiRange(JSON_ASSET_REGISTRY_SHEET, "A1:AZ10");
const HOSTING_ACCOUNT_REGISTRY_RANGE = toValuesApiRange(
  HOSTING_ACCOUNT_REGISTRY_SHEET,
  "A:AA"
);

const PROTECTED_UNIFIED_LOG_COLUMNS = new Set();

const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS = [
  "target_module_writeback",
  "target_workflow_writeback",
  "execution_trace_id_writeback",
  "log_source_writeback",
  "monitored_row_writeback",
  "performance_impact_row_writeback"
];

const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN = "AF";
const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN = "AK";
const AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID =
  "surface.operations_log_unified_sheet";

const PREMIUM_RETRY_MUTATION_KEYS = new Set([
  "premium",
  "ultra_premium"
]);

const ROUTING_ONLY_TRANSPORT_FIELDS = new Set([
  "target_key",
  "brand",
  "brand_domain",
  "provider_domain",
  "parent_action_key",
  "endpoint_key",
  "force_refresh",
  "timeout_seconds",
  "readback",
  "expect_json",
  "execution_trace_id"
]);

function retryMutationEnabled(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Enabled", "FALSE")
  ).trim().toUpperCase() === "TRUE";
}

function retryMutationAppliesToQuery(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Apply To", "")
  ).trim() === "query";
}

function retryMutationSchemaModeAllowlisted(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Schema Mode", "")
  ).trim() === "allowlisted";
}

function parseRetryStageValue(stageValue = "") {
  const raw = String(stageValue || "").trim();
  if (!raw || raw === "{}") return {};

  const mutation = {};
  const pairs = raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim().toLowerCase();

    if (!key) continue;
    if (!PREMIUM_RETRY_MUTATION_KEYS.has(key)) continue;

    if (value === "true") mutation[key] = true;
    else if (value === "false") mutation[key] = false;
    else mutation[key] = String(rawValue || "").trim();
  }

  return mutation;
}

function stripRoutingOnlyTransportFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripRoutingOnlyTransportFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const cleaned = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (ROUTING_ONLY_TRANSPORT_FIELDS.has(String(key || "").trim())) {
      continue;
    }
    cleaned[key] = stripRoutingOnlyTransportFields(nestedValue);
  }

  return cleaned;
}

function finalizeTransportBody(body) {
  if (body === undefined) return undefined;
  if (body === null) return null;
  if (Array.isArray(body)) return stripRoutingOnlyTransportFields(body);
  if (typeof body !== "object") return body;
  return stripRoutingOnlyTransportFields(body);
}

function mapExecutionStatus(jobStatus) {
  const status = String(jobStatus || "").trim().toLowerCase();
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    case "retrying":
      return "retrying";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function classifyExecutionResult(args = {}) {
  if (args.oversized) return "oversized_live";
  if (args.error_code === "worker_timeout") return "timeout_live";
  if (args.error_code === "auth_failed") return "auth_failed";
  if (args.error_code === "failed_validation") return "failed_validation";
  if (args.error_code === "transport_failed") return "transport_failed";
  if (args.status === "success" && args.async_mode) return "resolved_async";
  if (args.status === "success") return "resolved_sync";
  return "unresolved";
}

function buildOutputSummary(args = {}) {
  if (args.oversized) {
    return `Oversized response captured for ${args.endpoint_key ?? "unknown_endpoint"}`;
  }
  if (args.error_code) {
    return `${args.endpoint_key ?? "unknown_endpoint"} failed: ${args.error_code}`;
  }
  return `${args.endpoint_key ?? "unknown_endpoint"} completed with status ${args.status}${args.http_status ? ` (${args.http_status})` : ""}`;
}

function createExecutionTraceId() {
  return `trace_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isOversizedBody(value) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
    return bytes > RAW_BODY_MAX_BYTES;
  } catch {
    return true;
  }
}

function buildArtifactFileName(input = {}) {
  const brand = (input.brand_name ?? "unknown_brand")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const endpoint = (input.endpoint_key ?? "unknown_endpoint")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const ts = String(input.captured_at || nowIso()).replace(/[:.]/g, "-");
  return `${brand}__${endpoint}__${ts}__${input.execution_trace_id}.json`;
}

function toExecutionLogUnifiedRow(w) {
  const start = new Date(w.started_at);
  const end = w.completed_at ? new Date(w.completed_at) : undefined;

  return {
    "Run Date": start.toISOString().slice(0, 10),
    "Start Time": start.toISOString(),
    "End Time": end ? end.toISOString() : "",
    "Duration Seconds": w.duration_seconds ?? "",
    "Entry Type": w.entry_type,
    "Execution Class": w.execution_class,
    "Source Layer": w.source_layer,
    "User Input": "",
    "Matched Aliases": "",
    "Route Key(s)": "",
    "Selected Workflows": "",
    "Engine Chain": "",
    "Execution Mode": "",
    "Decision Trigger": "",
    "Score Before": "",
    "Score After": "",
    "Performance Delta": "",
    "Execution Status": w.status,
    "Output Summary": w.output_summary,
    "Recovery Status": "",
    "Recovery Score": "",
    "Recovery Notes": "",
    route_id: w.route_id ?? "",
    route_status: "",
    route_source: "",
    matched_row_id: "",
    intake_validation_status: "",
    execution_ready_status: "",
    failure_reason: w.error_code ?? "",
    recovery_action: "",

    artifact_json_asset_id: w.artifact_json_asset_id ?? "",

    // raw writeback columns
    target_module_writeback: w.target_module ?? "",
    target_workflow_writeback: w.target_workflow ?? "",
    execution_trace_id_writeback: w.execution_trace_id ?? "",
    log_source_writeback: w.log_source ?? "",
    monitored_row_writeback:
      w.monitored_row === undefined || w.monitored_row === null
        ? ""
        : (w.monitored_row ? "TRUE" : "FALSE"),
    performance_impact_row_writeback:
      w.performance_impact_row === undefined || w.performance_impact_row === null
        ? ""
        : (w.performance_impact_row ? "TRUE" : "FALSE")
  };
}

function createJsonAssetId() {
  return `JSON-ASSET-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function toJsonAssetRegistryRow(args = {}) {
  const asset_id = createJsonAssetId();
  const brand = args.brand_name ?? "Unknown Brand";
  const endpoint = args.endpoint_key ?? "unknown_endpoint";
  const inferred_asset_type =
    String(args.parent_action_key || "").trim() === "wordpress_api"
      ? inferWordpressInventoryAssetType(args.endpoint_key)
      : args.job_id
      ? "raw_queue_response_body"
      : "raw_sync_response_body";
  const asset_type = String(args.asset_type || inferred_asset_type).trim();
  const oversized = !!args.oversized;
  const payloadBody = extractJsonAssetPayloadBody(args);
  const embeddedPayload = oversized
    ? ""
    : JSON.stringify(payloadBody ?? null);
  const assetHome = assertJsonAssetWriteAllowed({
    ...args,
    endpoint_key: endpoint,
    asset_type,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`
  });

  return {
    asset_id,
    brand_name: brand,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`,
    asset_type,
    cpt_slug: args.cpt_slug || "",
    mapping_status: "captured_unreduced",
    mapping_version: oversized
      ? "response_body_artifact_v2"
      : "response_body_embedded_v2",
    storage_format: "json",
    google_drive_link: oversized ? args.google_drive_link : "",
    source_mode: "server_writeback_artifact",
    source_asset_ref: oversized ? args.drive_file_id : "",
    json_payload: embeddedPayload,
    transport_status: oversized ? "captured_external" : "captured_embedded",
    validation_status: "pending",
    last_validated_at: args.captured_at,
    notes: oversized
      ? `Oversized derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`
      : `Embedded derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`,
    active_status: "TRUE"
  };
}

function inferWordpressInventoryAssetType(endpointKey = "") {
  const key = String(endpointKey || "").trim();

  if (key === "wordpress_list_tags") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_categories") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_types") return "wordpress_cpt_inventory";

  return "wordpress_runtime_response";
}

const BRAND_CORE_OPERATIONAL_ASSET_TYPES = new Set([
  "profile",
  "profile_asset",
  "playbook",
  "playbook_asset",
  "import_template",
  "import_template_asset",
  "composed_payload",
  "composed_payload_asset",
  "brand_site_profile",
  "brand_publish_playbook",
  "brand_multilingual_import_template",
  "workbook_asset",
  "brand_core_serialized_asset"
]);

function normalizeAssetType(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isDerivedJsonArtifactAssetType(assetType = "") {
  return normalizeAssetType(assetType) === "derived_json_artifact";
}

function isBrandCoreOperationalAssetType(assetType = "") {
  return BRAND_CORE_OPERATIONAL_ASSET_TYPES.has(normalizeAssetType(assetType));
}

function classifyAssetHome(args = {}) {
  const explicitAssetType = normalizeAssetType(args.asset_type);
  const endpointKey = String(args.endpoint_key || "").trim();
  const sourceAssetRef = String(args.source_asset_ref || "").trim();
  const assetKey = String(args.asset_key || "").trim();

  if (isDerivedJsonArtifactAssetType(explicitAssetType)) {
    return {
      asset_class: "derived_json_artifact",
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  if (
    isBrandCoreOperationalAssetType(explicitAssetType) ||
    /^brand_site_profile/i.test(assetKey) ||
    /^brand_publish_playbook/i.test(assetKey) ||
    /^brand_multilingual_import_template/i.test(assetKey) ||
    /^profile_asset/i.test(assetKey) ||
    /^playbook_asset/i.test(assetKey) ||
    /^import_template_asset/i.test(assetKey) ||
    /^composed_payload_asset/i.test(assetKey) ||
    /^brand_site_profile/i.test(sourceAssetRef) ||
    /^brand_publish_playbook/i.test(sourceAssetRef) ||
    /^brand_multilingual_import_template/i.test(sourceAssetRef) ||
    /^profile_asset/i.test(sourceAssetRef) ||
    /^playbook_asset/i.test(sourceAssetRef) ||
    /^import_template_asset/i.test(sourceAssetRef) ||
    /^composed_payload_asset/i.test(sourceAssetRef)
  ) {
    return {
      asset_class: explicitAssetType || "brand_core_operational_asset",
      authoritative_home: "brand_core_registry",
      json_asset_allowed: false
    };
  }

  if (
    endpointKey === "wordpress_list_tags" ||
    endpointKey === "wordpress_list_categories" ||
    endpointKey === "wordpress_list_types"
  ) {
    return {
      asset_class: normalizeAssetType(inferWordpressInventoryAssetType(endpointKey)),
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  return {
    asset_class: explicitAssetType || "derived_json_artifact",
    authoritative_home: "json_asset_registry",
    json_asset_allowed: true
  };
}

function assertJsonAssetWriteAllowed(args = {}) {
  const classification = classifyAssetHome(args);

  if (!classification.json_asset_allowed) {
    const err = new Error(
      `JSON Asset Registry is not the authoritative home for asset_type=${classification.asset_class}. Use ${BRAND_CORE_REGISTRY_SHEET}.`
    );
    err.code = "json_asset_authority_violation";
    err.status = 400;
    err.authoritative_home = classification.authoritative_home;
    err.asset_class = classification.asset_class;
    throw err;
  }

  return classification;
}

function extractJsonAssetPayloadBody(args = {}) {
  const body = args.response_body;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    if (Object.prototype.hasOwnProperty.call(body, "data")) {
      return body.data;
    }
  }

  return body ?? null;
}

function isSchemaMetaOnlyPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  if (keys.length !== 3) return false;

  return (
    Object.prototype.hasOwnProperty.call(value, "request_schema_alignment_status") &&
    Object.prototype.hasOwnProperty.call(value, "openai_schema_file_id") &&
    Object.prototype.hasOwnProperty.call(value, "schema_name")
  );
}

async function findExistingJsonAssetByAssetKey(assetKey = "") {
  const normalizedAssetKey = String(assetKey || "").trim();
  if (!normalizedAssetKey) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID
  );

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(JSON_ASSET_REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(JSON_ASSET_REGISTRY_SHEET, "A:Q")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, JSON_ASSET_REGISTRY_SHEET);

  const assetKeyIdx = map.asset_key;
  if (assetKeyIdx === undefined) return null;

  const transportStatusIdx = map.transport_status;
  const activeStatusIdx = map.active_status;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const existingAssetKey = String(row[assetKeyIdx] || "").trim();
    const transportStatus =
      transportStatusIdx === undefined ? "" : String(row[transportStatusIdx] || "").trim();
    const activeStatus =
      activeStatusIdx === undefined ? "" : String(row[activeStatusIdx] || "").trim();

    if (
      existingAssetKey === normalizedAssetKey &&
      activeStatus === "TRUE" &&
      transportStatus !== ""
    ) {
      return row;
    }
  }

  return null;
}

function normalizeExecutionErrorCode(errorCode = "") {
  const code = String(errorCode || "").trim();
  if (!code) return "";

  if (code === "worker_transport_error") return "transport_failed";
  if (code === "auth_resolution_failed") return "auth_failed";
  if (
    code === "request_schema_mismatch" ||
    code === "response_schema_mismatch" ||
    code === "response_schema_missing"
  ) {
    return "failed_validation";
  }
  return code;
}

function compactErrorMessage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 500);
}

function classifySmokeTestResult(args = {}) {
  if (!SMOKE_TEST_SCENARIOS.has(String(args.scenario || "").trim())) {
    const err = new Error(`Unknown smoke test scenario: ${args.scenario}`);
    err.code = "unknown_smoke_test_scenario";
    err.status = 400;
    throw err;
  }

  const result = args.passed ? "pass" : "fail";
  if (!SMOKE_TEST_RESULTS.has(result)) {
    const err = new Error(`Invalid smoke test result: ${result}`);
    err.code = "invalid_smoke_test_result";
    err.status = 500;
    throw err;
  }
  return result;
}

function buildSmokeTestSummary(args = {}) {
  const scenario = String(args.scenario || "").trim();
  const result = classifySmokeTestResult(args);
  const note = String(args.note || "").trim();
  return note
    ? `[${result}] ${scenario}: ${note}`
    : `[${result}] ${scenario}`;
}

async function runWritebackSmokeTest(input = {}) {
  const scenario = String(input.scenario || "").trim();
  const passed = !!input.passed;
  const result = classifySmokeTestResult({ scenario, passed });

  return {
    scenario,
    result,
    summary: buildSmokeTestSummary({
      scenario,
      passed,
      note: input.note || ""
    }),
    execution_trace_id: String(input.execution_trace_id || "").trim(),
    artifact_expected: !!input.artifact_expected,
    artifact_observed: !!input.artifact_observed,
    pointer_linkage_expected: !!input.pointer_linkage_expected,
    pointer_linkage_observed: !!input.pointer_linkage_observed
  };
}

function evaluateWritebackSmokeSuite(args = {}) {
  const checks = [
    runWritebackSmokeTest({
      scenario: "sync_success",
      passed: !!args.sync_success,
      note: args.sync_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "queued_success",
      passed: !!args.queued_success,
      note: args.queued_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "timeout",
      passed: !!args.timeout,
      note: args.timeout_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "oversized_artifact",
      passed: !!args.oversized_artifact,
      note: args.oversized_artifact_note || "",
      artifact_expected: true,
      artifact_observed: !!args.oversized_artifact
    }),
    runWritebackSmokeTest({
      scenario: "pointer_linkage_validation",
      passed: !!args.pointer_linkage_validation,
      note: args.pointer_linkage_validation_note || "",
      pointer_linkage_expected: true,
      pointer_linkage_observed: !!args.pointer_linkage_validation
    })
  ];

  return Promise.all(checks).then(results => ({
    overall:
      results.every(r => r.result === "pass") ? "pass" : "fail",
    results
  }));
}

function assertExecutionLogRowIsSpillSafe(row) {
  const rowText = JSON.stringify(row);
  if (rowText.length > 50_000) {
    throw new Error("Activity Log row exceeded safe compact-write size.");
  }

  const forbiddenLiteralColumns = [];

  const populated = forbiddenLiteralColumns.filter(
    key => String(row?.[key] ?? "").trim() !== ""
  );

  if (populated.length) {
    const err = new Error(
      `Activity Log row must not provide literal values for formula-managed columns: ${populated.join(", ")}`
    );
    err.code = "formula_managed_columns_literal_value";
    err.status = 500;
    throw err;
  }

  const requiredRawWritebackColumns = [
    "target_module_writeback",
    "target_workflow_writeback",
    "execution_trace_id_writeback",
    "log_source_writeback",
    "monitored_row_writeback",
    "performance_impact_row_writeback"
  ];

  const missingRawValues = requiredRawWritebackColumns.filter(
    key => !Object.prototype.hasOwnProperty.call(row, key)
  );

  if (missingRawValues.length) {
    const err = new Error(
      `Activity Log row missing raw writeback columns: ${missingRawValues.join(", ")}`
    );
    err.code = "missing_raw_writeback_columns";
    err.status = 500;
    throw err;
  }
}

async function persistOversizedArtifact(input = {}) {
  const { drive } = await getGoogleClients();
  const artifact_file_name = buildArtifactFileName({
    brand_name: input.brand_name || input.target_key || "unknown_brand",
    endpoint_key: input.endpoint_key,
    captured_at: input.captured_at,
    execution_trace_id: input.execution_trace_id
  });

  const requestBody = {
    name: artifact_file_name,
    mimeType: "application/json"
  };

  if (OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID) {
    requestBody.parents = [OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID];
  }

  const created = await drive.files.create({
    requestBody,
    media: {
      mimeType: "application/json",
      body: JSON.stringify(input.body ?? null, null, 2)
    },
    fields: "id,webViewLink"
  });

  const drive_file_id = String(created?.data?.id || "").trim();
  if (!drive_file_id) {
    throw new Error("Oversized artifact write succeeded without a Drive file id.");
  }

  return {
    drive_file_id,
    google_drive_link:
      String(created?.data?.webViewLink || "").trim() ||
      `https://drive.google.com/file/d/${drive_file_id}/view`,
    artifact_file_name
  };
}

async function performUniversalServerWriteback(input = {}) {
  const started_at = input.started_at || new Date().toISOString();
  const execution_trace_id = input.execution_trace_id ?? createExecutionTraceId();
  const responseBody = input.responseBody;

  const completed_at = new Date().toISOString();
  const durationMs =
    new Date(completed_at).getTime() - new Date(started_at).getTime();
  const duration_seconds =
    Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs / 1000
      : undefined;

  const oversized = isOversizedBody(responseBody);
  const status = mapExecutionStatus(input.status_source);
  const error_code = normalizeExecutionErrorCode(input.error_code);
  const result_classification = classifyExecutionResult({
    status,
    error_code,
    oversized,
    async_mode: input.mode === "async"
  });

  let artifactPointer;
  let jsonAssetRow;
  let artifactJsonAssetId = "";

  const extractedJsonAssetBody = extractJsonAssetPayloadBody({
    parent_action_key: input.parent_action_key,
    response_body: responseBody
  });

  const isMeaningfulJsonAssetBody =
    Array.isArray(extractedJsonAssetBody) ||
    (
      extractedJsonAssetBody &&
      typeof extractedJsonAssetBody === "object" &&
      Object.keys(extractedJsonAssetBody).length > 0 &&
      !isSchemaMetaOnlyPayload(extractedJsonAssetBody)
    );

  const assetHome = classifyAssetHome({
    asset_type: input.asset_type,
    endpoint_key: input.endpoint_key,
    source_asset_ref: input.source_asset_ref,
    asset_key: input.asset_key
  });

  const shouldPersistJsonAsset =
    assetHome.json_asset_allowed &&
    (
      oversized ||
      status === "failed" ||
      (
        status === "success" &&
        isMeaningfulJsonAssetBody
      )
    );

  if (oversized) {
    const artifact = await persistOversizedArtifact({
      brand_name: input.brand_name,
      target_key: input.target_key,
      endpoint_key: input.endpoint_key,
      execution_trace_id,
      captured_at: started_at,
      body: extractedJsonAssetBody
    });

    artifactPointer = {
      drive_file_id: artifact.drive_file_id,
      google_drive_link: artifact.google_drive_link
    };
  }

  if (shouldPersistJsonAsset) {
    const nextAssetKey = `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`;
    const existingAssetRow = await findExistingJsonAssetByAssetKey(nextAssetKey);

    if (!existingAssetRow) {
      jsonAssetRow = toJsonAssetRegistryRow({
        brand_name: input.brand_name,
        endpoint_key: input.endpoint_key,
        parent_action_key: input.parent_action_key,
        execution_trace_id,
        google_drive_link: artifactPointer?.google_drive_link || "",
        drive_file_id: artifactPointer?.drive_file_id || "",
        captured_at: completed_at,
        job_id: input.job_id,
        oversized,
        response_body: extractedJsonAssetBody,
        cpt_slug: input.cpt_slug || "",
        asset_type: input.asset_type || assetHome.asset_class,
        asset_key: input.asset_key || `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`,
        source_asset_ref: input.source_asset_ref || ""
      });

      artifactJsonAssetId = String(jsonAssetRow.asset_id || "").trim();
    }
  }

  const writeback = {
    execution_trace_id,
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    response_body_embedded: !oversized,
    response_body_oversized: oversized,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    entry_type: oversized
      ? "oversized_capture"
      : EXECUTION_ENTRY_TYPES.has(input.entry_type)
      ? input.entry_type
      : "sync_execution",
    execution_class: oversized
      ? "oversized"
      : EXECUTION_CLASSES.has(input.execution_class)
      ? input.execution_class
      : "sync",
    source_layer: String(input.source_layer || "unknown_layer"),
    status,
    result_classification: EXECUTION_RESULT_CLASSIFICATIONS.has(result_classification)
      ? result_classification
      : "unresolved",
    error_code: error_code || undefined,
    error_message_short: compactErrorMessage(input.error_message_short) || undefined,
    started_at,
    completed_at,
    duration_seconds,
    attempt_count:
      input.attempt_count === undefined || input.attempt_count === null
        ? undefined
        : Number(input.attempt_count),
    output_summary: buildOutputSummary({
      endpoint_key: input.endpoint_key,
      status,
      http_status: input.http_status,
      error_code,
      oversized
    }),
    monitored_row: false,
    performance_impact_row: false,
    log_source: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    artifact_pointer: artifactPointer,
    artifact_json_asset_id: artifactJsonAssetId
  };

  let governedSinkSheetTitles = {
    executionLogTitles: [],
    jsonAssetTitles: []
  };
  try {
    governedSinkSheetTitles = await assertGovernedSinkSheetsExist();
  } catch (err) {
    err.error_code = "governed_sink_sheet_missing";
    throw err;
  }

  const row = toExecutionLogUnifiedRow(writeback);
  let executionLogWriteMeta;
  let jsonAssetWriteMeta;
  let workflowLogRetryAttempted = false;
  assertExecutionLogRowIsSpillSafe(row);

  try {
    executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
  } catch (err) {
    workflowLogRetryAttempted = true;
    try {
      executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
    } catch (retryErr) {
      retryErr.error_code =
        retryErr.error_code || err.error_code || "authoritative_log_write_failed";
      retryErr.logging_retry_attempted = true;
      retryErr.logging_retry_exhausted = true;
      throw retryErr;
    }
  }

  if (jsonAssetRow) {
    try {
      jsonAssetWriteMeta = await writeJsonAssetRegistryRow(jsonAssetRow);
    } catch (err) {
      // do not erase primary execution truth because registry follow-up failed
      console.error("JSON Asset Registry write failed", err);
    }
  }

  const governedWriteState = {
    execution_log_surface_id: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    execution_log_sheet: EXECUTION_LOG_UNIFIED_SHEET,
    json_asset_registry_sheet: JSON_ASSET_REGISTRY_SHEET,
    execution_log_spreadsheet_id: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    json_asset_registry_spreadsheet_id: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    authoritative_raw_execution_sink: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    raw_execution_single_write_enforced: true,
    execution_log_sheet_exists: governedSinkSheetTitles.executionLogTitles.includes(
      String(EXECUTION_LOG_UNIFIED_SHEET || "").trim()
    ),
    json_asset_registry_sheet_exists: governedSinkSheetTitles.jsonAssetTitles.includes(
      String(JSON_ASSET_REGISTRY_SHEET || "").trim()
    ),

    execution_log_header_schema_validated: !!executionLogWriteMeta?.headerSignature,
    execution_log_row2_template_read: !!executionLogWriteMeta?.row2Read,
    execution_log_formula_managed_columns_protected:
      !!executionLogWriteMeta?.formulaManagedColumnsProtected,
    execution_log_readback_verified: true,
    workflow_log_retry_attempted: workflowLogRetryAttempted,
    workflow_log_retry_exhausted: false,

    json_asset_header_schema_validated: jsonAssetRow
      ? !!jsonAssetWriteMeta?.headerSignature
      : null,
    json_asset_row2_template_read: jsonAssetRow
      ? !!jsonAssetWriteMeta?.row2Read
      : null,
    json_asset_readback_verified: jsonAssetRow
      ? !!jsonAssetWriteMeta
      : null,

    prewrite_header_schema_validated:
      !!executionLogWriteMeta?.headerSignature &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.headerSignature : true),

    prewrite_row2_template_read:
      !!executionLogWriteMeta?.row2Read &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.row2Read : true),

    execution_log_safe_columns: executionLogWriteMeta?.safeColumns || [],
    execution_log_unsafe_columns: executionLogWriteMeta?.unsafeColumns || [],
    json_asset_safe_columns: jsonAssetWriteMeta?.safeColumns || [],
    json_asset_unsafe_columns: jsonAssetWriteMeta?.unsafeColumns || [],
    asset_class: assetHome.asset_class,
    authoritative_asset_home: assetHome.authoritative_home,
    json_asset_write_allowed: assetHome.json_asset_allowed,
    artifact_json_asset_id: jsonAssetRow?.asset_id || "",
    artifact_drive_file_id: artifactPointer?.drive_file_id || "",
    artifact_google_drive_link: artifactPointer?.google_drive_link || ""
  };

  return {
    execution_trace_id,
    writeback,
    row,
    jsonAssetRow,
    governedWriteState
  };
}

async function logValidationRunWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "validation",
    job_id: undefined,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "system_bootstrap",
    entry_type: "validation_run",
    execution_class: "validation",
    attempt_count: input.attempt_count ?? 1,
    status_source: input.validationStatus,
    responseBody: input.validationPayload,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: undefined,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

async function logPartialHarvestWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "partial_harvest",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "partial_harvest",
    execution_class: "partial_harvest",
    attempt_count: input.attempt_count,
    status_source: input.status_source,
    responseBody: input.harvestedChunk,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

async function logRetryWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "async",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "async_job",
    execution_class: "retry",
    attempt_count: input.attempt_count,
    status_source: "retrying",
    responseBody: input.responseBody,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

function normalizeExecutionPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const query =
    safePayload.query && typeof safePayload.query === "object"
      ? safePayload.query
      : safePayload.params?.query &&
        typeof safePayload.params.query === "object"
      ? safePayload.params.query
      : {};

  const body = Object.prototype.hasOwnProperty.call(safePayload, "body")
    ? safePayload.body
    : undefined;

  const routingFields = normalizeTopLevelRoutingFields(safePayload);

  return {
    ...safePayload,
    ...routingFields,
    query,
    body
  };
}

function normalizeTopLevelRoutingFields(payload = {}) {
  return {
    target_key: payload.target_key,
    brand: payload.brand,
    brand_domain: payload.brand_domain,
    provider_domain: payload.provider_domain,
    parent_action_key: payload.parent_action_key,
    endpoint_key: payload.endpoint_key,
    method: payload.method,
    path: payload.path,
    force_refresh: payload.force_refresh
  };
}

function validatePayloadIntegrity(originalPayload = {}, normalizedPayload = {}) {
  const trackedFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path"
  ];

  const mismatches = [];

  for (const field of trackedFields) {
    const originalValue = originalPayload[field];
    const normalizedValue = normalizedPayload[field];

    const originalText = originalValue === undefined ? "" : String(originalValue);
    const normalizedText = normalizedValue === undefined ? "" : String(normalizedValue);

    if (originalText !== normalizedText) {
      mismatches.push({
        field,
        original: originalValue ?? "",
        normalized: normalizedValue ?? ""
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

function validateTopLevelRoutingFields(payload = {}, policies = []) {
  const requireTopLevelSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Placeholder Resolution Sources Must Be Top-Level",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowNestedSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Nested Placeholder Resolution Sources Allowed",
      "TRUE"
    )
  ).trim().toUpperCase() === "TRUE";

  const errors = [];

  const topLevelHasSource =
    !!String(payload.target_key || "").trim() ||
    !!String(payload.brand || "").trim() ||
    !!String(payload.brand_domain || "").trim();

  const nestedBody = payload.body && typeof payload.body === "object" ? payload.body : {};
  const isDelegatedWrapper = isDelegatedHttpExecuteWrapper(payload);

  const nestedHasSource =
    !!String(nestedBody.target_key || "").trim() ||
    !!String(nestedBody.brand || "").trim() ||
    !!String(nestedBody.brand_domain || "").trim();

  if (requireTopLevelSources && payload.provider_domain === "target_resolved" && !topLevelHasSource) {
    errors.push("top-level target_key, brand, or brand_domain is required when provider_domain is target_resolved");
  }

  if (!allowNestedSources && nestedHasSource && !isDelegatedWrapper) {
    errors.push("target_key, brand, and brand_domain must be top-level fields; nested body.* routing fields are not allowed");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string");
  }

  if (payload.method !== undefined && typeof payload.method !== "string") {
    errors.push("method must be a string");
  }

  if (payload.path !== undefined && typeof payload.path !== "string") {
    errors.push("path must be a string");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function validateAssetHomePayloadRules(payload = {}) {
  const assetType = normalizeAssetType(payload.asset_type);
  if (!assetType) {
    return { ok: true, errors: [] };
  }

  const classification = classifyAssetHome({
    asset_type: assetType,
    endpoint_key: payload.endpoint_key,
    source_asset_ref: payload.source_asset_ref,
    asset_key: payload.asset_key
  });

  if (
    classification.authoritative_home === "brand_core_registry" &&
    String(payload.force_json_asset_write || "").trim().toUpperCase() === "TRUE"
  ) {
    return {
      ok: false,
      errors: [
        `asset_type=${assetType} must not force JSON Asset Registry write; authoritative home is ${BRAND_CORE_REGISTRY_SHEET}`
      ]
    };
  }

  return { ok: true, errors: [] };
}

function isHttpGenericTransportEndpointKey(endpointKey = "") {
  return [
    "http_get",
    "http_post",
    "http_put",
    "http_patch",
    "http_delete"
  ].includes(String(endpointKey || "").trim());
}

function isDelegatedHttpExecuteWrapper(payload = {}) {
  return (
    String(payload.parent_action_key || "").trim() === "http_generic_api" &&
    isHttpGenericTransportEndpointKey(payload.endpoint_key) &&
    String(payload.path || "").trim() === "/http-execute"
  );
}

function isWordPressAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "wordpress_api";
}

function promoteDelegatedExecutionPayload(payload = {}) {
  if (!isDelegatedHttpExecuteWrapper(payload)) {
    return payload;
  }

  const nested = payload.body && typeof payload.body === "object" ? payload.body : {};

  const nestedHeaders =
    nested.headers && typeof nested.headers === "object"
      ? nested.headers
      : undefined;

  const nestedQuery =
    nested.query && typeof nested.query === "object"
      ? nested.query
      : undefined;

  const nestedPathParams =
    nested.path_params && typeof nested.path_params === "object"
      ? nested.path_params
      : undefined;

  return {
    ...payload,

    // routing-source
    target_key: payload.target_key || nested.target_key,
    brand: payload.brand || nested.brand,
    brand_domain: payload.brand_domain || nested.brand_domain,

    // execution-target
    provider_domain: nested.provider_domain || payload.provider_domain,
    parent_action_key: nested.parent_action_key || payload.parent_action_key,
    endpoint_key: nested.endpoint_key || payload.endpoint_key,
    method: nested.method || payload.method,
    path: nested.path || payload.path,
    force_refresh: nested.force_refresh ?? payload.force_refresh,
    timeout_seconds: nested.timeout_seconds ?? payload.timeout_seconds,
    expect_json: nested.expect_json ?? payload.expect_json,
    readback: nested.readback ?? payload.readback,

    headers: nestedHeaders || payload.headers,
    query: nestedQuery || payload.query,
    path_params: nestedPathParams || payload.path_params,
    body: Object.prototype.hasOwnProperty.call(nested, "body")
      ? nested.body
      : payload.body
  };
}

function isHostingerAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "hostinger_api";
}

function isSiteTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.endsWith("_wp") ||
    v.startsWith("site_") ||
    v.startsWith("brand_") ||
    v.includes("_wordpress")
  );
}

function isHostingAccountTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.startsWith("hostinger_") ||
    v.includes("_shared_manager_") ||
    v.includes("_hosting_account_") ||
    v.includes("_cloud_plan_") ||
    v.includes("_account_")
  );
}

function assertHostingerTargetTier(payload = {}) {
  const parentActionKey = String(payload.parent_action_key || "").trim();
  const endpointKey = String(payload.endpoint_key || "").trim();
  const targetKey = String(payload.target_key || "").trim();

  if (!isHostingerAction(parentActionKey)) {
    return { ok: true };
  }

  if (!targetKey) {
    const err = new Error(
      "Hostinger execution requires an authoritative hosting-account target_key."
    );
    err.code = "hostinger_target_key_missing";
    err.status = 400;
    throw err;
  }

  if (isSiteTargetKey(targetKey) && !isHostingAccountTargetKey(targetKey)) {
    const err = new Error(
      `Hostinger endpoint ${endpointKey} must resolve through a hosting-account target_key, not a WordPress/site target_key (${targetKey}).`
    );
    err.code = "hostinger_target_tier_mismatch";
    err.status = 400;
    throw err;
  }

  return { ok: true };
}

function headerMap(headerRow, sheetName = "unknown_sheet") {
  const map = {};
  const duplicates = [];

  headerRow.forEach((rawName, idx) => {
    const name = String(rawName || "").trim();
    if (!name) return;

    if (Object.prototype.hasOwnProperty.call(map, name)) {
      duplicates.push(name);
      return;
    }

    map[name] = idx;
  });

  if (duplicates.length) {
    const err = new Error(
      `Duplicate headers detected in ${sheetName}: ${[...new Set(duplicates)].join(", ")}`
    );
    err.code = "duplicate_sheet_headers";
    err.status = 500;
    throw err;
  }

  return map;
}

function getCell(row, map, key) {
  const idx = map[key];
  return idx === undefined ? "" : (row[idx] ?? "");
}

async function getGoogleClients() {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

async function getGoogleClientsForSpreadsheet(spreadsheetId) {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  if (!String(spreadsheetId || "").trim()) {
    const err = new Error("Missing required spreadsheet id for governed sink.");
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    spreadsheetId: String(spreadsheetId || "").trim(),
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

async function assertSheetExistsInSpreadsheet(spreadsheetId, sheetName) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties.title"
  });

  const titles = (response.data.sheets || [])
    .map(s => String(s?.properties?.title || "").trim())
    .filter(Boolean);

  const normalizedSheetName = String(sheetName || "").trim();
  if (!titles.includes(normalizedSheetName)) {
    const err = new Error(
      `Governed sink sheet not found: ${normalizedSheetName}. Available sheets: ${titles.join(", ")}`
    );
    err.code = "sheet_not_found";
    err.status = 500;
    err.available_sheets = titles;
    err.requested_sheet = normalizedSheetName;
    err.spreadsheet_id = String(spreadsheetId || "").trim();
    throw err;
  }

  return titles;
}

async function assertGovernedSinkSheetsExist() {
  const executionLogTitles = await assertSheetExistsInSpreadsheet(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const jsonAssetTitles = await assertSheetExistsInSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET
  );

  return {
    executionLogTitles,
    jsonAssetTitles
  };
}

async function fetchRange(sheets, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    range
  });
  return response.data.values || [];
}

function toSheetCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function toA1Start(sheetName) {
  return toValuesApiRange(sheetName, "A1");
}

async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const row2 = (values[1] || []).map(v => String(v || "").trim());

  if (!header.length) {
    const err = new Error(`${sheetName} header row is empty.`);
    err.code = "sheet_header_missing";
    err.status = 500;
    throw err;
  }

  return {
    header,
    row2,
    headerMap: headerMap(header, sheetName),
    columnCount: header.length
  };
}

async function getRegistrySurfaceCatalogRowBySurfaceId(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim();
  if (!normalizedSurfaceId) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A:AG")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const map = headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET);

  for (const row of values.slice(1)) {
    const rowSurfaceId = String(getCell(row, map, "surface_id") || "").trim();
    if (rowSurfaceId !== normalizedSurfaceId) continue;

    return {
      surface_id: rowSurfaceId,
      surface_name: String(getCell(row, map, "surface_name") || "").trim(),
      worksheet_name: String(getCell(row, map, "worksheet_name") || "").trim(),
      worksheet_gid: String(getCell(row, map, "worksheet_gid") || "").trim(),
      active_status: String(getCell(row, map, "active_status") || "").trim(),
      authority_status: String(getCell(row, map, "authority_status") || "").trim(),
      required_for_execution: String(getCell(row, map, "required_for_execution") || "").trim(),
      schema_ref: String(getCell(row, map, "schema_ref") || "").trim(),
      schema_version: String(getCell(row, map, "schema_version") || "").trim(),
      header_signature: String(getCell(row, map, "header_signature") || "").trim(),
      expected_column_count: String(getCell(row, map, "expected_column_count") || "").trim(),
      binding_mode: String(getCell(row, map, "binding_mode") || "").trim(),
      sheet_role: String(getCell(row, map, "sheet_role") || "").trim(),
      audit_mode: String(getCell(row, map, "audit_mode") || "").trim(),
      legacy_surface_containment_required: String(
        getCell(row, map, "legacy_surface_containment_required") || ""
      ).trim(),
      repair_candidate_types: String(getCell(row, map, "repair_candidate_types") || "").trim(),
      repair_priority: String(getCell(row, map, "repair_priority") || "").trim()
    };
  }

  return null;
}

function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return (columns || []).map(v => String(v || "").trim()).join("|");
}

function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return Array.isArray(fallbackColumns) ? fallbackColumns.length : 0;
}

async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}) {
  const row = await getRegistrySurfaceCatalogRowBySurfaceId(surfaceId);

  if (!row) {
    return {
      source: "fallback_constant",
      surface_id: surfaceId,
      schema_ref: fallback.schema_ref || "",
      schema_version: fallback.schema_version || "",
      header_signature: buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
      expected_column_count: Array.isArray(fallback.columns) ? fallback.columns.length : 0,
      binding_mode: fallback.binding_mode || "constant_fallback",
      sheet_role: fallback.sheet_role || "",
      audit_mode: fallback.audit_mode || ""
    };
  }

  return {
    source: "registry_surface_catalog",
    surface_id: row.surface_id,
    schema_ref: row.schema_ref,
    schema_version: row.schema_version,
    header_signature:
      row.header_signature || buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
    expected_column_count: normalizeExpectedColumnCount(
      row.expected_column_count,
      fallback.columns || []
    ),
    binding_mode: row.binding_mode || fallback.binding_mode || "",
    sheet_role: row.sheet_role || fallback.sheet_role || "",
    audit_mode: row.audit_mode || fallback.audit_mode || "",
    authority_status: row.authority_status || "",
    active_status: row.active_status || "",
    required_for_execution: row.required_for_execution || "",
    legacy_surface_containment_required: row.legacy_surface_containment_required || ""
  };
}

function assertHeaderMatchesSurfaceMetadata(args = {}) {
  const sheetName = String(args.sheetName || "sheet").trim();
  const actualHeader = (args.actualHeader || []).map(v => String(v || "").trim());
  const metadata = args.metadata || {};
  const fallbackColumns = args.fallbackColumns || [];

  const expectedColumnCount = normalizeExpectedColumnCount(
    metadata.expected_column_count,
    fallbackColumns
  );

  const expectedSignature =
    String(metadata.header_signature || "").trim() ||
    buildExpectedHeaderSignatureFromCanonical(fallbackColumns);

  const actualSignature = actualHeader.join("|");

  if (expectedColumnCount && actualHeader.length !== expectedColumnCount) {
    const err = new Error(
      `${sheetName} header column count mismatch from surface metadata. expected=${expectedColumnCount} actual=${actualHeader.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (expectedSignature && actualSignature !== expectedSignature) {
    const err = new Error(
      `${sheetName} header signature mismatch from surface metadata.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (String(metadata.audit_mode || "").trim() === "exact_header_match") {
    assertCanonicalHeaderExact(actualHeader, fallbackColumns, sheetName);
  }

  return true;
}

function computeHeaderSignature(header = []) {
  return crypto
    .createHash("sha256")
    .update(header.map(v => String(v || "").trim()).join("|"))
    .digest("hex");
}

function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  const missing = required.filter(col => !header.includes(col));
  if (missing.length) {
    const err = new Error(
      `${sheetName} missing required columns: ${missing.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

function detectUnsafeColumnsFromRow2(header = [], row2 = []) {
  const unsafe = new Set();

  for (let i = 0; i < header.length; i += 1) {
    const colName = String(header[i] || "").trim();
    const sample = String(row2[i] || "").trim();

    if (!colName) continue;

    const looksFormula =
      sample.startsWith("=") ||
      sample.includes("ARRAYFORMULA(") ||
      sample.includes("=arrayformula(");

    if (looksFormula) {
      unsafe.add(colName);
    }
  }

  return unsafe;
}

function buildGovernedWritePlan(args = {}) {
  const protectedColumns = args.protectedColumns || new Set();
  const unsafeFromRow2 = detectUnsafeColumnsFromRow2(args.header, args.row2);

  const safeColumns = [];
  const unsafeColumns = [];

  for (const col of args.requestedColumns || []) {
    if (!args.header.includes(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (protectedColumns.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (unsafeFromRow2.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    safeColumns.push(col);
  }

  return {
    header: args.header || [],
    row2: args.row2 || [],
    safeColumns,
    unsafeColumns
  };
}

function assertExecutionLogFormulaColumnsProtected(plan = {}, sheetName = "Execution Log Unified") {
  const missingRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !(plan.header || []).includes(col)
  );

  if (missingRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${missingRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

function buildFullWidthGovernedRow(header = [], safeColumns = [], rowObject = {}) {
  const safeSet = new Set(safeColumns);
  return header.map(col => {
    const columnName = String(col || "").trim();
    if (!columnName) return "";
    if (!safeSet.has(columnName)) return "";
    return toSheetCellValue(rowObject[columnName]);
  });
}

function buildColumnSliceRow(columns = [], rowObject = {}) {
  return columns.map(col => toSheetCellValue(rowObject[col]));
}

const HIGH_RISK_GOVERNED_SHEETS = new Set([
  EXECUTION_POLICY_SHEET,
  TASK_ROUTES_SHEET,
  WORKFLOW_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET,
  ENDPOINT_REGISTRY_SHEET,
  REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET,
  BRAND_REGISTRY_SHEET,
  BRAND_CORE_REGISTRY_SHEET,
  JSON_ASSET_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SHEET
]);

async function loadLiveGovernedChangeControlPolicies() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const rows = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A:H")
  );

  if (!rows.length) {
    const err = new Error("Execution Policy Registry is empty.");
    err.code = "policy_registry_unavailable";
    err.status = 500;
    throw err;
  }

  const header = rows[0].map(v => String(v || "").trim());
  const map = headerMap(header, EXECUTION_POLICY_SHEET);
  const body = rows.slice(1);

  return body
    .filter(row => {
      const group = String(getCell(row, map, "policy_group") || "").trim();
      const active = String(getCell(row, map, "active") || "").trim().toUpperCase();
      return group === "Governed Change Control" && active === "TRUE";
    })
    .map(row => ({
      policy_group: String(getCell(row, map, "policy_group") || "").trim(),
      policy_key: String(getCell(row, map, "policy_key") || "").trim(),
      policy_value: String(getCell(row, map, "policy_value") || "").trim(),
      active: String(getCell(row, map, "active") || "").trim(),
      execution_scope: String(getCell(row, map, "execution_scope") || "").trim(),
      owner_module: String(getCell(row, map, "owner_module") || "").trim(),
      enforcement_required: String(getCell(row, map, "enforcement_required") || "").trim(),
      notes: String(getCell(row, map, "notes") || "").trim()
    }));
}

function governedPolicyValue(policies = [], key = "", fallback = "") {
  const row = policies.find(
    policy => String(policy.policy_key || "").trim() === String(key || "").trim()
  );
  return row ? String(row.policy_value || "").trim() : fallback;
}

function governedPolicyEnabled(policies = [], key = "", fallback = false) {
  const fallbackText = fallback ? "TRUE" : "FALSE";
  return (
    String(governedPolicyValue(policies, key, fallbackText)).trim().toUpperCase() === "TRUE"
  );
}

async function readRelevantExistingRowWindow(
  spreadsheetId,
  sheetName,
  scanRangeA1 = "A:Z"
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, scanRangeA1)
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const rows = values.slice(1);

  return {
    header,
    headerMap: headerMap(header, sheetName),
    rows
  };
}

function normalizeSemanticValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findSemanticDuplicateRows(header = [], rows = [], rowObject = {}) {
  if (!header.length || !rows.length) return [];

  const candidateKeys = Object.keys(rowObject).filter(
    key => normalizeSemanticValue(rowObject[key]) !== ""
  );

  if (!candidateKeys.length) return [];

  return rows
    .map((row, idx) => {
      let score = 0;
      for (const key of candidateKeys) {
        const colIdx = header.indexOf(key);
        if (colIdx === -1) continue;
        if (
          normalizeSemanticValue(row[colIdx]) ===
          normalizeSemanticValue(rowObject[key])
        ) {
          score += 1;
        }
      }
      return { rowNumber: idx + 2, score, row };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function classifyGovernedMutationIntent(args = {}) {
  const {
    mutationType = "append",
    duplicateCandidates = [],
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  if (mutationType === "append") {
    if (duplicateCandidates.length) return "blocked_duplicate";
    return "append_new";
  }

  if (mutationType === "update") {
    if (renameOnly) return "rename_existing";
    if (mergeCandidate) return "merge_existing";
    if (targetRowNumber) return "update_existing";
    return "blocked_policy_unconfirmed";
  }

  if (mutationType === "delete") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  if (mutationType === "repair") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  return "blocked_policy_unconfirmed";
}

function resolveGovernedTargetRowNumber(args = {}) {
  const {
    targetRowNumber = null,
    duplicateCandidates = []
  } = args;

  if (Number.isInteger(targetRowNumber) && targetRowNumber >= 2) {
    return targetRowNumber;
  }

  if (duplicateCandidates.length === 1) {
    return duplicateCandidates[0].rowNumber;
  }

  return null;
}

async function enforceGovernedMutationPreflight(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    rowObject = {},
    mutationType = "append",
    scanRangeA1 = "A:Z",
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  const policies = await loadLiveGovernedChangeControlPolicies();

  if (
    governedPolicyEnabled(
      policies,
      "Live Policy Read Required Before Any Mutation",
      true
    ) !== true
  ) {
    const err = new Error("Live governed change-control policy confirmation failed.");
    err.code = "governed_policy_confirmation_failed";
    err.status = 500;
    throw err;
  }

  const appliesToAllSheets = governedPolicyEnabled(
    policies,
    "Applies To All Authoritative System Sheets",
    true
  );

  if (!appliesToAllSheets) {
    return {
      ok: true,
      classification: "append_new",
      duplicateCandidates: [],
      consultedPolicyKeys: policies.map(p => p.policy_key),
      consultedExistingRows: [],
      enforcementBypassed: true
    };
  }

  const existingWindow = await readRelevantExistingRowWindow(
    spreadsheetId,
    sheetName,
    scanRangeA1
  );

  const duplicateCandidates = governedPolicyEnabled(
    policies,
    "Semantic Duplicate Check Required Before Append",
    true
  )
    ? findSemanticDuplicateRows(existingWindow.header, existingWindow.rows, rowObject)
    : [];

  const isHighRiskSheet = HIGH_RISK_GOVERNED_SHEETS.has(String(sheetName || "").trim());
  const resolvedTargetRowNumber = resolveGovernedTargetRowNumber({
    targetRowNumber,
    duplicateCandidates
  });
  const classification = classifyGovernedMutationIntent({
    mutationType,
    duplicateCandidates,
    targetRowNumber: resolvedTargetRowNumber,
    renameOnly,
    mergeCandidate
  });

  if (
    mutationType === "append" &&
    duplicateCandidates.length &&
    governedPolicyEnabled(
      policies,
      "Append Forbidden When Update Or Rename Suffices",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} append blocked because semantically equivalent live rows already exist.`
    );
    err.code = "governed_duplicate_append_blocked";
    err.status = 409;
    err.mutation_classification = "blocked_duplicate";
    err.duplicate_candidates = duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    }));
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  if (
    mutationType !== "append" &&
    !resolvedTargetRowNumber &&
    governedPolicyEnabled(
      policies,
      "Pre-Mutation Change Classification Required",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} ${mutationType} blocked because no governed target row could be resolved.`
    );
    err.code = "governed_target_row_unresolved";
    err.status = 409;
    err.mutation_classification = "blocked_policy_unconfirmed";
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  return {
    ok: true,
    classification,
    mutationType,
    targetRowNumber: resolvedTargetRowNumber,
    duplicateCandidates: duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    })),
    consultedPolicyKeys: policies.map(p => p.policy_key),
    consultedExistingRows: duplicateCandidates.slice(0, 5).map(item => item.rowNumber),
    highRiskSheet: isHighRiskSheet
  };
}

function columnLetter(colIndex) {
  let letter = "";
  while (colIndex > 0) {
    let temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

async function updateSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  targetRowNumber,
  preflight = null
) {
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} update requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const range = `${String(sheetName || "").trim()}!A${targetRowNumber}:${columnLetter(header.length)}${targetRowNumber}`;
  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range,
    valueInputOption: "RAW",
    requestBody: {
      majorDimension: "ROWS",
      values: [fullRow]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

async function deleteSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  targetRowNumber,
  preflight = null
) {
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} delete requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title)"
  });

  const sheet = (meta.data.sheets || []).find(
    s => String(s?.properties?.title || "").trim() === String(sheetName || "").trim()
  );

  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    const err = new Error(`Sheet not found for delete: ${sheetName}`);
    err.code = "sheet_not_found";
    err.status = 404;
    throw err;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: String(spreadsheetId || "").trim(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: Number(sheet.properties.sheetId),
              dimension: "ROWS",
              startIndex: targetRowNumber - 1,
              endIndex: targetRowNumber
            }
          }
        }
      ]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

async function performGovernedSheetMutation(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    mutationType = "append",
    rowObject = {},
    safeColumns = [],
    header = [],
    targetRowNumber = null,
    scanRangeA1 = "A:Z"
  } = args;

  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);

  const preflight = await enforceGovernedMutationPreflight({
    spreadsheetId,
    sheetName,
    rowObject,
    mutationType,
    scanRangeA1,
    targetRowNumber
  });

  if (mutationType === "append") {
    if (sheetName === EXECUTION_LOG_UNIFIED_SHEET) {
      return await appendExecutionLogUnifiedRowGoverned(
        sheets,
        spreadsheetId,
        sheetName,
        header,
        rowObject,
        preflight
      );
    }

    return await appendSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight
    );
  }

  if (mutationType === "update" || mutationType === "repair") {
    return await updateSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight.targetRowNumber,
      preflight
    );
  }

  if (mutationType === "delete") {
    return await deleteSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      preflight.targetRowNumber,
      preflight
    );
  }

  const err = new Error(`Unsupported governed mutation type: ${mutationType}`);
  err.code = "unsupported_governed_mutation_type";
  err.status = 400;
  throw err;
}

async function appendSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  preflight = null
) {
  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [fullRow]
    }
  });

  return {
    preflight
  };
}

async function appendExecutionLogUnifiedRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  rowObject,
  preflight = null
) {
  const requiredRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !header.includes(col)
  );

  if (requiredRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${requiredRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(
    header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    rowObject
  );

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: false,
    requestBody: {
      values: [fullRow]
    }
  });

  const updatedRange = String(
    appendResponse?.data?.updates?.updatedRange || ""
  ).trim();

  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
  const appendedRowNumber = rowMatch ? Number(rowMatch[1]) : NaN;

  if (!Number.isFinite(appendedRowNumber) || appendedRowNumber < 2) {
    const err = new Error(
      `${sheetName} append succeeded but appended row number could not be determined.`
    );
    err.code = "sheet_append_row_unknown";
    err.status = 500;
    throw err;
  }

  const rawWritebackValues = buildColumnSliceRow(
    EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
    rowObject
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(
      sheetName,
      `${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN}${appendedRowNumber}:${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN}${appendedRowNumber}`
    ),
    valueInputOption: "RAW",
    requestBody: {
      values: [rawWritebackValues]
    }
  });

  return { appendedRowNumber, preflight };
}

async function verifyAppendReadback(
  spreadsheetId,
  sheetName,
  expectedStartTime,
  expectedSummary,
  expectedStatus,
  expectedEntryType,
  expectedArtifactJsonAssetId = "",
  expectedRawWriteback = {}
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AQ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);

  const startIdx = map["Start Time"];
  const summaryIdx = map["Output Summary"];
  const statusIdx = map["Execution Status"];
  const entryTypeIdx = map["Entry Type"];
  const artifactJsonAssetIdIdx = map["artifact_json_asset_id"];
  const targetModuleWritebackIdx = map["target_module_writeback"];
  const targetWorkflowWritebackIdx = map["target_workflow_writeback"];
  const executionTraceIdWritebackIdx = map["execution_trace_id_writeback"];
  const logSourceWritebackIdx = map["log_source_writeback"];
  const monitoredRowWritebackIdx = map["monitored_row_writeback"];
  const performanceImpactRowWritebackIdx = map["performance_impact_row_writeback"];

  if (
    startIdx === undefined ||
    summaryIdx === undefined ||
    statusIdx === undefined ||
    entryTypeIdx === undefined ||
    targetModuleWritebackIdx === undefined ||
    targetWorkflowWritebackIdx === undefined ||
    executionTraceIdWritebackIdx === undefined ||
    logSourceWritebackIdx === undefined ||
    monitoredRowWritebackIdx === undefined ||
    performanceImpactRowWritebackIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const start = String(row[startIdx] || "").trim();
    const summary = String(row[summaryIdx] || "").trim();
    const status = String(row[statusIdx] || "").trim();
    const entryType = String(row[entryTypeIdx] || "").trim();
    const artifactJsonAssetId =
      artifactJsonAssetIdIdx === undefined
        ? ""
        : String(row[artifactJsonAssetIdIdx] || "").trim();
    const targetModuleWriteback = String(row[targetModuleWritebackIdx] || "").trim();
    const targetWorkflowWriteback = String(row[targetWorkflowWritebackIdx] || "").trim();
    const executionTraceIdWriteback = String(row[executionTraceIdWritebackIdx] || "").trim();
    const logSourceWriteback = String(row[logSourceWritebackIdx] || "").trim();
    const monitoredRowWriteback = String(row[monitoredRowWritebackIdx] || "").trim();
    const performanceImpactRowWriteback = String(row[performanceImpactRowWritebackIdx] || "").trim();

    return (
      start === String(expectedStartTime || "").trim() &&
      summary === String(expectedSummary || "").trim() &&
      status === String(expectedStatus || "").trim() &&
      entryType === String(expectedEntryType || "").trim() &&
      artifactJsonAssetId === String(expectedArtifactJsonAssetId || "").trim() &&
      targetModuleWriteback === String(expectedRawWriteback.target_module_writeback || "").trim() &&
      targetWorkflowWriteback === String(expectedRawWriteback.target_workflow_writeback || "").trim() &&
      executionTraceIdWriteback === String(expectedRawWriteback.execution_trace_id_writeback || "").trim() &&
      logSourceWriteback === String(expectedRawWriteback.log_source_writeback || "").trim() &&
      monitoredRowWriteback === String(expectedRawWriteback.monitored_row_writeback || "").trim() &&
      performanceImpactRowWriteback === String(expectedRawWriteback.performance_impact_row_writeback || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

async function verifyJsonAssetAppendReadback(
  spreadsheetId,
  sheetName,
  expectedAssetId,
  expectedAssetType,
  expectedSourceAssetRef,
  expectedGoogleDriveLink,
  expectedJsonPayload = ""
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);
  const assetIdIdx = map.asset_id;
  const assetTypeIdx = map.asset_type;
  const sourceAssetRefIdx = map.source_asset_ref;
  const googleDriveLinkIdx = map.google_drive_link;
  const jsonPayloadIdx = map.json_payload;

  if (
    assetIdIdx === undefined ||
    assetTypeIdx === undefined ||
    sourceAssetRefIdx === undefined ||
    googleDriveLinkIdx === undefined ||
    jsonPayloadIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const assetId = String(row[assetIdIdx] || "").trim();
    const assetType = String(row[assetTypeIdx] || "").trim();
    const sourceAssetRef = String(row[sourceAssetRefIdx] || "").trim();
    const googleDriveLink = String(row[googleDriveLinkIdx] || "").trim();
    const jsonPayload = String(row[jsonPayloadIdx] || "").trim();
    return (
      assetId === String(expectedAssetId || "").trim() &&
      assetType === String(expectedAssetType || "").trim() &&
      sourceAssetRef === String(expectedSourceAssetRef || "").trim() &&
      googleDriveLink === String(expectedGoogleDriveLink || "").trim() &&
      jsonPayload === String(expectedJsonPayload || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

async function writeExecutionLogUnifiedRow(row) {
  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    EXECUTION_LOG_UNIFIED_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  if (live.columnCount < EXECUTION_LOG_UNIFIED_COLUMNS.length) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    EXECUTION_LOG_UNIFIED_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, EXECUTION_LOG_UNIFIED_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
    protectedColumns: PROTECTED_UNIFIED_LOG_COLUMNS
  });

  assertExecutionLogFormulaColumnsProtected(
    plan,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:AQ"
  });

  await verifyAppendReadback(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    row["Start Time"],
    row["Output Summary"],
    row["Execution Status"],
    row["Entry Type"],
    row.artifact_json_asset_id,
    {
      target_module_writeback: row.target_module_writeback,
      target_workflow_writeback: row.target_workflow_writeback,
      execution_trace_id_writeback: row.execution_trace_id_writeback,
      log_source_writeback: row.log_source_writeback,
      monitored_row_writeback: row.monitored_row_writeback,
      performance_impact_row_writeback: row.performance_impact_row_writeback
    }
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    formulaManagedColumnsProtected: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

async function writeJsonAssetRegistryRow(row) {
  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    JSON_ASSET_REGISTRY_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    JSON_ASSET_REGISTRY_COLUMNS,
    JSON_ASSET_REGISTRY_SHEET
  );

  if (live.columnCount < JSON_ASSET_REGISTRY_COLUMNS.length) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    JSON_ASSET_REGISTRY_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, JSON_ASSET_REGISTRY_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: JSON_ASSET_REGISTRY_COLUMNS,
    protectedColumns: new Set()
  });

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:Q"
  });

  await verifyJsonAssetAppendReadback(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    row.asset_id,
    row.asset_type,
    row.source_asset_ref,
    row.google_drive_link,
    row.json_payload
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

async function loadBrandRegistry(sheets) {
  const values = await fetchRange(sheets, `'${BRAND_REGISTRY_SHEET}'!A1:CX1000`);
  if (!values.length) throw registryError("Brand Registry");
  const headers = values[0];
  const map = headerMap(headers, BRAND_REGISTRY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      brand_name: getCell(row, map, "Brand Name"),
      normalized_brand_name: getCell(row, map, "Normalized Brand Name"),
      brand_domain: getCell(row, map, "brand_domain"),
      target_key: getCell(row, map, "target_key"),
      site_aliases_json: getCell(row, map, "site_aliases_json"),
      base_url: getCell(row, map, "base_url"),
      transport_action_key: getCell(row, map, "transport_action_key"),
      auth_type: getCell(row, map, "auth_type"),
      credential_resolution: getCell(row, map, "credential_resolution"),
      username: getCell(row, map, "username"),
      application_password: getCell(row, map, "application_password"),
      default_headers_json: getCell(row, map, "default_headers_json"),
      write_allowed: getCell(row, map, "write_allowed"),
      destructive_allowed: getCell(row, map, "destructive_allowed"),
      transport_enabled: getCell(row, map, "transport_enabled"),
      target_resolution_mode: getCell(row, map, "target_resolution_mode"),

      // hosting linkage
      hosting_provider: getCell(row, map, "hosting_provider"),
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hostinger_api_target_key: getCell(row, map, "hostinger_api_target_key"),
      server_environment_label: getCell(row, map, "server_environment_label"),
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_region_or_datacenter: getCell(row, map, "server_region_or_datacenter"),
      server_primary_domain: getCell(row, map, "server_primary_domain"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      hosting_account_registry_ref: getCell(row, map, "hosting_account_registry_ref")
    }))
    .filter(r => r.brand_name || r.target_key || r.base_url);
}

async function loadHostingAccountRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${HOSTING_ACCOUNT_REGISTRY_SHEET}'!A1:AZ1000`
  );
  if (!values.length) throw registryError("Hosting Account Registry");

  const headers = values[0];
  const map = headerMap(headers, HOSTING_ACCOUNT_REGISTRY_SHEET);
  const requiredHostingColumns = HOSTING_ACCOUNT_REGISTRY_COLUMNS;

  for (const col of requiredHostingColumns) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `Hosting Account Registry missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values
    .slice(1)
    .map(row => ({
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hosting_provider: getCell(row, map, "hosting_provider"),
      account_identifier: getCell(row, map, "account_identifier"),
      api_auth_mode: getCell(row, map, "api_auth_mode"),
      api_key_reference: getCell(row, map, "api_key_reference"),
      api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
      plan_label: getCell(row, map, "plan_label"),
      plan_type: getCell(row, map, "plan_type"),
      account_scope_notes: getCell(row, map, "account_scope_notes"),
      status: getCell(row, map, "status"),
      last_reviewed_at: getCell(row, map, "last_reviewed_at"),

      brand_sites_json: getCell(row, map, "brand_sites_json"),
      resolver_target_keys_json: getCell(row, map, "resolver_target_keys_json"),
      auth_validation_status: getCell(row, map, "auth_validation_status"),
      endpoint_binding_status: getCell(row, map, "endpoint_binding_status"),
      resolver_execution_ready: getCell(row, map, "resolver_execution_ready"),
      last_runtime_check_at: getCell(row, map, "last_runtime_check_at"),

      // Hostinger SSH runtime details are governed as columns in Hosting Account Registry.
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      ssh_available: getCell(row, map, "ssh_available"),
      ssh_enabled: getCell(row, map, "ssh_enabled"),
      ssh_source: getCell(row, map, "ssh_source"),
      ssh_host: getCell(row, map, "ssh_host"),
      ssh_port: getCell(row, map, "ssh_port"),
      ssh_username: getCell(row, map, "ssh_username"),
      ssh_auth_mode: getCell(row, map, "ssh_auth_mode"),
      ssh_credential_reference: getCell(row, map, "ssh_credential_reference"),
      ssh_runtime_notes: getCell(row, map, "ssh_runtime_notes"),
      account_mode: getCell(row, map, "account_mode"),
      shared_access_enabled: getCell(row, map, "shared_access_enabled"),
      sftp_available: getCell(row, map, "sftp_available"),
      wp_cli_available: getCell(row, map, "wp_cli_available"),
      last_validated_at: getCell(row, map, "last_validated_at")
    }))
    .filter(r => r.hosting_account_key);
}

async function loadActionsRegistry(sheets) {
  const values = await fetchRange(sheets, `'${ACTIONS_REGISTRY_SHEET}'!A1:AM1000`);
  if (!values.length) throw registryError("Actions Registry");
  const headers = values[0];
  const map = headerMap(headers, ACTIONS_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    action_key: getCell(row, map, "action_key"),
    status: getCell(row, map, "status"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    api_key_mode: getCell(row, map, "api_key_mode"),
    api_key_param_name: getCell(row, map, "api_key_param_name"),
    api_key_header_name: getCell(row, map, "api_key_header_name"),
    api_key_value: getCell(row, map, "api_key_value"),
    api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
    openai_schema_file_id: getCell(row, map, "openai_schema_file_id"),
    oauth_config_file_id: getCell(row, map, "oauth_config_file_id"),
    oauth_config_file_name: getCell(row, map, "oauth_config_file_name"),
    runtime_capability_class: getCell(row, map, "runtime_capability_class"),
    runtime_callable: getCell(row, map, "runtime_callable"),
    primary_executor: getCell(row, map, "primary_executor"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.action_key);
}

async function loadEndpointRegistry(sheets) {
  const values = await fetchRange(sheets, `'${ENDPOINT_REGISTRY_SHEET}'!A1:BA2000`);
  if (!values.length) throw registryError("API Actions Endpoint Registry");
  const headers = values[0];
  const map = headerMap(headers, ENDPOINT_REGISTRY_SHEET);
  debugLog("ENDPOINT_REGISTRY_HEADERS:", JSON.stringify(headers));
  debugLog("ENDPOINT_REGISTRY_HEADER_MAP_KEYS:", JSON.stringify(Object.keys(map)));
  return values.slice(1).map(row => ({
    endpoint_id: getCell(row, map, "endpoint_id"),
    parent_action_key: getCell(row, map, "parent_action_key"),
    endpoint_key: getCell(row, map, "endpoint_key"),
    provider_domain: getCell(row, map, "provider_domain"),
    method: getCell(row, map, "method"),
    endpoint_path_or_function: getCell(row, map, "endpoint_path_or_function"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    status: getCell(row, map, "status"),
    spec_validation_status: getCell(row, map, "spec_validation_status"),
    auth_validation_status: getCell(row, map, "auth_validation_status"),
    privacy_validation_status: getCell(row, map, "privacy_validation_status"),
    execution_readiness: getCell(row, map, "execution_readiness"),
    endpoint_role: getCell(row, map, "endpoint_role"),
    execution_mode: getCell(row, map, "execution_mode"),
    transport_required: getCell(row, map, "transport_required"),
    fallback_allowed: getCell(row, map, "fallback_allowed"),
    fallback_match_basis: getCell(row, map, "fallback_match_basis"),
    fallback_provider_domain: getCell(row, map, "fallback_provider_domain"),
    fallback_connector_family: getCell(row, map, "fallback_connector_family"),
    fallback_action_name: getCell(row, map, "fallback_action_name"),
    fallback_route_target: getCell(row, map, "fallback_route_target"),
    fallback_notes: getCell(row, map, "fallback_notes"),
    inventory_role: getCell(row, map, "inventory_role"),
    inventory_source: getCell(row, map, "inventory_source"),
    notes: getCell(row, map, "notes"),
    brand_resolution_source: getCell(row, map, "brand_resolution_source"),
    transport_action_key: getCell(row, map, "transport_action_key")
  })).filter(r => r.endpoint_key);
}

async function loadExecutionPolicies(sheets) {
  const values = await fetchRange(sheets, `'${EXECUTION_POLICY_SHEET}'!A1:H2000`);
  if (!values.length) throw registryError("Execution Policy Registry");
  const headers = values[0];
  const map = headerMap(headers, EXECUTION_POLICY_SHEET);
  const policies = values.slice(1).map(row => ({
    policy_group: getCell(row, map, "policy_group"),
    policy_key: getCell(row, map, "policy_key"),
    policy_value: getCell(row, map, "policy_value"),
    active: getCell(row, map, "active"),
    execution_scope: getCell(row, map, "execution_scope"),
    affects_layer: getCell(row, map, "affects_layer"),
    blocking: getCell(row, map, "blocking"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.policy_key && boolFromSheet(r.active));
  return policies;
}

async function readExecutionPolicyRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A1:H2000")
  );
  if (!values.length) throw registryError("Execution Policy Registry");

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, EXECUTION_POLICY_SHEET)
  };
}

function buildExecutionPolicyRow(input = {}) {
  return {
    policy_group: String(input.policy_group || "").trim(),
    policy_key: String(input.policy_key || "").trim(),
    policy_value: String(input.policy_value || "").trim(),
    active:
      input.active === true || String(input.active || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    execution_scope: String(input.execution_scope || "execution").trim(),
    affects_layer: String(input.affects_layer || "").trim(),
    blocking:
      input.blocking === true || String(input.blocking || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes || "").trim()
  };
}

function findExecutionPolicyRowNumber(header = [], rows = [], input = {}) {
  const groupIdx = header.indexOf("policy_group");
  const keyIdx = header.indexOf("policy_key");

  if (groupIdx === -1 || keyIdx === -1) {
    const err = new Error("Execution Policy Registry header missing policy_group or policy_key.");
    err.code = "execution_policy_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedGroup = String(input.policy_group || "").trim();
  const wantedKey = String(input.policy_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingGroup = String(row[groupIdx] || "").trim();
    const existingKey = String(row[keyIdx] || "").trim();
    if (existingGroup === wantedGroup && existingKey === wantedKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "delete",
    rowObject: buildExecutionPolicyRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readTaskRoutesLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError(TASK_ROUTES_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, TASK_ROUTES_SHEET)
  };
}

function buildTaskRouteRow(input = {}) {
  const row = {};

  for (const col of TASK_ROUTES_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Task Key"] = String(input["Task Key"] ?? input.task_key ?? "").trim();
  row["Trigger Terms"] = String(input["Trigger Terms"] ?? input.trigger_terms ?? "").trim();
  row["Route Modules"] = String(input["Route Modules"] ?? input.route_modules ?? "").trim();
  row["Execution Layer"] = String(input["Execution Layer"] ?? input.execution_layer ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Enabled"] =
    input["Enabled"] === true || String(input["Enabled"] ?? input.enabled ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Output Focus"] = String(input["Output Focus"] ?? input.output_focus ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Sources"] = String(input["Entry Sources"] ?? input.entry_sources ?? "").trim();
  row["Linked Starter Titles"] = String(input["Linked Starter Titles"] ?? input.linked_starter_titles ?? "").trim();
  row["Active Starter Count"] = String(input["Active Starter Count"] ?? input.active_starter_count ?? "").trim();
  row["Route Key Match Status"] = String(input["Route Key Match Status"] ?? input.route_key_match_status ?? "").trim();

  row["row_id"] = String(input.row_id ?? "").trim();
  row["route_id"] = String(input.route_id ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["intent_key"] = String(input.intent_key ?? "").trim();
  row["brand_scope"] = String(input.brand_scope ?? "").trim();
  row["request_type"] = String(input.request_type ?? "").trim();
  row["route_mode"] = String(input.route_mode ?? "").trim();
  row["target_module"] = String(input.target_module ?? "").trim();
  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["priority"] = String(input.priority ?? "").trim();
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["match_rule"] = String(input.match_rule ?? "").trim();
  row["route_source"] = String(input.route_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

function findTaskRouteRowNumber(header = [], rows = [], input = {}) {
  const routeIdIdx = header.indexOf("route_id");
  const taskKeyIdx = header.indexOf("Task Key");

  if (routeIdIdx === -1 && taskKeyIdx === -1) {
    const err = new Error("Task Routes header missing route_id and Task Key.");
    err.code = "task_routes_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedRouteId = String(input.route_id || "").trim();
  const wantedTaskKey = String(input["Task Key"] ?? input.task_key ?? "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingRouteId = routeIdIdx === -1 ? "" : String(row[routeIdIdx] || "").trim();
    const existingTaskKey = taskKeyIdx === -1 ? "" : String(row[taskKeyIdx] || "").trim();

    if (wantedRouteId && existingRouteId === wantedRouteId) {
      return i + 2;
    }

    if (!wantedRouteId && wantedTaskKey && existingTaskKey === wantedTaskKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "delete",
    rowObject: buildTaskRouteRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readWorkflowRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError(WORKFLOW_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, WORKFLOW_REGISTRY_SHEET)
  };
}

function buildWorkflowRegistryRow(input = {}) {
  const row = {};

  for (const col of WORKFLOW_REGISTRY_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Workflow ID"] = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  row["Workflow Name"] = String(input["Workflow Name"] ?? input.workflow_name ?? "").trim();
  row["Module Mode"] = String(input["Module Mode"] ?? input.module_mode ?? "").trim();
  row["Trigger Source"] = String(input["Trigger Source"] ?? input.trigger_source ?? "").trim();
  row["Input Type"] = String(input["Input Type"] ?? input.input_type ?? "").trim();
  row["Primary Objective"] = String(input["Primary Objective"] ?? input.primary_objective ?? "").trim();
  row["Mapped Engine(s)"] = String(input["Mapped Engine(s)"] ?? input.mapped_engines ?? "").trim();
  row["Engine Order"] = String(input["Engine Order"] ?? input.engine_order ?? "").trim();
  row["Workflow Type"] = String(input["Workflow Type"] ?? input.workflow_type ?? "").trim();
  row["Primary Output"] = String(input["Primary Output"] ?? input.primary_output ?? "").trim();
  row["Input Detection Rules"] = String(input["Input Detection Rules"] ?? input.input_detection_rules ?? "").trim();
  row["Output Template"] = String(input["Output Template"] ?? input.output_template ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Route Key"] = String(input["Route Key"] ?? input.route_key ?? "").trim();
  row["Execution Mode"] = String(input["Execution Mode"] ?? input.execution_mode ?? "").trim();
  row["User Facing"] =
    input["User Facing"] === true || String(input["User Facing"] ?? input.user_facing ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Parent Layer"] = String(input["Parent Layer"] ?? input.parent_layer ?? "").trim();
  row["Status"] = String(input["Status"] ?? input.status_label ?? "").trim();
  row["Linked Workflows"] = String(input["Linked Workflows"] ?? input.linked_workflows ?? "").trim();
  row["Linked Engines"] = String(input["Linked Engines"] ?? input.linked_engines ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Priority Weight"] = String(input["Entry Priority Weight"] ?? input.entry_priority_weight ?? "").trim();
  row["Dependency Type"] = String(input["Dependency Type"] ?? input.dependency_type ?? "").trim();
  row["Output Artifact Type"] = String(input["Output Artifact Type"] ?? input.output_artifact_type ?? "").trim();

  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["target_module"] = String(input.target_module ?? "").trim();
  row["execution_class"] = String(input.execution_class ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["route_compatibility"] = String(input.route_compatibility ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["registry_source"] = String(input.registry_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

function findWorkflowRegistryRowNumber(header = [], rows = [], input = {}) {
  const workflowIdIdx = header.indexOf("Workflow ID");
  const workflowKeyIdx = header.indexOf("workflow_key");

  if (workflowIdIdx === -1 && workflowKeyIdx === -1) {
    const err = new Error("Workflow Registry header missing Workflow ID and workflow_key.");
    err.code = "workflow_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedWorkflowId = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  const wantedWorkflowKey = String(input.workflow_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingWorkflowId =
      workflowIdIdx === -1 ? "" : String(row[workflowIdIdx] || "").trim();
    const existingWorkflowKey =
      workflowKeyIdx === -1 ? "" : String(row[workflowKeyIdx] || "").trim();

    if (wantedWorkflowId && existingWorkflowId === wantedWorkflowId) {
      return i + 2;
    }

    if (!wantedWorkflowId && wantedWorkflowKey && existingWorkflowKey === wantedWorkflowKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildWorkflowRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readRegistrySurfacesCatalogLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A1:AG2000")
  );
  if (!values.length) throw registryError(REGISTRY_SURFACES_CATALOG_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET)
  };
}

function buildRegistrySurfaceCatalogRow(input = {}) {
  return {
    surface_id: String(input.surface_id ?? "").trim(),
    surface_name: String(input.surface_name ?? "").trim(),
    worksheet_name: String(input.worksheet_name ?? "").trim(),
    worksheet_gid: String(input.worksheet_gid ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    authority_status: String(input.authority_status ?? "").trim(),
    required_for_execution:
      input.required_for_execution === true ||
      String(input.required_for_execution ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    schema_ref: String(input.schema_ref ?? "").trim(),
    schema_version: String(input.schema_version ?? "").trim(),
    header_signature: String(input.header_signature ?? "").trim(),
    expected_column_count: String(input.expected_column_count ?? "").trim(),
    binding_mode: String(input.binding_mode ?? "").trim(),
    sheet_role: String(input.sheet_role ?? "").trim(),
    audit_mode: String(input.audit_mode ?? "").trim(),
    legacy_surface_containment_required:
      input.legacy_surface_containment_required === true ||
      String(input.legacy_surface_containment_required ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_candidate_types: String(input.repair_candidate_types ?? "").trim(),
    repair_priority: String(input.repair_priority ?? "").trim()
  };
}

function findRegistrySurfaceCatalogRowNumber(header = [], rows = [], input = {}) {
  const surfaceIdIdx = header.indexOf("surface_id");
  const surfaceNameIdx = header.indexOf("surface_name");

  if (surfaceIdIdx === -1 && surfaceNameIdx === -1) {
    const err = new Error(
      "Registry Surfaces Catalog header missing surface_id and surface_name."
    );
    err.code = "registry_surfaces_catalog_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedSurfaceId = String(input.surface_id || "").trim();
  const wantedSurfaceName = String(input.surface_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingSurfaceId =
      surfaceIdIdx === -1 ? "" : String(row[surfaceIdIdx] || "").trim();
    const existingSurfaceName =
      surfaceNameIdx === -1 ? "" : String(row[surfaceNameIdx] || "").trim();

    if (wantedSurfaceId && existingSurfaceId === wantedSurfaceId) {
      return i + 2;
    }

    if (!wantedSurfaceId && wantedSurfaceName && existingSurfaceName === wantedSurfaceName) {
      return i + 2;
    }
  }

  return null;
}

async function writeRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "delete",
    rowObject: buildRegistrySurfaceCatalogRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readValidationRepairRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(VALIDATION_REPAIR_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(VALIDATION_REPAIR_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, VALIDATION_REPAIR_REGISTRY_SHEET)
  };
}

function buildValidationRepairRegistryRow(input = {}) {
  return {
    validation_key: String(input.validation_key ?? "").trim(),
    validation_name: String(input.validation_name ?? "").trim(),
    surface_id: String(input.surface_id ?? "").trim(),
    target_sheet: String(input.target_sheet ?? "").trim(),
    target_range: String(input.target_range ?? "").trim(),
    validation_type: String(input.validation_type ?? "").trim(),
    validation_scope: String(input.validation_scope ?? "").trim(),
    severity: String(input.severity ?? "").trim(),
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_strategy: String(input.repair_strategy ?? "").trim(),
    repair_module: String(input.repair_module ?? "").trim(),
    expected_schema_ref: String(input.expected_schema_ref ?? "").trim(),
    expected_schema_version: String(input.expected_schema_version ?? "").trim(),
    expected_header_signature: String(input.expected_header_signature ?? "").trim(),
    drift_detection_mode: String(input.drift_detection_mode ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim(),
    notes: String(input.notes ?? "").trim()
  };
}

function findValidationRepairRegistryRowNumber(header = [], rows = [], input = {}) {
  const validationKeyIdx = header.indexOf("validation_key");
  const validationNameIdx = header.indexOf("validation_name");

  if (validationKeyIdx === -1 && validationNameIdx === -1) {
    const err = new Error(
      "Validation & Repair Registry header missing validation_key and validation_name."
    );
    err.code = "validation_repair_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedValidationKey = String(input.validation_key || "").trim();
  const wantedValidationName = String(input.validation_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingValidationKey =
      validationKeyIdx === -1 ? "" : String(row[validationKeyIdx] || "").trim();
    const existingValidationName =
      validationNameIdx === -1 ? "" : String(row[validationNameIdx] || "").trim();

    if (wantedValidationKey && existingValidationKey === wantedValidationKey) {
      return i + 2;
    }

    if (
      !wantedValidationKey &&
      wantedValidationName &&
      existingValidationName === wantedValidationName
    ) {
      return i + 2;
    }
  }

  return null;
}

async function writeValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildValidationRepairRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readActionsRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(ACTIONS_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(ACTIONS_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, ACTIONS_REGISTRY_SHEET)
  };
}

function buildActionsRegistryRow(input = {}) {
  return {
    action_key: String(input.action_key ?? "").trim(),
    parent_action_key: String(input.parent_action_key ?? "").trim(),
    action_name: String(input.action_name ?? "").trim(),
    action_label: String(input.action_label ?? "").trim(),
    action_type: String(input.action_type ?? "").trim(),
    target_module: String(input.target_module ?? "").trim(),
    workflow_key: String(input.workflow_key ?? "").trim(),
    execution_mode: String(input.execution_mode ?? "").trim(),
    request_method: String(input.request_method ?? "").trim(),
    path_template: String(input.path_template ?? "").trim(),
    provider_domain_mode: String(input.provider_domain_mode ?? "").trim(),
    auth_mode: String(input.auth_mode ?? "").trim(),
    schema_mode: String(input.schema_mode ?? "").trim(),
    request_schema_ref: String(input.request_schema_ref ?? "").trim(),
    response_schema_ref: String(input.response_schema_ref ?? "").trim(),
    route_scope: String(input.route_scope ?? "").trim(),
    retry_profile: String(input.retry_profile ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes ?? "").trim(),
    owner_module: String(input.owner_module ?? "").trim(),
    authority_source: String(input.authority_source ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim()
  };
}

function findActionsRegistryRowNumber(header = [], rows = [], input = {}) {
  const actionKeyIdx = header.indexOf("action_key");
  const actionNameIdx = header.indexOf("action_name");

  if (actionKeyIdx === -1 && actionNameIdx === -1) {
    const err = new Error(
      "Actions Registry header missing action_key and action_name."
    );
    err.code = "actions_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedActionKey = String(input.action_key || "").trim();
  const wantedActionName = String(input.action_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingActionKey =
      actionKeyIdx === -1 ? "" : String(row[actionKeyIdx] || "").trim();
    const existingActionName =
      actionNameIdx === -1 ? "" : String(row[actionNameIdx] || "").trim();

    if (wantedActionKey && existingActionKey === wantedActionKey) {
      return i + 2;
    }

    if (!wantedActionKey && wantedActionName && existingActionName === wantedActionName) {
      return i + 2;
    }
  }

  return null;
}

async function writeActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildActionsRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function fetchFromGoogleSheets() {
  const { sheets, drive } = await getGoogleClients();
  const [
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  ] = await Promise.all([
    loadBrandRegistry(sheets),
    loadHostingAccountRegistry(sheets),
    loadActionsRegistry(sheets),
    loadEndpointRegistry(sheets),
    loadExecutionPolicies(sheets),
    loadSiteRuntimeInventoryRegistry(sheets).catch(() => []),
    loadSiteSettingsInventoryRegistry(sheets).catch(() => []),
    loadPluginInventoryRegistry(sheets).catch(() => []),
    loadTaskRoutesRegistry(sheets).catch(() => []),
    loadWorkflowRegistry(sheets).catch(() => [])
  ]);

  return {
    drive,
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  };
}

async function getRegistry() {
  return await fetchFromGoogleSheets();
}

async function reloadRegistry() {
  return await fetchFromGoogleSheets();
}

function registryError(name) {
  const err = new Error(`${name} sheet is empty or unreadable.`);
  err.code = "registry_unavailable";
  err.status = 500;
  return err;
}

function policyValue(policies, group, key, fallback = "") {
  const row = policies.find(p => p.policy_group === group && p.policy_key === key && boolFromSheet(p.active));
  return row ? row.policy_value : fallback;
}

function policyList(policies, group, key) {
  return String(policyValue(policies, group, key, ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

function getDefaultGoogleScopes(action = {}, endpoint = {}) {
  const actionKey = String(action.action_key || "").trim();
  const method = String(endpoint.method || "").trim().toUpperCase();
  const readonly = method === "GET";

  switch (actionKey) {
    case "googleads_api":
      return ["https://www.googleapis.com/auth/adwords"];

    case "searchads360_api":
      return ["https://www.googleapis.com/auth/doubleclicksearch"];

    case "searchconsole_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/webmasters.readonly"
          : "https://www.googleapis.com/auth/webmasters"
      ];

    case "analytics_data_api":
      return ["https://www.googleapis.com/auth/analytics.readonly"];

    case "analytics_admin_api":
      return ["https://www.googleapis.com/auth/analytics.edit"];

    case "tagmanager_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/tagmanager.readonly"
          : "https://www.googleapis.com/auth/tagmanager.edit.containers"
      ];

    default:
      return ["https://www.googleapis.com/auth/cloud-platform"];
  }
}

function normalizeGoogleScopeList(scopes = []) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map(v => String(v || "").trim()).filter(Boolean))]
    : [];
}

function getScopesFromOAuthConfig(oauthConfigContract, action) {
  const parsed = oauthConfigContract?.parsed || {};
  const byFamily = parsed?.scopes_by_action_family || {};
  const actionKey = String(action.action_key || "").trim();
  return normalizeGoogleScopeList(byFamily[actionKey] || []);
}

function validateGoogleOAuthConfigTraceability(action, oauthConfigContract) {
  const expectedName = String(action.oauth_config_file_name || "").trim();
  const actualName = String(oauthConfigContract?.name || "").trim();
  if (!expectedName || !actualName) return;
  if (expectedName !== actualName) {
    debugLog("OAUTH_CONFIG_NAME_MISMATCH:", {
      action_key: action.action_key,
      expected: expectedName,
      actual: actualName
    });
  }
}

async function resolveDelegatedGoogleScopes({ drive, policies, action, endpoint }) {
  const endpointScopedKey = `${action.action_key}|${endpoint.endpoint_key}|scopes`;
  const actionScopedKey = `${action.action_key}|scopes`;

  // 1) OAuth config file first
  const oauthConfigContract = await fetchOAuthConfigContract(drive, action);
  validateGoogleOAuthConfigTraceability(action, oauthConfigContract);
  const fileScopes = getScopesFromOAuthConfig(oauthConfigContract, action);
  if (fileScopes.length) {
    return {
      explicitScopes: fileScopes,
      scopeSource: `oauth_config_file:${oauthConfigContract.name || action.oauth_config_file_name || action.oauth_config_file_id}`
    };
  }

  // 2) endpoint-level policy override
  const endpointPolicyScopes = policyList(policies, "HTTP Google Auth", endpointScopedKey);
  if (endpointPolicyScopes.length) {
    return {
      explicitScopes: endpointPolicyScopes,
      scopeSource: `execution_policy:endpoint:${endpointScopedKey}`
    };
  }

  // 3) action-level policy override
  const actionPolicyScopes = policyList(policies, "HTTP Google Auth", actionScopedKey);
  if (actionPolicyScopes.length) {
    return {
      explicitScopes: actionPolicyScopes,
      scopeSource: `execution_policy:action:${actionScopedKey}`
    };
  }

  // 4) current hardcoded fallback
  return {
    explicitScopes: getDefaultGoogleScopes(action, endpoint),
    scopeSource: `server_default:${action.action_key}`
  };
}

async function mintGoogleAccessTokenForEndpoint({ drive, policies, action, endpoint }) {
  const { explicitScopes, scopeSource } = await resolveDelegatedGoogleScopes({
    drive,
    policies,
    action,
    endpoint
  });
  debugLog("GOOGLE_SCOPE_SOURCE:", scopeSource);
  debugLog("GOOGLE_SCOPES:", JSON.stringify(explicitScopes));

  const auth = new google.auth.GoogleAuth({ scopes: explicitScopes });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    const err = new Error("Unable to mint Google access token for delegated execution.");
    err.code = "auth_resolution_failed";
    err.status = 500;
    throw err;
  }
  return token;
}

function requirePolicyTrue(policies, group, key, message) {
  const value = policyValue(policies, group, key, "FALSE");
  if (String(value).trim().toUpperCase() !== "TRUE") {
    const err = new Error(message || `${group} | ${key} policy is not enabled.`);
    err.code = "policy_blocked";
    err.status = 403;
    throw err;
  }
}

function requirePolicySet(policies, group, keys = []) {
  const missing = (keys || []).filter(key => {
    const value = policyValue(policies, group, key, "FALSE");
    return String(value).trim().toUpperCase() !== "TRUE";
  });

  return {
    ok: missing.length === 0,
    missing
  };
}

function getRequiredHttpExecutionPolicyKeys(policies = []) {
  const auditEnabled =
    String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Required Policy Presence Audit Enabled",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const configuredKeys = policyList(
    policies,
    "HTTP Execution Governance",
    "Required Policy Presence Audit Keys"
  );

  const fallbackKeys = [
    "Require Endpoint Active",
    "Require Execution Readiness",
    "Enforce Parent Action Match",
    "Require Relative Path",
    "Require Auth Generation",
    "Server-Side Auth Injection Required",
    "Require Action Schema Resolution",
    "Require Request Schema Alignment"
  ];

  if (auditEnabled && configuredKeys.length) {
    return configuredKeys;
  }

  return fallbackKeys;
}

function buildMissingRequiredPolicyError(policies = [], missing = []) {
  const handling = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Missing Required Policy Handling",
      "BLOCK"
    )
  ).trim();

  const err = new Error(
    "Required HTTP Execution Governance policies are not fully enabled."
  );
  err.code = "missing_required_http_execution_policy";
  err.status = 403;
  err.details = {
    policy_group: "HTTP Execution Governance",
    missing_keys: missing,
    handling
  };
  return err;
}

function resilienceAppliesToParentAction(policies, parentActionKey) {
  const enabled = String(
    policyValue(
      policies,
      "HTTP Execution Resilience",
      "Retry Mutation Enabled",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!enabled) return false;

  const affected = policyList(
    policies,
    "HTTP Execution Resilience",
    "Affected Parent Action Keys"
  );

  return affected.includes(String(parentActionKey || "").trim());
}

function shouldRetryProviderResponse(policies, upstreamStatus, responseText) {
  const triggers = policyList(
    policies,
    "HTTP Execution Resilience",
    "Provider Retry Trigger"
  );

  const text = String(responseText || "");
  for (const trigger of triggers) {
    if (trigger === "upstream_status>=500" && Number(upstreamStatus) >= 500) {
      return true;
    }
    if (trigger.startsWith("response_contains:")) {
      const needle = trigger.slice("response_contains:".length);
      if (needle && text.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

function buildProviderRetryMutations(policies, actionKey = "") {
  if (!retryMutationEnabled(policies)) return [];
  if (!retryMutationAppliesToQuery(policies)) return [];
  if (!retryMutationSchemaModeAllowlisted(policies)) return [];
  if (!resilienceAppliesToParentAction(policies, actionKey)) return [];

  const strategy = String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Strategy", "")
  ).trim();

  if (strategy !== "premium_escalation") return [];

  const stages = [
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 0", "{}")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 1", "")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 2", "")).trim()
  ].filter(Boolean);

  return stages
    .map(parseRetryStageValue)
    .filter((mutation, index) => {
      if (index === 0) return false;
      return Object.keys(mutation || {}).length > 0;
    });
}

async function executeUpstreamAttempt({
  requestUrl,
  requestInit
}) {
  const upstream = await fetch(requestUrl, requestInit);

  const contentType = upstream.headers.get("content-type") || "";
  let data;
  let responseText = "";

  if (contentType.includes("application/json")) {
    data = await upstream.json();
    responseText = JSON.stringify(data);
  } else {
    data = await upstream.text();
    responseText = String(data || "");
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    upstream,
    data,
    responseText,
    responseHeaders,
    contentType
  };
}

// Brand resolution must use the normalized execution payload,
// not raw req.body, so all routing/governance uses one canonical request shape.
function resolveBrand(rows, requestPayload = {}) {
  const requestedProviderDomain = requestPayload.provider_domain
    ? safeNormalizeProviderDomain(requestPayload.provider_domain)
    : "";

  const targetKey = String(requestPayload.target_key || "").trim().toLowerCase();
  const brandName = String(requestPayload.brand || "").trim().toLowerCase();
  const brandDomain = String(requestPayload.brand_domain || "").trim().toLowerCase();

  const normalizedRows = rows.map(r => {
    const aliases = jsonParseSafe(r.site_aliases_json, []).map(v => String(v).toLowerCase());
    let rowBaseUrl = "";
    try {
      rowBaseUrl = r.base_url ? normalizeProviderDomain(r.base_url) : "";
    } catch {}
    return {
      ...r,
      _aliases: aliases,
      _normalized_brand_name: String(r.normalized_brand_name || "").toLowerCase(),
      _display_name: String(r.brand_name || "").toLowerCase(),
      _target_key: String(r.target_key || "").toLowerCase(),
      _brand_domain: String(r.brand_domain || "").toLowerCase(),
      _base_url: rowBaseUrl
    };
  });

  let row = null;

  if (targetKey) {
    row = normalizedRows.find(r => r._target_key === targetKey) || null;
  }

  if (!row && brandName) {
    row = normalizedRows.find(
      r =>
        r._normalized_brand_name === brandName ||
        r._display_name === brandName ||
        r._aliases.includes(brandName)
    ) || null;
  }

  if (!row && brandDomain) {
    row = normalizedRows.find(r => r._brand_domain === brandDomain) || null;
  }

  if (!row && requestedProviderDomain && requestedProviderDomain !== "target_resolved") {
    row = normalizedRows.find(r => r._base_url === requestedProviderDomain) || null;
  }

  if (!row) return null;

  if (!boolFromSheet(row.transport_enabled)) {
    const err = new Error(`Transport is not enabled for resolved brand ${row.brand_name}.`);
    err.code = "transport_disabled";
    err.status = 403;
    throw err;
  }

  if (row.transport_action_key && row.transport_action_key !== "http_generic_api") {
    const err = new Error(`Unsupported transport_action_key: ${row.transport_action_key}`);
    err.code = "unsupported_transport";
    err.status = 403;
    throw err;
  }

  return row;
}

function resolveAction(rows, parentActionKey) {
  const matches = rows.filter(r => r.action_key === parentActionKey);

  debugLog(
    "ACTION_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Parent action not found: ${parentActionKey}`);
    err.code = "parent_action_not_found";
    err.status = 403;
    throw err;
  }

  const active = matches.find(
    r => String(r.status || "").trim().toLowerCase() === "active"
  );

  const action = active || matches[0];

  debugLog(
    "ACTION_RESOLUTION_SELECTED:",
    JSON.stringify({
      action_key: action.action_key,
      status: action.status || "",
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: action.runtime_callable || "",
      primary_executor: action.primary_executor || "",
      openai_schema_storage_surface: action.openai_schema_storage_surface || ""
    })
  );

  if (String(action.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Parent action is not active: ${parentActionKey}`);
    err.code = "parent_action_inactive";
    err.status = 403;
    throw err;
  }
  return action;
}

function resolveEndpoint(rows, parentActionKey, endpointKey) {
  const matches = rows.filter(
    r =>
      r.parent_action_key === parentActionKey &&
      r.endpoint_key === endpointKey
  );

  debugLog(
    "ENDPOINT_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Endpoint not found: ${endpointKey}`);
    err.code = "endpoint_not_found";
    err.status = 403;
    throw err;
  }

  const activeReady = matches.find(
    r =>
      String(r.status || "").trim().toLowerCase() === "active" &&
      String(r.execution_readiness || "").trim().toLowerCase() === "ready"
  );

  const endpoint = activeReady || matches[0];

  debugLog(
    "ENDPOINT_RESOLUTION_SELECTED:",
    JSON.stringify(getEndpointExecutionSnapshot(endpoint))
  );

  if (String(endpoint.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Endpoint is not active: ${endpointKey}`);
    err.code = "endpoint_inactive";
    err.status = 403;
    throw err;
  }

  if (
    String(endpoint.execution_readiness || "").trim().toLowerCase() !== "ready"
  ) {
    const err = new Error(`Endpoint is not execution-ready: ${endpointKey}`);
    err.code = "endpoint_not_ready";
    err.status = 403;
    throw err;
  }

  return endpoint;
}

function isDelegatedTransportTarget(endpoint = {}) {
  return (
    String(endpoint.execution_mode || "")
      .trim()
      .toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

function getEndpointExecutionSnapshot(endpoint = {}) {
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_role: String(endpoint.endpoint_role || "").trim(),
    inventory_role: String(endpoint.inventory_role || "").trim(),
    inventory_source: String(endpoint.inventory_source || "").trim(),
    execution_mode: String(endpoint.execution_mode || "").trim(),
    transport_required_raw: endpoint.transport_required ?? "",
    transport_required: boolFromSheet(endpoint.transport_required),
    transport_action_key: String(endpoint.transport_action_key || "").trim(),
    delegated_transport_target: isDelegatedTransportTarget(endpoint),
    status: String(endpoint.status || "").trim(),
    execution_readiness: String(endpoint.execution_readiness || "").trim(),
    provider_domain: String(endpoint.provider_domain || "").trim(),
    endpoint_path_or_function: String(endpoint.endpoint_path_or_function || "").trim(),
    notes: String(endpoint.notes || "").trim()
  };
}

function requireRuntimeCallableAction(policies, action, endpoint) {
  const requireCallable = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Runtime Callable For Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const disallowPending = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Disallow Pending Binding Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowRegistryOnlyDirect = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Allow Registry Only Actions Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const capabilityClass = String(action.runtime_capability_class || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);

  if (disallowPending && capabilityClass === "pending_binding") {
    const err = new Error(`Action is pending binding and cannot execute: ${action.action_key}`);
    err.code = "action_pending_binding";
    err.status = 403;
    throw err;
  }

  if (
    requireCallable &&
    !delegatedTransportTarget &&
    primaryExecutor !== "http_client_backend" &&
    !runtimeCallable
  ) {
    const err = new Error(`Action is not runtime callable: ${action.action_key}`);
    err.code = "action_not_runtime_callable";
    err.status = 403;
    throw err;
  }

  if (
    !allowRegistryOnlyDirect &&
    !delegatedTransportTarget &&
    capabilityClass === "external_action_only" &&
    primaryExecutor !== "http_client_backend"
  ) {
    const err = new Error(`Registry-only external action cannot execute directly: ${action.action_key}`);
    err.code = "external_action_direct_execution_blocked";
    err.status = 403;
    throw err;
  }
}

function requireEndpointExecutionEligibility(policies, endpoint) {
  const blockInventoryOnly =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Block Inventory Only Endpoints",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const endpointRole = String(endpoint.endpoint_role || "")
    .trim()
    .toLowerCase();

  const executionMode = String(endpoint.execution_mode || "")
    .trim()
    .toLowerCase();

  const transportRequired = boolFromSheet(endpoint.transport_required);

  const inventoryRole = String(endpoint.inventory_role || "")
    .trim()
    .toLowerCase();

  const delegatedTransportTarget =
    isDelegatedTransportTarget(endpoint);

  const snapshot = {
    ...getEndpointExecutionSnapshot(endpoint),
    block_inventory_only: blockInventoryOnly
  };

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_INPUT:",
    JSON.stringify(snapshot)
  );

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    endpointRole &&
    endpointRole !== "primary"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "endpoint_role_blocked" })
    );

    const err = new Error(
      `Endpoint is not a primary executable endpoint: ${endpoint.endpoint_key}`
    );
    err.code = "endpoint_role_blocked";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    inventoryRole &&
    inventoryRole !== "endpoint_inventory"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "inventory_only_endpoint" })
    );

    const err = new Error(
      `Non-executable inventory role cannot execute directly: ${endpoint.endpoint_key}`
    );
    err.code = "inventory_only_endpoint";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_PASS:",
    JSON.stringify(snapshot)
  );

  return {
    endpointRole,
    executionMode,
    transportRequired,
    delegatedTransportTarget
  };
}

function requireExecutionModeCompatibility(action, endpoint) {
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();

  if (executionMode === "native_direct") {
    const err = new Error(
      `Native-direct endpoint must use native GPT execution path, not http-execute: ${endpoint.endpoint_key}`
    );
    err.code = "native_direct_requires_native_path";
    err.status = 403;
    throw err;
  }

  if (executionMode === "http_delegated" && primaryExecutor !== "http_client_backend") {
    const err = new Error(
      `Execution mode mismatch: endpoint ${endpoint.endpoint_key} is http_delegated but parent executor is ${primaryExecutor || "unset"}.`
    );
    err.code = "execution_mode_mismatch";
    err.status = 403;
    throw err;
  }
}

function requireNativeFamilyBoundary(policies, action, endpoint) {
  const nativeFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "Native Google Families Allowed"
  );

  const httpFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "HTTP Client Required Google Families"
  );

  const actionKey = String(action.action_key || "").trim();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
  const isTransportExecutor = actionKey === "http_generic_api";

  if (nativeFamilies.includes(actionKey) && !delegatedTransportTarget) {
    throw Object.assign(
      new Error(
        `Native family ${actionKey} must not execute through http-execute unless delegated.`
      ),
      { code: "native_family_http_execution_blocked", status: 403 }
    );
  }

  if (httpFamilies.includes(actionKey)) {
    if (!isTransportExecutor && !delegatedTransportTarget) {
      throw Object.assign(
        new Error(
          `HTTP-governed family ${actionKey} must use delegated transport.`
        ),
        { code: "http_family_requires_delegation", status: 403 }
      );
    }
  }
}

function requireTransportIfDelegated(policies, action, endpoint) {
  const requireTransport = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Transport For Delegated Actions",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const allowedTransport = String(policyValue(
    policies,
    "HTTP Execution Governance",
    "Allowed Transport",
    "http_generic_api"
  )).trim();

  if (requireTransport && executionMode === "http_delegated") {
    const transportActionKey = String(endpoint.transport_action_key || "").trim();
    if (transportRequired && transportActionKey !== allowedTransport) {
      const err = new Error(
        `Delegated endpoint requires supported transport_action_key ${allowedTransport}; received ${transportActionKey || "unset"}.`
      );
      err.code = "transport_required";
      err.status = 403;
      throw err;
    }

    const normalizedPrimaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
    const isTransportExecutor = String(action.action_key || "").trim() === "http_generic_api";

    if (!isTransportExecutor && normalizedPrimaryExecutor !== "http_client_backend") {
      const err = new Error(
        `Delegated endpoint requires http_client_backend as parent executor: ${action.action_key}`
      );
      err.code = "transport_executor_mismatch";
      err.status = 403;
      throw err;
    }
  }
}

function requireNoFallbackDirectExecution(policies, endpoint) {
  const fallbackRequiresPrimaryFailure = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Fallback Requires Primary Failure",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!fallbackRequiresPrimaryFailure) return;

  const fallbackAllowed = boolFromSheet(endpoint.fallback_allowed);
  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();

  if (fallbackAllowed && endpointRole === "fallback") {
    const err = new Error(`Fallback endpoint cannot execute directly without primary failure: ${endpoint.endpoint_key}`);
    err.code = "fallback_requires_primary_failure";
    err.status = 403;
    throw err;
  }
}

function getPlaceholderResolutionSources(policies = []) {
  return policyList(
    policies,
    "HTTP Execution Governance",
    "Placeholder Resolution Sources"
  ).map(v => String(v || "").trim().toLowerCase());
}

function resolveRuntimeProviderDomainSource({
  requestBody = {},
  brand = null,
  parentActionKey = ""
}) {
  debugLog("RUNTIME_REQUEST_BODY:", JSON.stringify(requestBody));

  const directProviderDomain = safeNormalizeProviderDomain(requestBody.provider_domain);
  if (directProviderDomain && directProviderDomain !== "target_resolved") {
    return {
      resolvedProviderDomain: directProviderDomain,
      placeholderResolutionSource: "provider_domain"
    };
  }

  // Provider-native actions like Hostinger should not inherit brand.base_url.
  if (String(parentActionKey || "").trim() === "hostinger_api") {
    return {
      resolvedProviderDomain: "",
      placeholderResolutionSource: ""
    };
  }

  if (brand?.base_url) {
    return {
      resolvedProviderDomain: normalizeProviderDomain(brand.base_url),
      placeholderResolutionSource:
        String(requestBody.target_key || "").trim() ? "target_key"
        : String(requestBody.brand || "").trim() ? "brand"
        : String(requestBody.brand_domain || "").trim() ? "brand_domain"
        : "brand"
    };
  }

  return {
    resolvedProviderDomain: "",
    placeholderResolutionSource: ""
  };
}

function resolveProviderDomain({
  requestedProviderDomain,
  endpoint,
  brand,
  parentActionKey,
  policies = [],
  requestBody = {}
}) {
  const endpointProviderDomain = String(endpoint.provider_domain || "").trim();

  if (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "native_controller" ||
    endpointProviderDomain === "same_service_native"
  ) {
    return {
      providerDomain: `http://127.0.0.1:${port}`,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  const {
    resolvedProviderDomain: runtimeResolvedProviderDomain,
    placeholderResolutionSource
  } = resolveRuntimeProviderDomainSource({
    requestBody,
    brand,
    parentActionKey
  });

  if (parentActionKey === "wordpress_api") {
    if (!brand || !brand.base_url) {
      const err = new Error("wordpress_api requires a brand-resolved base_url.");
      err.code = "provider_domain_not_allowed";
      err.status = 403;
      throw err;
    }

    return {
      providerDomain: normalizeProviderDomain(brand.base_url),
      resolvedProviderDomainMode: "brand_bound_domain",
      placeholderResolutionSource: placeholderResolutionSource || "brand"
    };
  }

  if (!endpointProviderDomain) {
    if (!runtimeResolvedProviderDomain) {
      const fallbackRequested = safeNormalizeProviderDomain(requestedProviderDomain);
      if (!fallbackRequested) {
        const err = new Error("provider_domain is required.");
        err.code = "provider_domain_not_resolved";
        err.status = 400;
        throw err;
      }

      return {
        providerDomain: fallbackRequested,
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource
    };
  }

  if (isVariablePlaceholder(endpointProviderDomain, policies)) {
    const allowPlaceholderResolution = String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allow Placeholder Provider Domain Resolution",
        "FALSE"
      )
    ).trim().toUpperCase() === "TRUE";

    if (!allowPlaceholderResolution) {
      const err = new Error("Placeholder provider_domain resolution is disabled by policy.");
      err.code = "provider_domain_placeholder_blocked";
      err.status = 403;
      throw err;
    }

    if (!requestBody.target_key && !requestBody.brand && !requestBody.brand_domain) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
    }

    const allowedSources = getPlaceholderResolutionSources(policies);
    const hasAllowedSource =
      (allowedSources.includes("brand_domain") && !!String(requestBody.brand_domain || "").trim()) ||
      (allowedSources.includes("target_key") && !!String(requestBody.target_key || "").trim()) ||
      (allowedSources.includes("brand") && !!String(requestBody.brand || "").trim());

    if (allowedSources.length && !hasAllowedSource) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
      const err = new Error(
        `provider_domain placeholder resolution requires one of: ${allowedSources.join(", ")}`
      );
      err.code = "provider_domain_resolution_source_missing";
      err.status = 400;
      throw err;
    }

    if (!runtimeResolvedProviderDomain) {
      const err = new Error("provider_domain must resolve from governed runtime input.");
      err.code = "provider_domain_not_resolved";
      err.status = 400;
      throw err;
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "placeholder_runtime_resolved",
      placeholderResolutionSource
    };
  }

  const normalizedEndpointProviderDomain =
    normalizeEndpointProviderDomain(endpointProviderDomain);
  const normalizedRequested =
    safeNormalizeProviderDomain(requestedProviderDomain);

  // Fixed-domain provider actions may omit provider_domain in the request.
  // In that case, trust the endpoint definition.
  if (!normalizedRequested) {
    return {
      providerDomain: normalizedEndpointProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  if (normalizedRequested !== normalizedEndpointProviderDomain) {
    const err = new Error("provider_domain does not match endpoint definition.");
    err.code = "provider_domain_mismatch";
    err.status = 403;
    throw err;
  }

  return {
    providerDomain: normalizedEndpointProviderDomain,
    resolvedProviderDomainMode: "fixed_domain",
    placeholderResolutionSource: ""
  };
}

function isOAuthConfigured(action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  return fileId !== "" && fileId.toLowerCase() !== "null";
}

function inferAuthMode({ action, brand }) {
  if (brand?.auth_type === "basic_auth_app_password") return "basic_auth";

  const actionKey = String(action.action_key || "").trim().toLowerCase();
  const apiKeyMode = String(action.api_key_mode || "").trim().toLowerCase();
  const headerName = String(action.api_key_header_name || "").trim();
  const paramName = String(action.api_key_param_name || "").trim();
  const oauthConfigured = isOAuthConfigured(action);

  if (
    headerName &&
    String(headerName).toLowerCase() === "authorization" &&
    apiKeyMode.includes("bearer")
  ) {
    return "bearer_token";
  }

  if (apiKeyMode === "basic_auth_app_password") {
    return "basic_auth";
  }

  if (
    actionKey === "googleads_api" &&
    oauthConfigured &&
    headerName &&
    String(headerName).toLowerCase() !== "authorization"
  ) {
    return "oauth_gpt_action";
  }

  if (headerName && apiKeyMode === "custom_api") {
    return "api_key_header";
  }

  if (paramName) return "api_key_query";
  if (headerName) return "api_key_header";

  if (oauthConfigured) return "oauth_gpt_action";
  return "none";
}

function normalizeAuthContract({
  action,
  brand,
  hostingAccounts = [],
  targetKey = ""
}) {
  const mode = inferAuthMode({ action, brand });
  const contract = {
    mode,
    inject: true,
    username: "",
    secret: "",
    param_name: "",
    header_name: "",
    custom_headers: {}
  };

  if (mode === "basic_auth") {
    contract.username = brand?.username || "";
    contract.secret = brand?.application_password || "";
    contract.header_name = "Authorization";
    return contract;
  }

  if (mode === "api_key_query") {
    contract.param_name = action.api_key_param_name || "api_key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "api_key_header") {
    contract.header_name = action.api_key_header_name || "x-api-key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "bearer_token") {
    contract.header_name = "Authorization";

    const storageMode = String(action.api_key_storage_mode || "")
      .trim()
      .toLowerCase();

    // old/simple action-level mode
    if (!storageMode || storageMode === "embedded_sheet") {
      contract.secret = action.api_key_value || "";
      return contract;
    }

    // governed per-target credentials:
    // brand -> hosting account OR direct hosting-account target -> account registry -> secret reference
    if (storageMode === "per_target_credentials") {
      const accountKey = resolveAccountKey({
        brand,
        targetKey,
        hostingAccounts
      });

      const hostingAccount = findHostingAccountByKey(hostingAccounts, accountKey);

      if (hostingAccount) {
        const accountStorageMode = String(
          hostingAccount.api_key_storage_mode || ""
        ).trim().toLowerCase();

        if (accountStorageMode === "secret_reference") {
          contract.secret = resolveSecretFromReference(
            hostingAccount.api_key_reference
          );
          return contract;
        }
        contract.secret = String(hostingAccount.api_key_reference || "").trim();
        return contract;
      }

      contract.secret = "";
      return contract;
    }

    contract.secret = action.api_key_value || "";
    return contract;
  }

  return contract;
}

function findHostingAccountByKey(hostingAccounts = [], key = "") {
  const wanted = String(key || "").trim();
  if (!wanted) return null;

  return (
    hostingAccounts.find(
      row => String(row.hosting_account_key || "").trim() === wanted
    ) || null
  );
}

function resolveAccountKeyFromBrand(brand = {}) {
  return (
    String(brand?.hosting_account_key || "").trim() ||
    String(brand?.hostinger_api_target_key || "").trim() ||
    String(brand?.hosting_account_registry_ref || "").trim()
  );
}

function resolveAccountKey({
  brand = null,
  targetKey = "",
  hostingAccounts = []
}) {
  const fromBrand = resolveAccountKeyFromBrand(brand);
  if (fromBrand) return fromBrand;

  const directTargetKey = String(targetKey || "").trim();
  if (!directTargetKey) return "";

  const directHostingAccount = findHostingAccountByKey(
    hostingAccounts,
    directTargetKey
  );
  if (directHostingAccount) {
    return String(directHostingAccount.hosting_account_key || "").trim();
  }

  return "";
}

function resolveSecretFromReference(reference = "") {
  const ref = String(reference || "").trim();
  if (!ref) return "";

  const prefix = "ref:secret:";
  if (!ref.startsWith(prefix)) return "";

  const secretKey = ref.slice(prefix.length).trim();
  if (!secretKey) return "";

  return String(process.env[secretKey] || "").trim();
}

function isGoogleApiHost(providerDomain = "") {
  try {
    return new URL(providerDomain).hostname.endsWith("googleapis.com");
  } catch {
    return false;
  }
}

function getAdditionalStaticAuthHeaders(action = {}, authContract = {}) {
  const headerName = String(action.api_key_header_name || "").trim();
  const headerValue = String(action.api_key_value || "").trim();

  if (!headerName || !headerValue) return {};
  if (headerName.toLowerCase() === "authorization") return {};

  return { [headerName]: headerValue };
}

function enforceSupportedAuthMode(policies, mode) {
  const supported = String(policyValue(policies, "HTTP Execution Governance", "Supported Auth Modes", ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
  if (!supported.includes(mode)) {
    const err = new Error(`Resolved auth mode is unsupported by policy: ${mode}`);
    err.code = "unsupported_auth_mode";
    err.status = 403;
    throw err;
  }
}

function applyPathParams(pathTemplate, pathParams = {}) {
  return String(pathTemplate || "").replace(/\{([^}]+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      const err = new Error(`Missing required path param: ${key}`);
      err.code = "invalid_request";
      err.status = 400;
      throw err;
    }
    return encodeURIComponent(String(value));
  });
}

function pathTemplateToRegex(pathTemplate) {
  const escaped = String(pathTemplate)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function ensureMethodAndPathMatchEndpoint(
  endpoint,
  requestedMethod,
  requestedPath,
  pathParams = {}
) {
  const endpointMethod = normalizeMethod(endpoint.method);
  const endpointPath = normalizePath(endpoint.endpoint_path_or_function);

  let expandedPath = "";
  let pathExpansionError = null;

  try {
    expandedPath = normalizePath(
      applyPathParams(endpointPath, pathParams)
    );
  } catch (err) {
    pathExpansionError = err;
  }

  if (requestedMethod) {
    const normalizedRequestedMethod = normalizeMethod(requestedMethod);
    if (normalizedRequestedMethod !== endpointMethod) {
      const err = new Error(
        `Method does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "method_mismatch";
      err.status = 400;
      throw err;
    }
  }

  if (requestedPath) {
    const normalizedRequestedPath = normalizePath(requestedPath);

    const exact =
      normalizedRequestedPath === endpointPath ||
      (!!expandedPath && normalizedRequestedPath === expandedPath);

    const regexMatch =
      pathTemplateToRegex(endpointPath).test(normalizedRequestedPath);

    if (!exact && !regexMatch) {
      const err = new Error(
        `Path does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "path_mismatch";
      err.status = 400;
      throw err;
    }

    return {
      method: endpointMethod,
      path: normalizedRequestedPath,
      templatePath: endpointPath
    };
  }

  if (pathExpansionError) {
    throw pathExpansionError;
  }

  return {
    method: endpointMethod,
    path: expandedPath,
    templatePath: endpointPath
  };
}

async function fetchSchemaContract(drive, fileId) {
  if (!fileId) {
    const err = new Error("Missing openai_schema_file_id.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType"
  });

  const { mimeType = "", name = "" } = meta.data || {};
  let raw = "";

  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    raw = String(exported.data || "");
  } else {
    const content = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    raw = String(content.data || "");
  }

  let parsed;
  try {
    if (name.endsWith(".json") || mimeType.includes("json")) {
      parsed = JSON.parse(raw);
    } else {
      parsed = YAML.parse(raw);
    }
  } catch {
    const err = new Error(`Unable to parse schema file ${fileId}.`);
    err.code = "schema_parse_failed";
    err.status = 500;
    throw err;
  }

  return { fileId, name, mimeType, raw, parsed };
}

async function fetchOAuthConfigContract(drive, action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  if (!fileId) return null;

  try {
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
    const { mimeType = "", name = "" } = meta.data || {};
    let raw = "";

    if (mimeType.startsWith("application/vnd.google-apps")) {
      const exported = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" }
      );
      raw = String(exported.data || "");
    } else {
      const content = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );
      raw = String(content.data || "");
    }

    let parsed;
    try {
      if (name.endsWith(".json") || mimeType.includes("json")) {
        parsed = JSON.parse(raw);
      } else {
        parsed = YAML.parse(raw);
      }
    } catch {
      parsed = JSON.parse(raw);
    }

    return { fileId, name, mimeType, raw, parsed };
  } catch (err) {
    debugLog("OAUTH_CONFIG_READ_FAILED:", {
      action_key: action.action_key,
      oauth_config_file_id: fileId,
      message: err?.message || String(err)
    });
    return null;
  }
}

function resolveSchemaOperation(schema, method, path) {
  const doc = schema?.parsed || {};
  const paths = doc.paths || {};
  const methodKey = String(method || "").toLowerCase();

  if (paths[path] && paths[path][methodKey]) {
    return { operation: paths[path][methodKey], pathTemplate: path };
  }

  for (const [template, entry] of Object.entries(paths)) {
    const regex = pathTemplateToRegex(template);
    if (regex.test(path) && entry?.[methodKey]) {
      return { operation: entry[methodKey], pathTemplate: template };
    }
  }

  return null;
}

function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  if (!schema) return [];

  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const normalizedActualType = actualType === "number" && Number.isInteger(value) ? "integer" : actualType;

  if (types.length && !types.includes(normalizedActualType) && !(types.includes("number") && normalizedActualType === "integer")) {
    errors.push(`${scope}${pathPrefix}: expected ${types.join("|")} got ${normalizedActualType}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${scope}${pathPrefix}: value not in enum`);
    return errors;
  }

  if (normalizedActualType === "object" && schema.properties) {
    const required = schema.required || [];
    for (const req of required) {
      if (!(req in (value || {}))) {
        errors.push(`${scope}${pathPrefix}.${req}: missing required property`);
      }
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (value && key in value) {
        errors.push(...validateByJsonSchema(rule, value[key], scope, `${pathPrefix}.${key}`));
      }
    }
  }

  if (normalizedActualType === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, idx) => {
      errors.push(...validateByJsonSchema(schema.items, item, scope, `${pathPrefix}[${idx}]`));
    });
  }

  return errors;
}

function validateParameters(operation, request) {
  const errors = [];
  const params = operation?.parameters || [];
  for (const param of params) {
    const where = param.in;
    const name = param.name;
    const required = !!param.required;
    const source = where === "path" ? request.path_params
      : where === "query" ? request.query
      : where === "header" ? request.headers
      : {};
    const value = source ? source[name] ?? source[name?.toLowerCase?.()] : undefined;
    if (required && (value === undefined || value === null || value === "")) {
      errors.push(`missing required ${where} parameter: ${name}`);
      continue;
    }
    if (value !== undefined && param.schema) {
      errors.push(...validateByJsonSchema(param.schema, value, `${where}:${name}`));
    }
  }
  return errors;
}

function validateRequestBody(operation, body) {
  const reqBody = operation?.requestBody;
  if (!reqBody) return [];
  if (reqBody.required && (body === undefined || body === null)) {
    return ["missing required request body"];
  }
  if (body === undefined || body === null) return [];

  const content = reqBody.content || {};
  const jsonContent = content["application/json"] || Object.values(content)[0];
  const schema = jsonContent?.schema;
  if (!schema) return [];
  return validateByJsonSchema(schema, body, "body");
}

function classifySchemaDrift(expected, actual, scope) {
  if (!expected || actual === undefined || actual === null || typeof actual !== "object" || Array.isArray(actual)) return null;
  const expectedProps = expected.properties || {};
  const expectedKeys = new Set(Object.keys(expectedProps));
  const actualKeys = Object.keys(actual);
  const required = new Set(expected.required || []);

  for (const key of required) {
    if (!(key in actual)) {
      return { schema_drift_detected: true, schema_drift_type: "missing_required", schema_drift_scope: scope };
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return { schema_drift_detected: true, schema_drift_type: "additive", schema_drift_scope: scope };
    }
    const rule = expectedProps[key] || {};
    if (rule.enum && !rule.enum.includes(actual[key])) {
      return { schema_drift_detected: true, schema_drift_type: "enum_mismatch", schema_drift_scope: scope };
    }
    const t = rule.type;
    if (t) {
      const actualType = Array.isArray(actual[key]) ? "array" : actual[key] === null ? "null" : typeof actual[key];
      const mappedActual = actualType === "number" && Number.isInteger(actual[key]) ? "integer" : actualType;
      const acceptable = Array.isArray(t) ? t : [t];
      if (!acceptable.includes(mappedActual) && !(acceptable.includes("number") && mappedActual === "integer")) {
        return { schema_drift_detected: true, schema_drift_type: "type_mismatch", schema_drift_scope: scope };
      }
    }
  }
  return null;
}

function buildResolvedAuthHeaders(contract) {
  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    return { Authorization: `Basic ${token}` };
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { Authorization: `Bearer ${contract.secret}` };
  }

  if (contract.mode === "custom_headers") {
    return { ...(contract.custom_headers || {}) };
  }

  return {};
}

function injectAuthIntoQuery(query, contract) {
  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...query, [contract.param_name]: contract.secret };
  }
  return query;
}

function injectAuthIntoHeaders(headers, contract) {
  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...headers, [contract.header_name]: contract.secret };
  }

  return { ...headers, ...buildResolvedAuthHeaders(contract) };
}

function injectAuthForSchemaValidation(query, headers, contract) {
  let nextQuery = { ...(query || {}) };
  let nextHeaders = { ...(headers || {}) };

  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextQuery[contract.param_name] = contract.secret;
  }

  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders[contract.header_name] = contract.secret;
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders["Authorization"] = `Bearer ${contract.secret}`;
  }

  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    nextHeaders["Authorization"] = `Basic ${token}`;
  }

  return { query: nextQuery, headers: nextHeaders };
}

function ensureWritePermissions(brand, method) {
  if (brand && ["POST", "PUT", "PATCH"].includes(method) && !boolFromSheet(brand.write_allowed)) {
    const err = new Error(`Write operations are not allowed for ${brand.brand_name || brand.base_url}.`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }

  if (method === "DELETE") {
    if (brand && boolFromSheet(brand.destructive_allowed)) return;
    const err = new Error("DELETE is not allowed for this target.");
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
}

let jobWorkerActive = false;

const TERMINAL_JOB_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled"
]);
const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "running",
  "retrying"
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeJobId(value = "") {
  return String(value || "").trim();
}

function normalizeJobStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeWebhookUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeMaxAttempts(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_JOB_MAX_ATTEMPTS;
  return Math.min(Math.floor(n), 10);
}

function nextRetryDelayMs(attemptCount) {
  const idx = Math.max(0, Number(attemptCount || 1) - 1);
  if (idx < JOB_RETRY_DELAYS_MS.length) return JOB_RETRY_DELAYS_MS[idx];
  return JOB_RETRY_DELAYS_MS[JOB_RETRY_DELAYS_MS.length - 1];
}

function buildJobId() {
  return `job_${crypto.randomUUID().replace(/-/g, "")}`;
}

function resolveRequestedBy(req) {
  const byHeader =
    req.header("X-Requested-By") ||
    req.header("X-Requester-Id") ||
    "";

  return String(byHeader || req.ip || "unknown").trim();
}

function makeIdempotencyLookupKey(requestedBy, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return "";
  return `${String(requestedBy || "").trim()}::${key}`;
}

function buildExecutionPayloadFromJobRequest(body = {}) {
  const nested =
    body.request_payload &&
    typeof body.request_payload === "object" &&
    !Array.isArray(body.request_payload)
      ? { ...body.request_payload }
      : null;

  const topLevelPayload = { ...(body || {}) };
  delete topLevelPayload.request_payload;
  delete topLevelPayload.job_type;
  delete topLevelPayload.max_attempts;
  delete topLevelPayload.webhook_url;
  delete topLevelPayload.callback_secret;
  delete topLevelPayload.idempotency_key;

  return nested || topLevelPayload;
}

function validateAsyncJobRequest(payload = {}) {
  const errors = [];
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["request payload must be an object."];
  }

  if (!String(payload.parent_action_key || "").trim()) {
    errors.push("parent_action_key is required.");
  }

  if (!String(payload.endpoint_key || "").trim()) {
    errors.push("endpoint_key is required.");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string when provided.");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string when provided.");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string when provided.");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string when provided.");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string when provided.");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string when provided.");
  }

  if (payload.method !== undefined) {
    if (typeof payload.method !== "string") {
      errors.push("method must be a string when provided.");
    } else {
      const normalizedMethod = String(payload.method).trim().toUpperCase();
      if (!allowedMethods.has(normalizedMethod)) {
        errors.push("method must be one of GET, POST, PUT, PATCH, DELETE.");
      }
    }
  }

  if (payload.path !== undefined) {
    if (typeof payload.path !== "string") {
      errors.push("path must be a string when provided.");
    } else {
      const trimmedPath = String(payload.path).trim();
      if (!trimmedPath.startsWith("/")) {
        errors.push("path must start with '/'.");
      }
      if (/^https?:\/\//i.test(trimmedPath)) {
        errors.push("path must be a relative path, not a full URL.");
      }
    }
  }

  if (
    payload.path_params !== undefined &&
    (
      !payload.path_params ||
      typeof payload.path_params !== "object" ||
      Array.isArray(payload.path_params)
    )
  ) {
    errors.push("path_params must be an object when provided.");
  }

  if (
    payload.query !== undefined &&
    (
      !payload.query ||
      typeof payload.query !== "object" ||
      Array.isArray(payload.query)
    )
  ) {
    errors.push("query must be an object when provided.");
  }

  if (
    payload.headers !== undefined &&
    (
      !payload.headers ||
      typeof payload.headers !== "object" ||
      Array.isArray(payload.headers)
    )
  ) {
    errors.push("headers must be an object when provided.");
  }

  if (payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)) {
    for (const [key, value] of Object.entries(payload.headers)) {
      if (typeof value !== "string") {
        errors.push(`headers.${key} must be a string.`);
      }
      if (String(key).toLowerCase() === "authorization") {
        errors.push("headers.Authorization must not be supplied by caller.");
      }
    }
  }

  if (
    payload.readback !== undefined &&
    (
      !payload.readback ||
      typeof payload.readback !== "object" ||
      Array.isArray(payload.readback)
    )
  ) {
    errors.push("readback must be an object when provided.");
  }

  if (payload.readback && typeof payload.readback === "object" && !Array.isArray(payload.readback)) {
    if (
      payload.readback.required !== undefined &&
      typeof payload.readback.required !== "boolean"
    ) {
      errors.push("readback.required must be a boolean when provided.");
    }

    if (payload.readback.mode !== undefined) {
      const allowedModes = new Set(["none", "echo", "location_followup"]);
      if (typeof payload.readback.mode !== "string") {
        errors.push("readback.mode must be a string when provided.");
      } else if (!allowedModes.has(String(payload.readback.mode).trim())) {
        errors.push("readback.mode must be one of none, echo, location_followup.");
      }
    }
  }

  if (
    payload.expect_json !== undefined &&
    typeof payload.expect_json !== "boolean"
  ) {
    errors.push("expect_json must be a boolean when provided.");
  }

  if (
    payload.force_refresh !== undefined &&
    typeof payload.force_refresh !== "boolean"
  ) {
    errors.push("force_refresh must be a boolean when provided.");
  }

  if (payload.timeout_seconds !== undefined) {
    if (
      typeof payload.timeout_seconds !== "number" ||
      !Number.isInteger(payload.timeout_seconds)
    ) {
      errors.push("timeout_seconds must be an integer when provided.");
    } else {
      if (payload.timeout_seconds < 1) {
        errors.push("timeout_seconds must be at least 1.");
      }
      if (payload.timeout_seconds > MAX_TIMEOUT_SECONDS) {
        errors.push(`timeout_seconds must be <= ${MAX_TIMEOUT_SECONDS}.`);
      }
    }
  }

  return errors;
}



function createHttpError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}


function buildRecordFromHeaderAndRow(header = [], row = []) {
  const record = {};
  header.forEach((key, idx) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    record[normalizedKey] = row[idx] ?? "";
  });
  return record;
}

function buildSheetRowFromColumns(columns = [], row = {}) {
  return columns.map(column => toSheetCellValue(row[column]));
}

function assertCanonicalHeaderExact(header = [], expected = [], sheetName = "sheet") {
  const actual = (header || []).map(v => String(v || "").trim());
  const canonical = (expected || []).map(v => String(v || "").trim());

  if (actual.length !== canonical.length) {
    const err = new Error(
      `${sheetName} header column count mismatch. expected=${canonical.length} actual=${actual.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const mismatches = [];
  for (let i = 0; i < canonical.length; i += 1) {
    if (actual[i] !== canonical[i]) {
      mismatches.push({
        index: i,
        expected: canonical[i],
        actual: actual[i] || ""
      });
    }
  }

  if (mismatches.length) {
    const err = new Error(
      `${sheetName} header order mismatch at ${mismatches.length} position(s).`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    err.details = mismatches;
    throw err;
  }

  return true;
}

function blockLegacyRouteWorkflowWrite(surfaceName = "", requestedColumns = []) {
  const cols = (requestedColumns || []).map(v => String(v || "").trim());

  if (
    surfaceName === TASK_ROUTES_SHEET &&
    cols.length > 0 &&
    cols.length < TASK_ROUTES_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${TASK_ROUTES_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  if (
    surfaceName === WORKFLOW_REGISTRY_SHEET &&
    cols.length > 0 &&
    cols.length < WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  return true;
}

function assertNoLegacySiteMigrationScaffolding() {
  if (
    typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  ) {
    const err = new Error("Legacy SITE_MIGRATION_* scaffolding must not exist in canonical mode.");
    err.code = "legacy_site_migration_scaffolding_present";
    err.status = 500;
    throw err;
  }
}

function assertSingleActiveRowByKey(rows = [], keyName = "", activeName = "active", sheetName = "sheet") {
  const seen = new Map();

  for (const row of rows) {
    const key = String(row?.[keyName] || "").trim();
    const active = String(row?.[activeName] || "").trim().toUpperCase() === "TRUE";
    if (!key || !active) continue;

    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length) {
    const err = new Error(
      `${sheetName} has duplicate active governed keys: ${duplicates.join(", ")}`
    );
    err.code = "duplicate_active_governed_keys";
    err.status = 500;
    throw err;
  }

  return true;
}

function normalizeGovernedAdditionState(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "active";
  if (!GOVERNED_ADDITION_STATES.has(v)) return "active";
  return v;
}

function normalizeGovernedAdditionOutcome(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (!GOVERNED_ADDITION_OUTCOMES.has(v)) return "";
  return v;
}

function governedAdditionStateBlocksAuthority(value = "") {
  const state = normalizeGovernedAdditionState(value);
  return ["candidate", "inactive", "pending_validation", "blocked", "degraded"].includes(state);
}

function hasDeferredGovernedActivationDependencies(row = {}, keys = []) {
  return (keys || []).some(key => boolFromSheet(row?.[key]));
}

function buildGovernedAdditionReviewResult(args = {}) {
  const outcome = normalizeGovernedAdditionOutcome(args.outcome);
  if (!outcome) {
    const err = new Error("Invalid governed addition outcome.");
    err.code = "invalid_governed_addition_outcome";
    err.status = 400;
    throw err;
  }

  return {
    outcome,
    addition_state: normalizeGovernedAdditionState(args.addition_state || "pending_validation"),
    route_overlap_detected: !!args.route_overlap_detected,
    workflow_overlap_detected: !!args.workflow_overlap_detected,
    chain_needed: !!args.chain_needed,
    graph_update_required: !!args.graph_update_required,
    bindings_update_required: !!args.bindings_update_required,
    policy_update_required: !!args.policy_update_required,
    starter_update_required: !!args.starter_update_required,
    reconciliation_required: !!args.reconciliation_required,
    validation_required: true
  };
}

function assertNoDirectActivationWithoutGovernedReview(row = {}, surfaceName = "sheet") {
  const additionState = normalizeGovernedAdditionState(
    row.addition_status || row.governance_status || row.validation_status || ""
  );
  const active = String(row.active || "").trim().toUpperCase() === "TRUE";

  if (active && ["candidate", "pending_validation", "inactive", "blocked", "degraded"].includes(additionState)) {
    return true;
  }

  if (active && !additionState) {
    // existing canonical rows are allowed
    return true;
  }

  return true;
}

async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title,index)"
  });

  const map = {};
  for (const sheet of response.data.sheets || []) {
    const props = sheet?.properties || {};
    const title = String(props.title || "").trim();
    if (!title) continue;
    map[title] = {
      sheetId: props.sheetId,
      title,
      index: props.index
    };
  }
  return map;
}

async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  const sheetMap = await getSpreadsheetSheetMap(sheets, spreadsheetId);
  if (!sheetMap[sheetName]) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: String(spreadsheetId || "").trim(),
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "1:2")
  });

  const values = response.data.values || [];
  const existingHeader = (values[0] || []).map(v => String(v || "").trim()).filter(Boolean);

  if (!existingHeader.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: String(spreadsheetId || "").trim(),
      range: toValuesApiRange(sheetName, "A1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [columns]
      }
    });
    return { created: true, header_written: true };
  }

  const existingSignature = computeHeaderSignature(existingHeader);
  const expectedSignature = computeHeaderSignature(columns);
  if (existingSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch.`);
    err.code = "sheet_schema_mismatch";
    err.status = 409;
    throw err;
  }

  return { created: false, header_written: false };
}

async function appendRowsIfMissingByKeys(
  sheets,
  spreadsheetId,
  sheetName,
  columns,
  keyColumns,
  rows = []
) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  if (!rows.length) return { appended: 0, existing: 0 };

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const existingRows = values.slice(1).map(row => buildRecordFromHeaderAndRow(header, row));

  const seen = new Set(
    existingRows.map(record => keyColumns.map(key => String(record[key] || "").trim()).join("||"))
  );

  const missingRows = rows.filter(row => {
    const key = keyColumns.map(column => String(row[column] || "").trim()).join("||");
    return key && !seen.has(key);
  });

  if (!missingRows.length) {
    return { appended: 0, existing: rows.length };
  }

  for (const row of missingRows) {
    assertNoDirectActivationWithoutGovernedReview(row, sheetName);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: missingRows.map(row => buildSheetRowFromColumns(columns, row))
    }
  });

  return {
    appended: missingRows.length,
    existing: rows.length - missingRows.length
  };
}

async function ensureSiteMigrationRegistrySurfaces() {
  assertNoLegacySiteMigrationScaffolding();

  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, PLUGIN_INVENTORY_REGISTRY_SHEET);

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    site_runtime_inventory: { exists: true },
    site_settings_inventory: { exists: true },
    plugin_inventory: { exists: true },
    task_routes: {
      exists: true,
      schema: taskRoutesSchemaLabel
    },
    workflow_registry: {
      exists: true,
      schema: workflowRegistrySchemaLabel
    }
  };
}

async function ensureSiteMigrationRouteWorkflowRows() {
  assertNoLegacySiteMigrationScaffolding();

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const { sheets } = await getGoogleClients();

  const taskRoutes = await loadTaskRoutesRegistry(sheets, {
    include_candidate_inspection: true
  });
  const workflows = await loadWorkflowRegistry(sheets, {
    include_candidate_inspection: true
  });

  const foundTaskKeys = new Set(
    taskRoutes
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const foundWorkflowIds = new Set(
    workflows
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const executableTaskKeys = new Set(
    taskRoutes
      .filter(row => row.executable_authority === true)
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const executableWorkflowIds = new Set(
    workflows
      .filter(row => row.executable_authority === true)
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const missingTaskKeys = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(v => !foundTaskKeys.has(v));
  const missingWorkflowIds = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(v => !foundWorkflowIds.has(v));

  const unresolvedTaskAuthority = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(
    v => foundTaskKeys.has(v) && !executableTaskKeys.has(v)
  );
  const unresolvedWorkflowAuthority = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(
    v => foundWorkflowIds.has(v) && !executableWorkflowIds.has(v)
  );

  const chainReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.chain_candidate)) ||
    workflows.some(row => boolFromSheet(row.chain_eligible));
  const graphReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.graph_update_required)) ||
    workflows.some(row => boolFromSheet(row.graph_update_required));
  const bindingsReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.bindings_update_required)) ||
    workflows.some(row => boolFromSheet(row.bindings_update_required));
  const reconciliationRequired =
    taskRoutes.some(row => boolFromSheet(row.reconciliation_required)) ||
    workflows.some(row => boolFromSheet(row.reconciliation_required));
  const policyReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.policy_update_required)) ||
    workflows.some(row =>
      boolFromSheet(row.policy_update_required) ||
      boolFromSheet(row.policy_dependency_required)
    );
  const starterReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.starter_update_required)) ||
    workflows.some(row => boolFromSheet(row.starter_update_required));
  const repairMappingRequired =
    workflows.some(row => boolFromSheet(row.repair_mapping_required));

  const hasMissingDependencies = missingTaskKeys.length > 0 || missingWorkflowIds.length > 0;
  const hasDeferredActivation =
    unresolvedTaskAuthority.length > 0 ||
    unresolvedWorkflowAuthority.length > 0 ||
    chainReviewRequired ||
    graphReviewRequired ||
    bindingsReviewRequired ||
    reconciliationRequired ||
    policyReviewRequired ||
    starterReviewRequired ||
    repairMappingRequired;

  const outcome = hasMissingDependencies
    ? "degraded_missing_dependencies"
    : hasDeferredActivation
    ? "pending_validation"
    : "reuse_existing";

  const review = buildGovernedAdditionReviewResult({
    outcome,
    addition_state: outcome === "reuse_existing" ? "active" : "pending_validation",
    route_overlap_detected: false,
    workflow_overlap_detected: false,
    chain_needed: chainReviewRequired,
    graph_update_required: graphReviewRequired,
    bindings_update_required: bindingsReviewRequired,
    policy_update_required: policyReviewRequired,
    starter_update_required: starterReviewRequired,
    reconciliation_required: reconciliationRequired
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    outcome,
    review,
    task_routes_schema: taskRoutesSchemaLabel,
    workflow_registry_schema: workflowRegistrySchemaLabel,
    found_task_keys: [...foundTaskKeys],
    found_workflow_ids: [...foundWorkflowIds],
    executable_task_keys: [...executableTaskKeys],
    executable_workflow_ids: [...executableWorkflowIds],
    missing_task_keys: missingTaskKeys,
    missing_workflow_ids: missingWorkflowIds,
    unresolved_task_authority: unresolvedTaskAuthority,
    unresolved_workflow_authority: unresolvedWorkflowAuthority,
    chain_review_required: chainReviewRequired,
    graph_review_required: graphReviewRequired,
    bindings_review_required: bindingsReviewRequired,
    reconciliation_required: reconciliationRequired,
    policy_review_required: policyReviewRequired,
    starter_review_required: starterReviewRequired,
    repair_mapping_required: repairMappingRequired,
    task_routes_ready: REQUIRED_SITE_MIGRATION_TASK_KEYS.every(v => executableTaskKeys.has(v)),
    workflow_registry_ready: REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.every(v => executableWorkflowIds.has(v))
  };
}

async function loadSiteRuntimeInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Runtime Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    supported_cpts: getCell(row, map, "supported_cpts"),
    supported_taxonomies: getCell(row, map, "supported_taxonomies"),
    generated_endpoint_support: getCell(row, map, "generated_endpoint_support"),
    runtime_validation_status: getCell(row, map, "runtime_validation_status"),
    last_runtime_validated_at: getCell(row, map, "last_runtime_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadSiteSettingsInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Settings Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    permalink_structure: getCell(row, map, "permalink_structure"),
    timezone_string: getCell(row, map, "timezone_string"),
    site_language: getCell(row, map, "site_language"),
    active_theme: getCell(row, map, "active_theme"),
    settings_validation_status: getCell(row, map, "settings_validation_status"),
    last_settings_validated_at: getCell(row, map, "last_settings_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadPluginInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${PLUGIN_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Plugin Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, PLUGIN_INVENTORY_REGISTRY_SHEET);
  for (const col of PLUGIN_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${PLUGIN_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    active_plugins: getCell(row, map, "active_plugins"),
    plugin_versions_json: getCell(row, map, "plugin_versions_json"),
    plugin_owned_tables: getCell(row, map, "plugin_owned_tables"),
    plugin_owned_entities: getCell(row, map, "plugin_owned_entities"),
    plugin_validation_status: getCell(row, map, "plugin_validation_status"),
    last_plugin_validated_at: getCell(row, map, "last_plugin_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadTaskRoutesRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError("Task Routes");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: headers,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, TASK_ROUTES_SHEET);

  const rows = values.slice(1).map(row => {
    const taskKey = getCell(row, map, "Task Key");
    const activeRaw = getCell(row, map, "active");
    const routeActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const routeRecord = {
      task_key: taskKey,
      route_key: taskKey,
      trigger_terms: getCell(row, map, "Trigger Terms"),
      route_modules: getCell(row, map, "Route Modules"),
      execution_layer: getCell(row, map, "Execution Layer"),
      enabled: getCell(row, map, "Enabled"),
      output_focus: getCell(row, map, "Output Focus"),
      notes: getCell(row, map, "Notes"),
      entry_sources: getCell(row, map, "Entry Sources"),
      linked_starter_titles: getCell(row, map, "Linked Starter Titles"),
      active_starter_count: getCell(row, map, "Active Starter Count"),
      route_key_match_status: getCell(row, map, "Route Key Match Status"),
      row_id: getCell(row, map, "row_id"),
      route_id: getCell(row, map, "route_id"),
      active: activeRaw,
      intent_key: getCell(row, map, "intent_key"),
      brand_scope: getCell(row, map, "brand_scope"),
      request_type: getCell(row, map, "request_type"),
      route_mode: getCell(row, map, "route_mode"),
      target_module: getCell(row, map, "target_module"),
      workflow_key: getCell(row, map, "workflow_key"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      priority: getCell(row, map, "priority"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      match_rule: getCell(row, map, "match_rule"),
      route_source: getCell(row, map, "route_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      overlap_group: getCell(row, map, "overlap_group"),
      integration_mode: getCell(row, map, "integration_mode"),
      chain_candidate: getCell(row, map, "chain_candidate"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      routeRecord,
      [
        "chain_candidate",
        "graph_update_required",
        "bindings_update_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      routeActive &&
      !governedAdditionStateBlocksAuthority(routeRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...routeRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.task_key || "").trim() ||
    String(row.route_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "route_id", "active", TASK_ROUTES_SHEET);
  assertSingleActiveRowByKey(rows, "task_key", "active", TASK_ROUTES_SHEET);

  // Execution Chains and graph surfaces can inform validation only; they do not promote authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

async function loadWorkflowRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError("Workflow Registry");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: headers,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, WORKFLOW_REGISTRY_SHEET);

  const rows = values.slice(1).map(row => {
    const activeRaw = getCell(row, map, "active");
    const workflowActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const workflowRecord = {
      workflow_id: getCell(row, map, "Workflow ID"),
      workflow_name: getCell(row, map, "Workflow Name"),
      module_mode: getCell(row, map, "Module Mode"),
      trigger_source: getCell(row, map, "Trigger Source"),
      input_type: getCell(row, map, "Input Type"),
      primary_objective: getCell(row, map, "Primary Objective"),
      mapped_engines: getCell(row, map, "Mapped Engine(s)"),
      engine_order: getCell(row, map, "Engine Order"),
      workflow_type: getCell(row, map, "Workflow Type"),
      primary_output: getCell(row, map, "Primary Output"),
      input_detection_rules: getCell(row, map, "Input Detection Rules"),
      output_template: getCell(row, map, "Output Template"),
      priority: getCell(row, map, "Priority"),
      route_key: getCell(row, map, "Route Key"),
      execution_mode: getCell(row, map, "Execution Mode"),
      user_facing: getCell(row, map, "User Facing"),
      parent_layer: getCell(row, map, "Parent Layer"),
      status: getCell(row, map, "Status"),
      linked_workflows: getCell(row, map, "Linked Workflows"),
      linked_engines: getCell(row, map, "Linked Engines"),
      notes: getCell(row, map, "Notes"),
      entry_priority_weight: getCell(row, map, "Entry Priority Weight"),
      dependency_type: getCell(row, map, "Dependency Type"),
      output_artifact_type: getCell(row, map, "Output Artifact Type"),
      workflow_key: getCell(row, map, "workflow_key"),
      active: activeRaw,
      target_module: getCell(row, map, "target_module"),
      execution_class: getCell(row, map, "execution_class"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      route_compatibility: getCell(row, map, "route_compatibility"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      registry_source: getCell(row, map, "registry_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      workflow_family: getCell(row, map, "workflow_family"),
      overlap_group: getCell(row, map, "overlap_group"),
      execution_path_role: getCell(row, map, "execution_path_role"),
      chain_eligible: getCell(row, map, "chain_eligible"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      repair_mapping_required: getCell(row, map, "repair_mapping_required"),
      policy_dependency_required: getCell(row, map, "policy_dependency_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      workflowRecord,
      [
        "chain_eligible",
        "graph_update_required",
        "bindings_update_required",
        "repair_mapping_required",
        "policy_dependency_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      workflowActive &&
      !governedAdditionStateBlocksAuthority(workflowRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...workflowRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.workflow_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "workflow_id", "active", WORKFLOW_REGISTRY_SHEET);
  assertSingleActiveRowByKey(rows, "workflow_key", "active", WORKFLOW_REGISTRY_SHEET);

  // Execution chains/graphs are support signals; they do not activate workflow authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

function firstPopulated(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

const WORDPRESS_MUTATION_PUBLISH_STATUSES = new Set([
  "draft",
  "publish",
  "pending",
  "private",
  "future"
]);

function normalizeSiteMigrationPayload(payload = {}) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const source = body.source && typeof body.source === "object" ? body.source : {};
  const destination =
    body.destination && typeof body.destination === "object" ? body.destination : {};
  const migration = body.migration && typeof body.migration === "object" ? body.migration : {};
  const readback = body.readback && typeof body.readback === "object" ? body.readback : {};

  return {
    source: {
      target_key: String(source.target_key || source.brand || "").trim(),
      brand: String(source.brand || source.target_key || "").trim(),
      domain: String(source.domain || source.brand_domain || "").trim().toLowerCase(),
      brand_domain: String(source.brand_domain || source.domain || "").trim().toLowerCase(),
      account_mode: String(source.account_mode || "shared_hosting").trim().toLowerCase(),
      site_type: String(source.site_type || "wordpress").trim().toLowerCase()
    },
    destination: {
      target_key: String(destination.target_key || destination.brand || "").trim(),
      brand: String(destination.brand || destination.target_key || "").trim(),
      domain: String(destination.domain || destination.brand_domain || "").trim().toLowerCase(),
      brand_domain: String(destination.brand_domain || destination.domain || "").trim().toLowerCase(),
      account_mode: String(destination.account_mode || "shared_hosting").trim().toLowerCase(),
      site_type: String(destination.site_type || "wordpress").trim().toLowerCase()
    },
    migration: {
      mode: String(migration.mode || "content_only").trim().toLowerCase(),
      transport: String(migration.transport || "auto").trim().toLowerCase(),
      apply: migration.apply === true,
      publish_status: String(migration.publish_status || "draft").trim().toLowerCase(),
      post_types: normalizeStringList(migration.post_types),
      tables: normalizeStringList(migration.tables),
      paths: normalizeStringList(migration.paths),
      plugin_keys: normalizeStringList(migration.plugin_keys),
      taxonomies: normalizeStringList(migration.taxonomies),
      search_replace:
        migration.search_replace &&
        typeof migration.search_replace === "object" &&
        !Array.isArray(migration.search_replace)
          ? {
              from: String(migration.search_replace.from || "").trim(),
              to: String(migration.search_replace.to || "").trim()
            }
          : { from: "", to: "" }
    },
    readback: {
      required: readback.required !== false,
      mode: String(readback.mode || "echo").trim().toLowerCase()
    }
  };
}

function validateSiteMigrationPayload(payload = {}) {
  const errors = [];
  const allowedModes = new Set([
    "full_site",
    "content_only",
    "db_tables_only",
    "files_only",
    "hybrid"
  ]);
  const allowedAccountModes = new Set([
    "shared_hosting",
    "shared_access",
    "vps"
  ]);
  const allowedTransports = new Set([
    "auto",
    "wordpress_connector",
    "ssh_wpcli",
    "hybrid_wordpress"
  ]);
  const allowedReadbackModes = new Set(["none", "echo", "location_followup"]);

  for (const side of ["source", "destination"]) {
    const entry = payload?.[side];
    if (!entry || typeof entry !== "object") {
      errors.push(`${side} is required.`);
      continue;
    }
    if (!String(entry.target_key || "").trim()) {
      errors.push(`${side}.target_key is required.`);
    }
    if (!allowedAccountModes.has(String(entry.account_mode || "").trim())) {
      errors.push(`${side}.account_mode is invalid.`);
    }
    if (String(entry.site_type || "").trim() !== "wordpress") {
      errors.push(`${side}.site_type must be wordpress.`);
    }
  }

  if (!allowedModes.has(String(payload?.migration?.mode || "").trim())) {
    errors.push("migration.mode is invalid.");
  }

  if (!allowedTransports.has(String(payload?.migration?.transport || "").trim())) {
    errors.push("migration.transport is invalid.");
  }

  if (
    payload?.migration &&
    Object.prototype.hasOwnProperty.call(payload.migration, "apply") &&
    typeof payload.migration.apply !== "boolean"
  ) {
    errors.push("migration.apply must be a boolean when provided.");
  }

  if (!WORDPRESS_MUTATION_PUBLISH_STATUSES.has(String(payload?.migration?.publish_status || "").trim())) {
    errors.push(
      `migration.publish_status must be one of: ${[...WORDPRESS_MUTATION_PUBLISH_STATUSES].join(", ")}.`
    );
  }

  if (
    !allowedReadbackModes.has(String(payload?.readback?.mode || "").trim())
  ) {
    errors.push("readback.mode is invalid.");
  }

  const searchReplace = payload?.migration?.search_replace || {};
  if ((searchReplace.from && !searchReplace.to) || (!searchReplace.from && searchReplace.to)) {
    errors.push("migration.search_replace.from and migration.search_replace.to must both be provided.");
  }

  if (
    String(payload?.migration?.mode || "").trim() === "db_tables_only" &&
    !(payload?.migration?.tables || []).length
  ) {
    errors.push("migration.tables must contain at least one table for db_tables_only mode.");
  }

  if (
    String(payload?.migration?.mode || "").trim() === "files_only" &&
    !(payload?.migration?.paths || []).length
  ) {
    errors.push("migration.paths must contain at least one path for files_only mode.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

async function readGovernedSheetRecords(sheetName, spreadsheetId = REGISTRY_SPREADSHEET_ID) {
  const trimmedSheetName = String(sheetName || "").trim();
  const trimmedSpreadsheetId = String(spreadsheetId || "").trim();
  if (!trimmedSheetName) {
    throw createHttpError("missing_sheet_name", "Sheet name is required.", 500);
  }
  if (!trimmedSpreadsheetId) {
    throw createHttpError("missing_spreadsheet_id", "Spreadsheet id is required.", 500);
  }

  await assertSheetExistsInSpreadsheet(trimmedSpreadsheetId, trimmedSheetName);
  const { sheets } = await getGoogleClientsForSpreadsheet(trimmedSpreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: trimmedSpreadsheetId,
    range: toValuesApiRange(trimmedSheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (!values.length) {
    return { header: [], rows: [], map: {} };
  }

  const header = (values[0] || []).map(v => String(v || "").trim());
  const map = headerMap(header, trimmedSheetName);
  const rows = values.slice(1).map(row => {
    const record = {};
    header.forEach((key, idx2) => {
      if (!key) return;
      record[key] = row[idx2] ?? "";
    });
    return record;
  });

  return { header, rows, map };
}

function normalizeLooseHostname(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function findRegistryRecordByIdentity(rows = [], identity = {}) {
  const targetKey = String(identity.target_key || "").trim().toLowerCase();
  const domain = normalizeLooseHostname(identity.domain || identity.brand_domain || "");
  const brand = String(identity.brand || identity.target_key || "").trim().toLowerCase();

  const targetCandidates = [
    "target_key",
    "brand_key",
    "site_key",
    "website_key",
    "brand_name",
    "company_name"
  ];
  const domainCandidates = [
    "brand_domain",
    "domain",
    "site_domain",
    "base_url",
    "brand.base_url",
    "website_url"
  ];

  const exactTarget = rows.find(row =>
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === targetKey) ||
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === brand)
  );
  if (exactTarget) return exactTarget;

  if (domain) {
    const exactDomain = rows.find(row =>
      domainCandidates.some(key =>
        normalizeLooseHostname(row?.[key] || "") === domain
      )
    );
    if (exactDomain) return exactDomain;
  }

  return null;
}

async function resolveBrandRegistryBinding(identity = {}) {
  const registry = await readGovernedSheetRecords(BRAND_REGISTRY_SHEET);
  const row = findRegistryRecordByIdentity(registry.rows, identity);

  if (!row) {
    throw createHttpError(
      "brand_registry_binding_not_found",
      `Brand Registry binding not found for ${identity.target_key || identity.domain || "unknown site"}.`,
      409
    );
  }

  return {
    row,
    target_key:
      firstPopulated(row, ["target_key", "brand_key", "site_key"]) ||
      String(identity.target_key || "").trim(),
    brand_name:
      firstPopulated(row, ["brand_name", "company_name", "target_key"]) ||
      String(identity.brand || identity.target_key || "").trim(),
    base_url: firstPopulated(row, ["brand.base_url", "base_url", "website_url", "domain", "brand_domain"]),
    brand_domain: normalizeLooseHostname(
      firstPopulated(row, ["brand_domain", "domain", "website_url", "base_url"])
    ),
    hosting_account_key:
      firstPopulated(row, [
        "hosting_account_key",
        "hosting_account_registry_ref",
        "account_key",
        "hosting_key"
      ]) || "",
    hostinger_api_target_key:
      firstPopulated(row, [
        "hostinger_api_target_key",
        "hosting_account_key",
        "hosting_account_registry_ref"
      ]) || "",
    row_data: row
  };
}

async function resolveHostingAccountBinding(identity = {}, brandBinding = {}) {
  const registry = await readGovernedSheetRecords(HOSTING_ACCOUNT_REGISTRY_SHEET);

  const requestedHostingAccountKey = String(
    firstPopulated(brandBinding.row_data || brandBinding, [
      "hosting_account_key",
      "hosting_account_registry_ref",
      "account_key",
      "hosting_key"
    ]) || ""
  ).trim();

  const normalizedTargetKey = String(
    brandBinding.target_key || identity.target_key || ""
  ).trim().toLowerCase();

  const normalizedDomain = normalizeLooseHostname(
    brandBinding.brand_domain || identity.domain || identity.brand_domain || ""
  );

  debugLog("HOSTING_BINDING_INPUT:", JSON.stringify({
    identity_target_key: identity?.target_key || "",
    identity_domain: identity?.domain || "",
    requestedHostingAccountKey,
    normalizedTargetKey,
    normalizedDomain
  }));

  function parseJsonArraySafe(value) {
    try {
      const parsed = JSON.parse(String(value || "").trim() || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function rowMatchesTargetFromResolverArray(row) {
    const values = parseJsonArraySafe(row?.resolver_target_keys_json).map(v =>
      String(v || "").trim().toLowerCase()
    );
    return !!normalizedTargetKey && values.includes(normalizedTargetKey);
  }

  function rowMatchesSiteFromBrandSites(row) {
    const entries = parseJsonArraySafe(row?.brand_sites_json);
    return entries.some(entry => {
      const site = normalizeLooseHostname(entry?.site || "");
      const brand = String(entry?.brand || "").trim().toLowerCase();
      return (
        (!!normalizedDomain && site === normalizedDomain) ||
        (!!normalizedTargetKey && brand === normalizedTargetKey)
      );
    });
  }

  let row = null;

  // 1) Direct lookup by hosting account key from Brand Registry
  if (requestedHostingAccountKey) {
    row =
      registry.rows.find(candidate =>
        [
          "hosting_account_key",
          "account_key",
          "hosting_key"
        ].some(key =>
          String(candidate?.[key] || "").trim() === requestedHostingAccountKey
        )
      ) || null;
  }

  // 2) Direct identity columns fallback
  if (!row) {
    row =
      findRegistryRecordByIdentity(registry.rows, {
        target_key: brandBinding.target_key || identity.target_key,
        domain: brandBinding.brand_domain || identity.domain,
        brand: brandBinding.brand_name || identity.brand || identity.target_key
      }) || null;
  }

  // 3) Account-centric registry fallback via resolver_target_keys_json
  if (!row) {
    row = registry.rows.find(candidate => rowMatchesTargetFromResolverArray(candidate)) || null;
  }

  // 4) Account-centric registry fallback via brand_sites_json
  if (!row) {
    row = registry.rows.find(candidate => rowMatchesSiteFromBrandSites(candidate)) || null;
  }

  debugLog("HOSTING_BINDING_MATCH:", JSON.stringify({
    matched_hosting_account_key: row?.hosting_account_key || "",
    matched_account_identifier: row?.account_identifier || "",
    matched_plan_label: row?.plan_label || ""
  }));

  if (!row) {
    throw createHttpError(
      "hosting_account_binding_not_found",
      `Hosting Account Registry binding not found for ${
        identity.target_key || identity.domain || requestedHostingAccountKey || "unknown site"
      }.`,
      409
    );
  }

  return {
    row,
    hosting_account_key: firstPopulated(row, ["hosting_account_key", "account_key", "hosting_key"]),
    api_key_reference: firstPopulated(row, ["api_key_reference", "credential_reference"]),
    ssh_available: boolFromSheet(firstPopulated(row, ["ssh_available", "ssh_enabled"])),
    wp_cli_available: boolFromSheet(firstPopulated(row, ["wp_cli_available", "wpcli_available"])),
    shared_access_enabled: boolFromSheet(firstPopulated(row, ["shared_access_enabled", "account_sharing_enabled"])),
    account_mode:
      String(firstPopulated(row, ["account_mode", "hosting_mode"]) || identity.account_mode || "").trim().toLowerCase(),
    row_data: row
  };
}

async function hostingerSshRuntimeRead({ input = {} }) {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(REGISTRY_SPREADSHEET_ID || "").trim(),
    range: HOSTING_ACCOUNT_REGISTRY_RANGE
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error("Hosting Account Registry is empty or missing data rows.");
    err.code = "hosting_account_registry_empty";
    err.status = 500;
    throw err;
  }

  const [header, ...rows] = values;
  const rowObjs = rows.map(row => rowToObject(header, row));
  const match = rowObjs.find(rowObj => matchesHostingerSshTarget(rowObj, input));

  if (!match) {
    return {
      ok: false,
      endpoint_key: "hostinger_ssh_runtime_read",
      resolution_status: "blocked",
      reason: "no_matching_hosting_account_registry_row",
      authoritative_source: HOSTING_ACCOUNT_REGISTRY_SHEET,
      input
    };
  }

  return {
    ok: true,
    endpoint_key: "hostinger_ssh_runtime_read",
    resolution_status: "validated",
    authoritative_source: HOSTING_ACCOUNT_REGISTRY_SHEET,
    hosting_account_key: match.hosting_account_key || "",
    hosting_provider: match.hosting_provider || "",
    account_identifier: match.account_identifier || "",
    resolver_target_keys_json: match.resolver_target_keys_json || "[]",
    brand_sites_json: match.brand_sites_json || "[]",
    ssh_available: asBool(match.ssh_available),
    wp_cli_available: asBool(match.wp_cli_available),
    shared_access_enabled: asBool(match.shared_access_enabled),
    account_mode: match.account_mode || "",
    ssh_host: match.ssh_host || "",
    ssh_port: match.ssh_port || "22",
    ssh_username: match.ssh_username || "",
    ssh_auth_mode: match.ssh_auth_mode || "",
    ssh_credential_reference: match.ssh_credential_reference || "",
    ssh_runtime_notes: match.ssh_runtime_notes || "",
    auth_validation_status: match.auth_validation_status || "",
    endpoint_binding_status: match.endpoint_binding_status || "",
    resolver_execution_ready: asBool(match.resolver_execution_ready),
    last_runtime_check_at: match.last_runtime_check_at || ""
  };
}

async function resolveWordpressRuntimeInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients();
  const rows = await loadSiteRuntimeInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    supported_cpts: normalizeStringList(String(row.supported_cpts || "").split(/[,\n|]/)),
    supported_taxonomies: normalizeStringList(String(row.supported_taxonomies || "").split(/[,\n|]/)),
    generated_endpoint_support: normalizeStringList(String(row.generated_endpoint_support || "").split(/[,\n|]/)),
    runtime_validation_status: String(row.runtime_validation_status || "pending").trim().toLowerCase(),
    last_runtime_validated_at: row.last_runtime_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

async function resolveWordpressSettingsInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients();
  const rows = await loadSiteSettingsInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    permalink_structure: row.permalink_structure || "",
    timezone_string: row.timezone_string || "",
    site_language: row.site_language || "",
    active_theme: row.active_theme || "",
    settings_validation_status: String(row.settings_validation_status || "pending").trim().toLowerCase(),
    last_settings_validated_at: row.last_settings_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

async function resolveWordpressPluginInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients();
  const rows = await loadPluginInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    active_plugins: normalizeStringList(String(row.active_plugins || "").split(/[,\n|]/)),
    plugin_versions_json: row.plugin_versions_json || "",
    plugin_owned_tables: normalizeStringList(String(row.plugin_owned_tables || "").split(/[,\n|]/)),
    plugin_owned_entities: normalizeStringList(String(row.plugin_owned_entities || "").split(/[,\n|]/)),
    plugin_validation_status: String(row.plugin_validation_status || "pending").trim().toLowerCase(),
    last_plugin_validated_at: row.last_plugin_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

async function resolveWordpressSiteAwarenessContext(input = {}) {
  const sourceBrand = await resolveBrandRegistryBinding(input.source || {});
  const destinationBrand = await resolveBrandRegistryBinding(input.destination || {});
  const sourceHosting = await resolveHostingAccountBinding(input.source || {}, sourceBrand);
  const destinationHosting = await resolveHostingAccountBinding(input.destination || {}, destinationBrand);

  return {
    source: {
      ...sourceBrand,
      hosting: sourceHosting
    },
    destination: {
      ...destinationBrand,
      hosting: destinationHosting
    },
    provider_family_continuity:
      !!sourceBrand.base_url && !!destinationBrand.base_url
  };
}

function listIntersection(a = [], b = []) {
  const right = new Set((b || []).map(v => String(v || "").trim().toLowerCase()));
  return (a || []).filter(v => right.has(String(v || "").trim().toLowerCase()));
}

function listDifference(a = [], b = []) {
  const right = new Set((b || []).map(v => String(v || "").trim().toLowerCase()));
  return (a || []).filter(v => !right.has(String(v || "").trim().toLowerCase()));
}

function classifyWordpressCapabilityState(context = {}) {
  const source = context.source || {};
  const destination = context.destination || {};

  const sourceRuntime = source.runtime || {};
  const destinationRuntime = destination.runtime || {};
  const sourcePlugins = source.plugins || {};
  const destinationPlugins = destination.plugins || {};
  const sourceSettings = source.settings || {};
  const destinationSettings = destination.settings || {};
  const requestedPluginKeys = context.requested_plugin_keys || [];

  const pluginIntersection = listIntersection(
    sourcePlugins.active_plugins,
    destinationPlugins.active_plugins
  );
  const missingDestinationPlugins = listDifference(
    requestedPluginKeys.length ? requestedPluginKeys : sourcePlugins.active_plugins,
    destinationPlugins.active_plugins
  );

  const runtimeShapeCompatible =
    sourceRuntime.inventory_found &&
    destinationRuntime.inventory_found &&
    listIntersection(sourceRuntime.supported_cpts, destinationRuntime.supported_cpts).length > 0;

  const settingsCompatible =
    !sourceSettings.permalink_structure ||
    !destinationSettings.permalink_structure ||
    sourceSettings.permalink_structure === destinationSettings.permalink_structure;

  const sshWpCliReady =
    source.hosting?.account_mode === "vps" &&
    destination.hosting?.account_mode === "vps" &&
    source.hosting?.ssh_available &&
    destination.hosting?.ssh_available &&
    source.hosting?.wp_cli_available &&
    destination.hosting?.wp_cli_available;

  const wordpressConnectorReady =
    source.hosting?.account_mode !== "vps" &&
    destination.hosting?.account_mode !== "vps" &&
    source.hosting?.shared_access_enabled &&
    destination.hosting?.shared_access_enabled;

  const generatedEndpointSupportProven =
    (destinationRuntime.generated_endpoint_support || []).length > 0 ||
    (destinationRuntime.supported_cpts || []).length > 0;

  const blockingReasons = [];
  const degradedReasons = [];

  if (!source.target_key || !destination.target_key) {
    blockingReasons.push("source_or_destination_identity_unresolved");
  }

  if (!sourceRuntime.inventory_found || !destinationRuntime.inventory_found) {
    degradedReasons.push("runtime_inventory_missing_or_stale");
  }

  if (requestedPluginKeys.length && missingDestinationPlugins.length) {
    blockingReasons.push("requested_plugin_parity_not_proven");
  }

  if (!generatedEndpointSupportProven) {
    degradedReasons.push("generated_endpoint_support_not_proven");
  }

  if (!settingsCompatible) {
    degradedReasons.push("settings_shape_mismatch");
  }

  return {
    runtime_shape_compatible: runtimeShapeCompatible,
    plugin_parity_ok: missingDestinationPlugins.length === 0,
    settings_compatible: settingsCompatible,
    generated_endpoint_support_proven: generatedEndpointSupportProven,
    wordpress_connector_ready: !!wordpressConnectorReady,
    ssh_wpcli_ready: !!sshWpCliReady,
    writeback_required: false,
    writeback_surfaces: [],
    plugin_intersection: pluginIntersection,
    missing_destination_plugins: missingDestinationPlugins,
    blocking_reasons: blockingReasons,
    degraded_reasons: degradedReasons
  };
}

function classifyWordpressMigrationImpact(context = {}, payload = {}) {
  const migration = payload.migration || {};
  const sourceRuntime = context?.source?.runtime || {};
  const destinationRuntime = context?.destination?.runtime || {};
  const sourcePlugins = context?.source?.plugins || {};
  const destinationPlugins = context?.destination?.plugins || {};

  const runtimeDeltaDetected =
    listDifference(sourceRuntime.supported_cpts, destinationRuntime.supported_cpts).length > 0 ||
    listDifference(sourceRuntime.supported_taxonomies, destinationRuntime.supported_taxonomies).length > 0;

  const settingsDeltaDetected =
    String(context?.source?.settings?.permalink_structure || "").trim() !==
    String(context?.destination?.settings?.permalink_structure || "").trim();

  const pluginDeltaDetected =
    listDifference(sourcePlugins.active_plugins, destinationPlugins.active_plugins).length > 0;

  return {
    mode: migration.mode,
    content_impact:
      migration.mode === "content_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    files_impact:
      migration.mode === "files_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    db_tables_impact:
      migration.mode === "db_tables_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    runtime_delta_detected: runtimeDeltaDetected,
    settings_delta_detected: settingsDeltaDetected,
    plugin_delta_detected: pluginDeltaDetected,
    verification_required: true
  };
}

function resolveMigrationTransport(payload = {}, wpContext = {}) {
  const sourceMode = String(payload?.source?.account_mode || "").trim();
  const destinationMode = String(payload?.destination?.account_mode || "").trim();
  const requested = String(payload?.migration?.transport || "auto").trim();
  const capability = wpContext.capability_state || {};

  if (requested && requested !== "auto") {
    return requested;
  }

  if (capability.ssh_wpcli_ready) {
    return "ssh_wpcli";
  }

  if (
    capability.wordpress_connector_ready &&
    capability.plugin_parity_ok &&
    (capability.runtime_shape_compatible || payload?.migration?.mode === "content_only")
  ) {
    return "wordpress_connector";
  }

  if (
    (sourceMode === "vps" && destinationMode !== "vps") ||
    (sourceMode !== "vps" && destinationMode === "vps")
  ) {
    return "hybrid_wordpress";
  }

  return "unsupported";
}

function buildWordpressMutationPlan(context = {}, payload = {}) {
  const migration = payload.migration || {};
  const impact = context.impact || {};
  const steps = [
    "brand_resolution",
    "hosting_account_resolution",
    "runtime_inventory_read",
    "settings_inventory_read",
    "plugin_inventory_read",
    "wordpress_capability_classification",
    "migration_impact_classification",
    "transport_resolution",
    "migration_planning",
    migration.apply ? "transport_execution_apply" : "transport_execution_plan_only",
    "runtime_reconciliation"
  ];

  if (impact.runtime_delta_detected || impact.settings_delta_detected || impact.plugin_delta_detected) {
    steps.push("registry_delta_writeback");
  }
  if (payload?.readback?.required !== false) {
    steps.push("readback_verification");
  }

  return {
    mode: migration.mode,
    transport: context.transport,
    apply: migration.apply === true,
    publish_status: String(migration.publish_status || "draft").trim().toLowerCase(),
    steps,
    draft_or_staged_required: migration.mode !== "full_site",
    verification_targets: {
      post_types: migration.post_types || [],
      taxonomies: migration.taxonomies || [],
      tables: migration.tables || [],
      paths: migration.paths || []
    }
  };
}

function buildRegistryDeltaWritebackPlan(context = {}, impact = {}) {
  const updates = [];

  if (impact.runtime_delta_detected) {
    updates.push({
      surface: SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "supported_cpts",
        "supported_taxonomies",
        "generated_endpoint_support",
        "runtime_validation_status",
        "last_runtime_validated_at"
      ]
    });
  }

  if (impact.settings_delta_detected) {
    updates.push({
      surface: SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "permalink_structure",
        "timezone_string",
        "site_language",
        "active_theme",
        "settings_validation_status",
        "last_settings_validated_at"
      ]
    });
  }

  if (impact.plugin_delta_detected) {
    updates.push({
      surface: PLUGIN_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "active_plugins",
        "plugin_validation_status",
        "last_plugin_validated_at"
      ]
    });
  }

  const writebackRequired = updates.length > 0;
  if (writebackRequired) {
    context.capability_state = context.capability_state || {};
    context.capability_state.writeback_required = true;
    context.capability_state.writeback_surfaces = updates.map(v => v.surface);
  }

  return {
    updates,
    readback_required: writebackRequired
  };
}

async function verifyRegistryDeltaReadback(result = {}) {
  if (!result?.writeback_plan?.readback_required) {
    return {
      ok: true,
      verification_mode: "not_required",
      verified_surfaces: []
    };
  }

  const verifiedSurfaces = [];
  for (const update of result.writeback_plan.updates || []) {
    await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, update.surface);
    verifiedSurfaces.push(update.surface);
  }

  return {
    ok: true,
    verification_mode: "registry_surface_presence",
    verified_surfaces: verifiedSurfaces
  };
}

function buildSiteMigrationArtifacts(context = {}, payload = {}, transport = "") {
  return {
    source_site: {
      target_key: context?.source?.target_key || payload?.source?.target_key || "",
      base_url: context?.source?.base_url || "",
      brand_domain: context?.source?.brand_domain || ""
    },
    destination_site: {
      target_key: context?.destination?.target_key || payload?.destination?.target_key || "",
      base_url: context?.destination?.base_url || "",
      brand_domain: context?.destination?.brand_domain || ""
    },
    transport,
    migration_mode: payload?.migration?.mode || ""
  };
}

function normalizeWordpressRestRoot(baseUrl = "") {
  const normalizedBase = normalizeProviderDomain(baseUrl);
  const url = new URL(normalizedBase);
  let pathname = url.pathname.replace(/\/+$/, "");

  if (!pathname || pathname === "/") {
    pathname = "/wp-json";
  } else if (!pathname.endsWith("/wp-json")) {
    pathname = `${pathname}/wp-json`;
  }

  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function buildWordpressRestUrl(baseUrl = "", restPath = "/", query = {}) {
  const root = new URL(normalizeWordpressRestRoot(baseUrl));
  const normalizedRestPath = `/${String(restPath || "").trim().replace(/^\/+/, "")}`;
  root.pathname = `${root.pathname.replace(/\/+$/, "")}${normalizedRestPath}`;
  root.search = "";

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    root.searchParams.set(String(key), String(value));
  }

  return root.toString();
}

function getWordpressSiteAuth(siteRef = {}) {
  const row = siteRef?.row_data && typeof siteRef.row_data === "object" ? siteRef.row_data : {};
  const username = String(row.username || "").trim();
  const applicationPassword = String(row.application_password || "").trim();
  if (!username || !applicationPassword) return null;
  return { username, applicationPassword };
}

function wordpressRichTextToString(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const raw = String(value.raw || "").trim();
  if (raw) return raw;
  return String(value.rendered || "").trim();
}

function mapWordpressSourceEntryToMutationPayload(sourceEntry = {}, publishStatus = "draft") {
  const payload = {
    status: publishStatus
  };

  const title = wordpressRichTextToString(sourceEntry.title);
  const content = wordpressRichTextToString(sourceEntry.content);
  const excerpt = wordpressRichTextToString(sourceEntry.excerpt);
  const slug = String(sourceEntry.slug || "").trim();

  if (title) payload.title = title;
  if (content) payload.content = content;
  if (excerpt) payload.excerpt = excerpt;
  if (slug) payload.slug = slug;

  return payload;
}

const WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES = Object.freeze({
  post: "posts",
  posts: "posts",
  page: "pages",
  pages: "pages",
  attachment: "media",
  media: "media"
});

function normalizeWordpressCollectionSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function getWordpressCollectionResolverCache(siteRef = {}) {
  if (!siteRef || typeof siteRef !== "object") return {};
  if (!siteRef.__resolved_collection_slugs || typeof siteRef.__resolved_collection_slugs !== "object") {
    siteRef.__resolved_collection_slugs = {};
  }
  return siteRef.__resolved_collection_slugs;
}

function extractWordpressCollectionSlugsFromRuntime(siteRef = {}) {
  const runtime = siteRef?.runtime && typeof siteRef.runtime === "object" ? siteRef.runtime : {};
  const candidates = [];
  const seen = new Set();
  const addCandidate = value => {
    const normalized = normalizeWordpressCollectionSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  for (const endpoint of normalizeStringList(runtime.generated_endpoint_support || [])) {
    const match = String(endpoint || "").match(/(?:^|\/)wp\/v2\/([^\/\{\}\s\?]+)/i);
    if (!match) continue;
    addCandidate(match[1]);
  }

  for (const type of normalizeStringList(runtime.supported_cpts || [])) {
    const normalizedType = normalizeWordpressCollectionSlug(type);
    if (!normalizedType) continue;
    addCandidate(WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedType] || normalizedType);
  }

  return candidates;
}

function pickWordpressCollectionSlugFromTypeRecord(typeRecord = {}, fallbackType = "") {
  if (!typeRecord || typeof typeRecord !== "object" || Array.isArray(typeRecord)) {
    return "";
  }

  const restNamespace = String(typeRecord.rest_namespace || "").trim().toLowerCase();
  if (restNamespace && restNamespace !== "wp/v2") {
    return "";
  }

  const restBase = normalizeWordpressCollectionSlug(typeRecord.rest_base || "");
  if (restBase) return restBase;

  const typeSlug = normalizeWordpressCollectionSlug(typeRecord.slug || fallbackType);
  if (!typeSlug) return "";
  return WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[typeSlug] || typeSlug;
}

async function resolveWordpressCollectionSlugFromTypesEndpoint({
  siteRef = {},
  postType = "",
  authRequired = false
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return "";

  const directTypeQueries = ["edit", "view"];
  for (const context of directTypeQueries) {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: `/wp/v2/types/${encodeURIComponent(normalizedType)}`,
      query: { context },
      authRequired
    });

    if (!response.ok) continue;
    const picked = pickWordpressCollectionSlugFromTypeRecord(response.data, normalizedType);
    if (picked) return picked;
  }

  const typeIndexQueries = ["edit", "view"];
  for (const context of typeIndexQueries) {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: "/wp/v2/types",
      query: { context },
      authRequired
    });

    if (!response.ok || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      continue;
    }

    const direct = response.data[normalizedType];
    const directPicked = pickWordpressCollectionSlugFromTypeRecord(direct, normalizedType);
    if (directPicked) return directPicked;

    for (const [typeKey, typeRecord] of Object.entries(response.data || {})) {
      const normalizedKey = normalizeWordpressCollectionSlug(typeKey);
      const normalizedRecordSlug = normalizeWordpressCollectionSlug(typeRecord?.slug || "");
      const normalizedRecordBase = normalizeWordpressCollectionSlug(typeRecord?.rest_base || "");
      const aliasFromKey = normalizeWordpressCollectionSlug(
        WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedKey] || ""
      );

      if (
        normalizedType === normalizedKey ||
        normalizedType === normalizedRecordSlug ||
        normalizedType === normalizedRecordBase ||
        normalizedType === aliasFromKey
      ) {
        const picked = pickWordpressCollectionSlugFromTypeRecord(typeRecord, normalizedType);
        if (picked) return picked;
      }
    }
  }

  return "";
}

async function probeWordpressCollectionSlug({
  siteRef = {},
  collectionSlug = "",
  authRequired = false
}) {
  const normalizedCollection = normalizeWordpressCollectionSlug(collectionSlug);
  if (!normalizedCollection) return false;

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(normalizedCollection)}`,
    query: {
      per_page: 1,
      page: 1
    },
    authRequired
  });

  if (response.ok) return true;
  if ([401, 403].includes(Number(response.status || 0))) return true;
  return false;
}

async function resolveWordpressCollectionSlug({
  siteRef = {},
  postType = "",
  authRequired = false
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return "";

  const cache = getWordpressCollectionResolverCache(siteRef);
  const cacheKey = `${normalizedType}|${authRequired ? "auth" : "anon"}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const candidateSlugs = [];
  const seen = new Set();
  const addCandidate = value => {
    const normalized = normalizeWordpressCollectionSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidateSlugs.push(normalized);
  };

  const resolvedFromTypes = await resolveWordpressCollectionSlugFromTypesEndpoint({
    siteRef,
    postType: normalizedType,
    authRequired
  }).catch(() => "");
  addCandidate(resolvedFromTypes);

  addCandidate(WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedType] || "");
  addCandidate(normalizedType);

  for (const runtimeCandidate of extractWordpressCollectionSlugsFromRuntime(siteRef)) {
    addCandidate(runtimeCandidate);
  }

  for (const candidate of candidateSlugs) {
    const supported = await probeWordpressCollectionSlug({
      siteRef,
      collectionSlug: candidate,
      authRequired
    }).catch(() => false);
    if (supported) {
      cache[cacheKey] = candidate;
      return candidate;
    }
  }

  const fallback = candidateSlugs[0] || normalizedType;
  cache[cacheKey] = fallback;
  return fallback;
}

async function executeWordpressRestJsonRequest({
  siteRef = {},
  method = "GET",
  restPath = "/",
  query = {},
  body,
  timeoutSeconds = 60,
  authRequired = false
}) {
  const siteUrl = String(siteRef?.base_url || "").trim();
  if (!siteUrl) {
    throw createHttpError(
      "wordpress_site_base_url_missing",
      "WordPress site base_url is required for connector execution.",
      409
    );
  }

  const auth = getWordpressSiteAuth(siteRef);
  if (authRequired && !auth) {
    throw createHttpError(
      "wordpress_auth_missing",
      "WordPress connector auth credentials are missing for this site.",
      409
    );
  }

  const url = buildWordpressRestUrl(siteUrl, restPath, query);
  const headers = {
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(
      `${auth.username}:${auth.applicationPassword}`,
      "utf8"
    ).toString("base64")}`;
  }

  const boundedTimeoutSeconds = Math.min(
    Number(timeoutSeconds || 60),
    MAX_TIMEOUT_SECONDS
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(boundedTimeoutSeconds) && boundedTimeoutSeconds > 0
      ? boundedTimeoutSeconds
      : 60) * 1000 + 5000
  );

  try {
    const response = await fetch(url, {
      method: String(method || "GET").toUpperCase(),
      headers,
      body:
        String(method || "GET").toUpperCase() === "GET" ||
        String(method || "GET").toUpperCase() === "DELETE"
          ? undefined
          : JSON.stringify(body ?? {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
    }

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[String(key || "").toLowerCase()] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      headers: responseHeaders,
      url
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      data: {
        ok: false,
        error: {
          code: aborted ? "wordpress_connector_timeout" : "wordpress_connector_transport_error",
          message: err?.message || String(err)
        }
      },
      headers: {},
      url
    };
  } finally {
    clearTimeout(timer);
  }
}

async function listWordpressEntriesByType({ siteRef = {}, postType = "", collectionSlug = "" }) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return [];
  const resolvedCollection =
    normalizeWordpressCollectionSlug(collectionSlug) ||
    await resolveWordpressCollectionSlug({
      siteRef,
      postType: normalizedType,
      authRequired: false
    });

  const collected = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: `/wp/v2/${encodeURIComponent(resolvedCollection)}`,
      query: {
        context: "edit",
        per_page: 50,
        page
      }
    });

    if (!response.ok) {
      throw createHttpError(
        "wordpress_source_read_failed",
        `Failed reading source entries for post type ${normalizedType} via collection ${resolvedCollection}.`,
        Number(response.status || 502),
        {
          post_type: normalizedType,
          post_type_collection: resolvedCollection,
          status_code: response.status,
          response: response.data
        }
      );
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    collected.push(...rows);

    const headerTotalPages = Number(
      response.headers["x-wp-totalpages"] || response.headers["x-wp-total-pages"] || 1
    );
    totalPages =
      Number.isFinite(headerTotalPages) && headerTotalPages > 0
        ? headerTotalPages
        : 1;
    page += 1;
  } while (page <= totalPages);

  return collected;
}

async function findWordpressDestinationEntryBySlug({
  siteRef = {},
  postType = "",
  slug = "",
  collectionSlug = ""
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedType || !normalizedSlug) return null;
  const resolvedCollection =
    normalizeWordpressCollectionSlug(collectionSlug) ||
    await resolveWordpressCollectionSlug({
      siteRef,
      postType: normalizedType,
      authRequired: true
    });

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(resolvedCollection)}`,
    query: {
      context: "edit",
      slug: normalizedSlug,
      per_page: 1
    },
    authRequired: true
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_destination_lookup_failed",
      `Failed destination lookup for post type ${normalizedType} via collection ${resolvedCollection}.`,
      Number(response.status || 502),
      {
        post_type: normalizedType,
        post_type_collection: resolvedCollection,
        slug: normalizedSlug,
        status_code: response.status,
        response: response.data
      }
    );
  }
  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.length ? rows[0] : null;
}

async function updateWordpressDestinationEntryById({
  destinationSiteRef = {},
  collectionSlug = "",
  postType = "",
  destinationId = null,
  body = {},
  authRequired = true
}) {
  const numericDestinationId = Number(destinationId);
  if (!Number.isFinite(numericDestinationId) || numericDestinationId < 1) {
    throw createHttpError(
      "wordpress_destination_id_invalid",
      "Destination id must be a positive integer.",
      400,
      { destination_id: destinationId }
    );
  }

  const normalizedPostType = normalizeWordpressCollectionSlug(postType);
  const normalizedCollectionSlug = normalizeWordpressCollectionSlug(collectionSlug);
  const resolvedCollectionSlug =
    normalizedCollectionSlug ||
    await resolveWordpressCollectionSlug({
      siteRef: destinationSiteRef,
      postType: normalizedPostType || normalizedCollectionSlug,
      authRequired
    });

  if (!resolvedCollectionSlug) {
    throw createHttpError(
      "wordpress_collection_resolution_failed",
      "Unable to resolve destination collection slug for deferred reference repair.",
      409,
      { post_type: normalizedPostType, collection_slug: normalizedCollectionSlug }
    );
  }

  const response = await executeWordpressRestJsonRequest({
    siteRef: destinationSiteRef,
    method: "POST",
    restPath: `/wp/v2/${encodeURIComponent(resolvedCollectionSlug)}/${numericDestinationId}`,
    body,
    authRequired
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_destination_update_failed",
      `Deferred destination update failed with status ${response.status}.`,
      Number(response.status || 502),
      {
        destination_id: numericDestinationId,
        collection_slug: resolvedCollectionSlug,
        response: response.data
      }
    );
  }

  return {
    id: Number(response?.data?.id) || numericDestinationId,
    status: String(response?.data?.status || "").trim()
  };
}

async function getWordpressItemById({
  siteRef = {},
  collectionSlug = "",
  id = null,
  authRequired = true
}) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId < 1) {
    throw createHttpError(
      "wordpress_item_id_invalid",
      "WordPress item id must be a positive integer.",
      400,
      { id }
    );
  }

  const normalizedCollectionSlug = normalizeWordpressCollectionSlug(collectionSlug);
  if (!normalizedCollectionSlug) {
    throw createHttpError(
      "wordpress_collection_resolution_failed",
      "Unable to resolve collection slug for WordPress item readback.",
      409,
      { collection_slug: collectionSlug }
    );
  }

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(normalizedCollectionSlug)}/${numericId}`,
    query: { context: "edit" },
    authRequired
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_item_readback_failed",
      `WordPress item readback failed with status ${response.status}.`,
      Number(response.status || 502),
      {
        id: numericId,
        collection_slug: normalizedCollectionSlug,
        response: response.data
      }
    );
  }

  return response.data && typeof response.data === "object" ? response.data : {};
}

function recordWordpressMutationWritebackEvidence(writebackPlan = {}, evidence = {}) {
  if (!writebackPlan || typeof writebackPlan !== "object") return;

  writebackPlan.readback_required = true;
  writebackPlan.mutation_execution = {
    ...evidence
  };
}

function classifyWordpressExecutionStage(payload = {}) {
  const apply = payload?.migration?.apply === true;
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  if (!apply) return "discovery";
  if (publishStatus === "draft") return "draft_publish";
  return "verification";
}

function buildGovernedResolutionRecord(args = {}) {
  return {
    search_domain: "endpoint_registry_adapter",
    normalized_query: String(args.normalized_query || "").trim(),
    candidate_count: Number.isFinite(Number(args.candidate_count))
      ? Number(args.candidate_count)
      : 0,
    selected_candidate_id: String(args.selected_candidate_id || "").trim(),
    selected_candidate_key: String(args.selected_candidate_key || "").trim(),
    selection_confidence: String(args.selection_confidence || "high").trim(),
    selection_basis: String(args.selection_basis || "").trim(),
    rejected_candidate_summary: Array.isArray(args.rejected_candidate_summary)
      ? args.rejected_candidate_summary
      : [],
    fallback_used: !!args.fallback_used,
    governance_gate_results:
      args.governance_gate_results &&
      typeof args.governance_gate_results === "object" &&
      !Array.isArray(args.governance_gate_results)
        ? args.governance_gate_results
        : {}
  };
}

function assertWordpressGovernedResolutionConfidence(record = {}, mutationIntended = false) {
  const confidence = String(record.selection_confidence || "").trim().toLowerCase();
  if (mutationIntended && confidence === "low") {
    const err = createHttpError(
      "low_confidence_resolution",
      "WordPress governed resolution blocked because selection confidence is low for a mutating execution.",
      409
    );
    err.governed_resolution_blocked = true;
    err.governed_resolution_block_reason = "low_confidence_resolution";
    err.governed_resolution_record = record;
    throw err;
  }
}

function evaluateWordpressPhaseAStartReadiness(args = {}) {
  const {
    payload = {},
    wpContext = {},
    sourceCollectionSlug = "",
    destinationCollectionSlug = "",
    generatedCandidate = null,
    materializedRegistryRowExists = false
  } = args;

  const phase = classifyWordpressExecutionStage(payload);
  const apply = payload?.migration?.apply === true;
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  const governance_gate_results = {
    target_key_valid: !!String(wpContext?.destination?.target_key || "").trim(),
    parent_action_key_valid: true,
    source_collection_resolved: !!String(sourceCollectionSlug || "").trim(),
    destination_collection_resolved: !!String(destinationCollectionSlug || "").trim(),
    draft_first_publish_mode: publishStatus === "draft",
    generated_candidate_present: !!generatedCandidate,
    materialized_registry_row_exists: !!materializedRegistryRowExists,
    writeback_plan_available: true
  };

  const readyForPhaseA =
    governance_gate_results.target_key_valid &&
    governance_gate_results.parent_action_key_valid &&
    governance_gate_results.source_collection_resolved &&
    governance_gate_results.destination_collection_resolved &&
    governance_gate_results.draft_first_publish_mode;

  return {
    phase_a_start_status: readyForPhaseA
      ? "ready_for_phase_a"
      : "blocked_by_governance_gate",
    execution_stage: phase,
    apply,
    publish_status: publishStatus,
    governance_gate_results
  };
}

function buildWordpressGeneratedCandidateEvidence(args = {}) {
  const slug = String(args.slug || "").trim();
  const kind = String(args.kind || "").trim();
  const method = String(args.method || "").trim().toUpperCase();
  const materializedRegistryRowExists = !!args.materializedRegistryRowExists;

  if (!slug || !kind || !method) return null;

  const actionMap = {
    GET_COLLECTION: "list",
    POST_COLLECTION: "create",
    GET_ITEM: "get",
    POST_ITEM: "update",
    DELETE_ITEM: "delete"
  };

  const action = String(args.action || "").trim() ||
    actionMap[String(args.actionClass || "").trim()] ||
    "";

  if (!action) return null;

  const endpointKey = `wordpress_${action}_${slug}`;
  const itemPath = `/wp/v2/${slug}/{id}`;
  const collectionPath = `/wp/v2/${slug}`;
  const generatedPath =
    action === "get" || action === "update" || action === "delete"
      ? itemPath
      : collectionPath;

  return {
    generated_candidate: true,
    generated_candidate_kind: kind,
    generated_candidate_slug: slug,
    generated_candidate_endpoint_key: endpointKey,
    generated_candidate_path: generatedPath,
    generated_candidate_basis: "template_path_rule",
    generated_candidate_confidence: "high",
    materialized_registry_row_exists: materializedRegistryRowExists
  };
}

const WORDPRESS_PHASE_A_ALLOWED_TYPES = new Set([
  "post",
  "page",
  "category",
  "tag"
]);

const WORDPRESS_PHASE_A_BLOCKED_TYPES = new Set([
  "attachment",
  "elementor_library",
  "wp_template",
  "wp_template_part",
  "wp_navigation",
  "popup",
  "global_widget",
  "acf-field-group",
  "acf-field",
  "wpforms",
  "fluentform",
  "contact-form-7",
  "seedprod",
  "mailpoet_page"
]);

function normalizeWordpressPhaseAType(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function classifyWordpressPhaseAScope(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);

  if (WORDPRESS_PHASE_A_ALLOWED_TYPES.has(normalized)) {
    return {
      normalized,
      phase_a_allowed: true,
      phase_a_blocked: false,
      scope_family: normalized === "category" || normalized === "tag"
        ? "taxonomy"
        : "content"
    };
  }

  if (WORDPRESS_PHASE_A_BLOCKED_TYPES.has(normalized)) {
    return {
      normalized,
      phase_a_allowed: false,
      phase_a_blocked: true,
      scope_family: "blocked_phase_b_or_later"
    };
  }

  return {
    normalized,
    phase_a_allowed: false,
    phase_a_blocked: true,
    scope_family: "unsupported_in_phase_a"
  };
}

function assertWordpressPhaseAScope(payload = {}) {
  const requested =
    Array.isArray(payload?.migration?.post_types) && payload.migration.post_types.length
      ? payload.migration.post_types
      : ["post"];

  const classifications = requested.map(classifyWordpressPhaseAScope);
  const blocked = classifications.filter(x => !x.phase_a_allowed);

  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  if (publishStatus !== "draft") {
    const err = createHttpError(
      "wordpress_phase_a_requires_draft_first",
      "WordPress Phase A only allows draft-first execution.",
      409
    );
    err.phase_a_scope_classifications = classifications;
    err.publish_status = publishStatus;
    throw err;
  }

  if (blocked.length) {
    const err = createHttpError(
      "wordpress_phase_a_scope_blocked",
      "WordPress Phase A is restricted to post/page/category/tag only.",
      409
    );
    err.phase_a_scope_classifications = classifications;
    err.blocked_types = blocked.map(x => x.normalized);
    throw err;
  }

  return classifications;
}

function buildWordpressPhaseAExecutionOrder(postTypes = []) {
  const priority = new Map([
    ["category", 10],
    ["tag", 20],
    ["page", 30],
    ["post", 40]
  ]);

  return [...postTypes]
    .map(x => normalizeWordpressPhaseAType(x))
    .sort((a, b) => (priority.get(a) || 999) - (priority.get(b) || 999));
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveWordpressPhaseABatchPolicy(payload = {}) {
  const migration = payload?.migration || {};

  const batch_size = toPositiveInt(
    migration.batch_size,
    20
  );

  const throttle_ms = Math.max(
    0,
    toPositiveInt(migration.throttle_ms, 0)
  );

  const max_items_per_type = Math.max(
    1,
    toPositiveInt(migration.max_items_per_type, 500)
  );

  const continue_on_item_error =
    migration.continue_on_item_error === undefined
      ? true
      : migration.continue_on_item_error === true;

  return {
    batch_size,
    throttle_ms,
    max_items_per_type,
    continue_on_item_error
  };
}

function chunkArray(items = [], size = 20) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function resolveWordpressPhaseARetryPolicy(payload = {}) {
  const migration = payload?.migration || {};

  return {
    retry_enabled:
      migration.retry_enabled === undefined ? true : migration.retry_enabled === true,
    max_attempts: Math.max(1, toPositiveInt(migration.retry_max_attempts, 3)),
    base_delay_ms: Math.max(0, toPositiveInt(migration.retry_base_delay_ms, 750)),
    retry_on_statuses: Array.isArray(migration.retry_on_statuses)
      ? migration.retry_on_statuses
          .map(x => Number(x))
          .filter(Number.isFinite)
      : [429, 500, 502, 503, 504],
    retry_on_codes: Array.isArray(migration.retry_on_codes)
      ? migration.retry_on_codes.map(x => String(x || "").trim()).filter(Boolean)
      : [
          "fetch_failed",
          "request_timeout",
          "timeout",
          "wordpress_source_read_failed",
          "wordpress_destination_lookup_failed",
          "wordpress_destination_write_failed",
          "wordpress_readback_failed"
        ]
  };
}

function resolveWordpressPhaseAResumePolicy(payload = {}) {
  const migration = payload?.migration || {};
  const checkpoint =
    migration.checkpoint && typeof migration.checkpoint === "object"
      ? migration.checkpoint
      : {};

  return {
    resume_enabled:
      migration.resume_enabled === undefined ? true : migration.resume_enabled === true,
    checkpoint: {
      post_type: String(checkpoint.post_type || "").trim(),
      batch_index: Math.max(1, toPositiveInt(checkpoint.batch_index, 1)),
      last_completed_slug: String(checkpoint.last_completed_slug || "").trim()
    }
  };
}

function shouldSkipWordpressPhaseAPostType(postType = "", resumePolicy = {}) {
  if (!resumePolicy?.resume_enabled) return false;

  const checkpointPostType = String(resumePolicy?.checkpoint?.post_type || "").trim();
  if (!checkpointPostType) return false;

  const ordered = buildWordpressPhaseAExecutionOrder([
    "category",
    "tag",
    "page",
    "post"
  ]);

  const currentIdx = ordered.indexOf(normalizeWordpressPhaseAType(postType));
  const checkpointIdx = ordered.indexOf(normalizeWordpressPhaseAType(checkpointPostType));

  if (currentIdx === -1 || checkpointIdx === -1) return false;
  return currentIdx < checkpointIdx;
}

function trimBatchForResume(batch = [], batchIndex = 1, postType = "", resumePolicy = {}) {
  if (!resumePolicy?.resume_enabled) return batch;

  const checkpoint = resumePolicy.checkpoint || {};
  const checkpointPostType = normalizeWordpressPhaseAType(checkpoint.post_type || "");
  const currentPostType = normalizeWordpressPhaseAType(postType);
  const checkpointBatchIndex = Math.max(1, toPositiveInt(checkpoint.batch_index, 1));
  const lastCompletedSlug = String(checkpoint.last_completed_slug || "").trim();

  if (!checkpointPostType || checkpointPostType !== currentPostType) {
    return batch;
  }

  if (batchIndex < checkpointBatchIndex) {
    return [];
  }

  if (batchIndex > checkpointBatchIndex) {
    return batch;
  }

  if (!lastCompletedSlug) {
    return batch;
  }

  const idx = batch.findIndex(
    item => String(item?.slug || "").trim() === lastCompletedSlug
  );

  if (idx === -1) {
    return batch;
  }

  return batch.slice(idx + 1);
}

function buildWordpressPhaseACheckpoint(args = {}) {
  return {
    post_type: String(args.post_type || "").trim(),
    batch_index: Math.max(1, toPositiveInt(args.batch_index, 1)),
    last_completed_slug: String(args.last_completed_slug || "").trim()
  };
}

function buildWordpressPhaseAPerTypeSummary(args = {}) {
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const postTypes = Array.isArray(args.postTypes) ? args.postTypes : [];

  return postTypes.map(postType => {
    const statusRows = destinationStatuses.filter(
      x => String(x?.post_type || "").trim() === String(postType || "").trim()
    );
    const failureRows = failures.filter(
      x => String(x?.post_type || "").trim() === String(postType || "").trim()
    );

    const created_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "created"
    ).length;
    const updated_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "updated"
    ).length;
    const discovered_existing_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "discovered_existing"
    ).length;
    const not_found_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "not_found"
    ).length;

    const verified_count = statusRows.filter(x => x?.readback_verified === true).length;
    const retry_used_count = statusRows.filter(x => x?.retry_used === true).length;
    const parent_repair_applied_count = statusRows.filter(
      x => x?.parent_repair_applied === true
    ).length;
    const taxonomy_repair_applied_count = statusRows.filter(
      x => x?.taxonomy_repair_applied === true
    ).length;
    const taxonomy_repair_blocked_count = statusRows.filter(
      x => x?.taxonomy_repair_blocked === true
    ).length;
    const featured_media_deferred_count = statusRows.filter(
      x => x?.featured_media_deferred === true
    ).length;

    const processed_count = statusRows.length;
    const failure_count = failureRows.length;

    let status_classification = "not_started";
    if (processed_count > 0 && failure_count === 0) {
      status_classification = "success";
    } else if (processed_count > 0 && failure_count > 0) {
      status_classification = "partial_success";
    } else if (processed_count === 0 && failure_count > 0) {
      status_classification = "failed";
    }

    return {
      post_type: String(postType || "").trim(),
      processed_count,
      created_count,
      updated_count,
      discovered_existing_count,
      not_found_count,
      verified_count,
      retry_used_count,
      parent_repair_applied_count,
      taxonomy_repair_applied_count,
      taxonomy_repair_blocked_count,
      featured_media_deferred_count,
      failure_count,
      status_classification
    };
  });
}

function classifyWordpressPhaseAOutcome(args = {}) {
  const perTypeSummary = Array.isArray(args.perTypeSummary) ? args.perTypeSummary : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const apply = args.apply === true;

  const processedCount = perTypeSummary.reduce(
    (sum, row) => sum + Number(row?.processed_count || 0),
    0
  );
  const failureCount = failures.length;
  const allSuccess =
    perTypeSummary.length > 0 &&
    perTypeSummary.every(x => String(x?.status_classification || "") === "success");

  let outcome = "no_op";
  let outcome_message = "No WordPress Phase A operations were executed.";

  if (!apply && processedCount > 0) {
    outcome = "discovery_only";
    outcome_message = "WordPress Phase A discovery completed.";
  } else if (apply && processedCount > 0 && failureCount === 0 && allSuccess) {
    outcome = "success";
    outcome_message = "WordPress Phase A migration completed successfully.";
  } else if (apply && processedCount > 0 && failureCount > 0) {
    outcome = "partial_success";
    outcome_message = "WordPress Phase A migration completed with partial success.";
  } else if (apply && processedCount === 0 && failureCount > 0) {
    outcome = "failed";
    outcome_message = "WordPress Phase A migration failed before any item completed.";
  }

  return {
    phase_a_outcome: outcome,
    phase_a_outcome_message: outcome_message,
    processed_count: processedCount,
    failure_count: failureCount
  };
}

function summarizeWordpressPhaseAFailures(failures = [], limit = 25) {
  if (!Array.isArray(failures) || !failures.length) return [];

  return failures.slice(0, limit).map(row => ({
    post_type: String(row?.post_type || "").trim(),
    slug: String(row?.slug || "").trim(),
    batch_index: Number(row?.batch_index || 0) || null,
    code: String(row?.code || row?.failure_reason || "").trim(),
    message: String(row?.message || "").trim()
  }));
}

function buildWordpressPhaseAOperatorArtifact(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome = args.phaseAOutcome || {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const postTypeResolution = Array.isArray(args.postTypeResolution)
    ? args.postTypeResolution
    : [];
  const batchTelemetry = Array.isArray(args.phaseABatchTelemetry)
    ? args.phaseABatchTelemetry
    : [];
  const retryTelemetry = Array.isArray(args.phaseARetryTelemetry)
    ? args.phaseARetryTelemetry
    : [];

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_a_operator_review",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(
      phaseAOutcome.phase_a_outcome_message || ""
    ).trim(),
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    processed_count: Number(phaseAOutcome.processed_count || 0),
    failure_count: Number(phaseAOutcome.failure_count || 0),
    source_limit_per_type: Number(args.batchPolicy?.max_items_per_type || 0),
    batch_size: Number(args.batchPolicy?.batch_size || 0),
    throttle_ms: Number(args.batchPolicy?.throttle_ms || 0),
    retry_enabled: !!args.retryPolicy?.retry_enabled,
    retry_max_attempts: Number(args.retryPolicy?.max_attempts || 0),
    checkpoint: args.phaseACheckpoint || {},
    per_type_summary: phaseAPerTypeSummary,
    post_type_resolution: postTypeResolution,
    failure_summary: summarizeWordpressPhaseAFailures(failures, 25),
    batch_overview: batchTelemetry.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      batch_index: Number(row?.batch_index || 0) || null,
      batch_size: Number(row?.batch_size || 0),
      resumed_batch_size: Number(row?.resumed_batch_size || 0),
      created_count: Number(row?.created_count || 0),
      updated_count: Number(row?.updated_count || 0),
      failed_count: Number(row?.failed_count || 0),
      skipped_by_resume: row?.skipped_by_resume === true
    })),
    retry_overview: retryTelemetry.slice(0, 100).map(row => ({
      post_type: String(row?.post_type || "").trim(),
      slug: String(row?.slug || "").trim(),
      retry_domain: String(row?.retry_domain || "").trim(),
      retry_used: row?.retry_used === true,
      final_attempt: Number(row?.final_attempt || 0)
    }))
  };
}

function evaluateWordpressPhaseAPromotionReadiness(args = {}) {
  const phaseAOutcome = args.phaseAOutcome || {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const deferredRepairFailures = Array.isArray(args.deferredRepairFailures)
    ? args.deferredRepairFailures
    : [];

  const unresolvedTaxonomyCount = destinationStatuses.filter(
    x => x?.taxonomy_repair_blocked === true
  ).length;

  const parentReadbackFailedCount = destinationStatuses.filter(
    x => x?.parent_readback_verified === false
  ).length;

  const taxonomyReadbackFailedCount = destinationStatuses.filter(
    x => x?.taxonomy_readback_verified === false
  ).length;

  const itemReadbackFailedCount = destinationStatuses.filter(
    x => x?.readback_verified === false
  ).length;

  const featuredMediaDeferredCount = destinationStatuses.filter(
    x => x?.featured_media_deferred === true
  ).length;

  const successfulTypes = phaseAPerTypeSummary.filter(
    row => String(row?.status_classification || "").trim() === "success"
  ).map(row => String(row?.post_type || "").trim());

  const blockingReasons = [];

  if (String(phaseAOutcome.phase_a_outcome || "").trim() === "failed") {
    blockingReasons.push("phase_a_failed");
  }

  if (deferredRepairFailures.length > 0) {
    blockingReasons.push("deferred_repair_failures_present");
  }

  if (unresolvedTaxonomyCount > 0) {
    blockingReasons.push("taxonomy_unresolved_present");
  }

  if (parentReadbackFailedCount > 0) {
    blockingReasons.push("parent_readback_failed");
  }

  if (taxonomyReadbackFailedCount > 0) {
    blockingReasons.push("taxonomy_readback_failed");
  }

  if (itemReadbackFailedCount > 0) {
    blockingReasons.push("item_readback_failed");
  }

  const promotionReady = blockingReasons.length === 0;

  return {
    selective_publish_ready: promotionReady,
    promotion_status: promotionReady
      ? "ready_for_selective_publish"
      : "blocked_for_selective_publish",
    blocking_reasons: blockingReasons,
    successful_post_types: successfulTypes,
    unresolved_taxonomy_count: unresolvedTaxonomyCount,
    parent_readback_failed_count: parentReadbackFailedCount,
    taxonomy_readback_failed_count: taxonomyReadbackFailedCount,
    item_readback_failed_count: itemReadbackFailedCount,
    featured_media_deferred_count: featuredMediaDeferredCount
  };
}

function isWordpressPublishablePhaseAType(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);
  return normalized === "post" || normalized === "page";
}

function buildWordpressSelectivePublishCandidates(args = {}) {
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  const candidates = [];
  const rejected = [];

  for (const row of destinationStatuses) {
    const postType = String(row?.post_type || "").trim();
    const operation = String(row?.operation || "").trim();
    const id = Number(row?.id);
    const slug = String(row?.slug || "").trim();

    const baseRecord = {
      post_type: postType,
      slug,
      destination_id: Number.isFinite(id) ? id : null,
      operation,
      status: String(row?.status || "").trim()
    };

    if (!isWordpressPublishablePhaseAType(postType)) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_publishable_phase_a_type"
      });
      continue;
    }

    if (!Number.isFinite(id)) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "missing_destination_id"
      });
      continue;
    }

    if (!(operation === "created" || operation === "updated")) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_mutated_item"
      });
      continue;
    }

    if (row?.readback_verified !== true) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "item_readback_not_verified"
      });
      continue;
    }

    if (row?.parent_readback_verified === false) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "parent_readback_not_verified"
      });
      continue;
    }

    if (row?.taxonomy_repair_blocked === true) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "taxonomy_repair_blocked"
      });
      continue;
    }

    if (row?.taxonomy_readback_verified === false) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "taxonomy_readback_not_verified"
      });
      continue;
    }

    candidates.push({
      ...baseRecord,
      ready_for_publish: promotionGuard.selective_publish_ready === true,
      retry_used: row?.retry_used === true,
      featured_media_deferred: row?.featured_media_deferred === true,
      parent_repair_applied: row?.parent_repair_applied === true,
      taxonomy_repair_applied: row?.taxonomy_repair_applied === true,
      candidate_reason: "phase_a_verified_mutation"
    });
  }

  return {
    candidate_count: Math.min(limit, candidates.length),
    rejected_count: rejected.length,
    candidates: candidates.slice(0, limit),
    rejected: rejected.slice(0, limit)
  };
}

function resolveWordpressSelectivePublishPlan(payload = {}) {
  const migration = payload?.migration || {};
  const selective =
    migration.selective_publish && typeof migration.selective_publish === "object"
      ? migration.selective_publish
      : {};

  return {
    enabled: selective.enabled === true,
    apply_limit: Math.max(1, toPositiveInt(selective.apply_limit, 25)),
    include_post_types: Array.isArray(selective.include_post_types)
      ? selective.include_post_types
          .map(x => normalizeWordpressPhaseAType(x))
          .filter(Boolean)
      : ["post", "page"],
    include_slugs: Array.isArray(selective.include_slugs)
      ? selective.include_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    exclude_slugs: Array.isArray(selective.exclude_slugs)
      ? selective.exclude_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : []
  };
}

function filterWordpressSelectivePublishCandidates(args = {}) {
  const candidates = Array.isArray(args.candidates) ? args.candidates : [];
  const plan = args.plan && typeof args.plan === "object" ? args.plan : {};

  const includePostTypes = new Set(
    Array.isArray(plan.include_post_types) ? plan.include_post_types : []
  );
  const includeSlugs = new Set(
    Array.isArray(plan.include_slugs) ? plan.include_slugs : []
  );
  const excludeSlugs = new Set(
    Array.isArray(plan.exclude_slugs) ? plan.exclude_slugs : []
  );

  let filtered = candidates.filter(row =>
    includePostTypes.size === 0
      ? true
      : includePostTypes.has(normalizeWordpressPhaseAType(row?.post_type || ""))
  );

  if (includeSlugs.size > 0) {
    filtered = filtered.filter(row => includeSlugs.has(String(row?.slug || "").trim()));
  }

  if (excludeSlugs.size > 0) {
    filtered = filtered.filter(row => !excludeSlugs.has(String(row?.slug || "").trim()));
  }

  return filtered.slice(0, Math.max(1, Number(plan.apply_limit || 25)));
}

async function publishWordpressDestinationEntryById(args = {}) {
  return await updateWordpressDestinationEntryById({
    destinationSiteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    destinationId: args.destinationId,
    body: { status: "publish" },
    authRequired: true
  });
}

async function verifyWordpressPublishedEntry(args = {}) {
  const readback = await getWordpressItemById({
    siteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    id: args.destinationId,
    authRequired: true
  });

  const actualStatus = String(readback?.status || "").trim().toLowerCase();
  return {
    verified: actualStatus === "publish",
    actual_status: actualStatus || "",
    readback
  };
}

async function executeWordpressSelectivePublish(args = {}) {
  const destinationSiteRef = args.destinationSiteRef;
  const promotionGuard = args.promotionGuard || {};
  const plan = args.plan || {};
  const candidateBundle = args.candidateBundle || {};

  const candidates = filterWordpressSelectivePublishCandidates({
    candidates: candidateBundle.candidates || [],
    plan
  });

  const results = [];
  const failures = [];

  if (plan.enabled !== true) {
    return {
      publish_attempted: false,
      publish_status: "disabled",
      selected_candidates: [],
      results,
      failures
    };
  }

  if (promotionGuard.selective_publish_ready !== true) {
    return {
      publish_attempted: false,
      publish_status: "blocked_by_promotion_guard",
      selected_candidates: candidates,
      results,
      failures: [
        {
          code: "selective_publish_blocked",
          message: "Selective publish blocked by phase_a_promotion_guard.",
          blocking_reasons: promotionGuard.blocking_reasons || []
        }
      ]
    };
  }

  for (const candidate of candidates) {
    const postType = normalizeWordpressPhaseAType(candidate?.post_type || "");
    const collectionSlug = normalizeWordpressCollectionSlug(postType);
    const destinationId = Number(candidate?.destination_id);

    try {
      await publishWordpressDestinationEntryById({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const verification = await verifyWordpressPublishedEntry({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const row = {
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        publish_requested: true,
        publish_verified: verification.verified,
        actual_status: verification.actual_status
      };

      results.push(row);

      if (!verification.verified) {
        failures.push({
          post_type: postType,
          slug: String(candidate?.slug || "").trim(),
          destination_id: destinationId,
          code: "selective_publish_readback_failed",
          message: "Selective publish readback verification failed.",
          actual_status: verification.actual_status
        });
      }
    } catch (err) {
      failures.push({
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        code: err?.code || "selective_publish_failed",
        message: err?.message || "Selective publish failed."
      });
    }
  }

  return {
    publish_attempted: true,
    publish_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    selected_candidates: candidates,
    results,
    failures
  };
}

function buildWordpressSelectivePublishRollbackPlan(args = {}) {
  const execution =
    args.execution && typeof args.execution === "object" ? args.execution : {};
  const results = Array.isArray(execution.results) ? execution.results : [];
  const failures = Array.isArray(execution.failures) ? execution.failures : [];

  const rollbackCandidates = results
    .filter(row => row?.publish_requested === true)
    .map(row => ({
      post_type: String(row?.post_type || "").trim(),
      slug: String(row?.slug || "").trim(),
      destination_id: Number.isFinite(Number(row?.destination_id))
        ? Number(row.destination_id)
        : null,
      current_status: String(row?.actual_status || "").trim(),
      rollback_target_status: "draft",
      rollback_reason:
        row?.publish_verified === true
          ? "published_in_phase_a_selective_publish"
          : "publish_verification_uncertain"
    }))
    .filter(row => Number.isFinite(row.destination_id));

  const rollbackBlocked =
    String(execution.publish_status || "").trim() === "blocked_by_promotion_guard";

  const rollbackReady = !rollbackBlocked && rollbackCandidates.length > 0;

  const blockingReasons = [];
  if (rollbackBlocked) {
    blockingReasons.push("publish_blocked_by_promotion_guard");
  }
  if (rollbackCandidates.length === 0) {
    blockingReasons.push("no_published_candidates_to_rollback");
  }

  return {
    rollback_ready: rollbackReady,
    rollback_status: rollbackReady
      ? "rollback_available"
      : "rollback_not_available",
    candidate_count: rollbackCandidates.length,
    blocking_reasons: blockingReasons,
    failures_present: failures.length > 0,
    rollback_candidates: rollbackCandidates
  };
}

function resolveWordpressSelectivePublishRollbackPlan(payload = {}) {
  const migration = payload?.migration || {};
  const rollback =
    migration.selective_publish_rollback &&
    typeof migration.selective_publish_rollback === "object"
      ? migration.selective_publish_rollback
      : {};

  return {
    enabled: rollback.enabled === true,
    apply_limit: Math.max(1, toPositiveInt(rollback.apply_limit, 25)),
    include_post_types: Array.isArray(rollback.include_post_types)
      ? rollback.include_post_types
          .map(x => normalizeWordpressPhaseAType(x))
          .filter(Boolean)
      : ["post", "page"],
    include_slugs: Array.isArray(rollback.include_slugs)
      ? rollback.include_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    exclude_slugs: Array.isArray(rollback.exclude_slugs)
      ? rollback.exclude_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : []
  };
}

function filterWordpressSelectivePublishRollbackCandidates(args = {}) {
  const rollbackPlan =
    args.rollbackPlan && typeof args.rollbackPlan === "object"
      ? args.rollbackPlan
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  let candidates = Array.isArray(executionPlan.rollback_candidates)
    ? executionPlan.rollback_candidates
    : [];

  const includePostTypes = new Set(
    Array.isArray(rollbackPlan.include_post_types)
      ? rollbackPlan.include_post_types
      : []
  );
  const includeSlugs = new Set(
    Array.isArray(rollbackPlan.include_slugs) ? rollbackPlan.include_slugs : []
  );
  const excludeSlugs = new Set(
    Array.isArray(rollbackPlan.exclude_slugs) ? rollbackPlan.exclude_slugs : []
  );

  candidates = candidates.filter(row =>
    includePostTypes.size === 0
      ? true
      : includePostTypes.has(normalizeWordpressPhaseAType(row?.post_type || ""))
  );

  if (includeSlugs.size > 0) {
    candidates = candidates.filter(row => includeSlugs.has(String(row?.slug || "").trim()));
  }

  if (excludeSlugs.size > 0) {
    candidates = candidates.filter(row => !excludeSlugs.has(String(row?.slug || "").trim()));
  }

  return candidates.slice(0, Math.max(1, Number(rollbackPlan.apply_limit || 25)));
}

async function rollbackWordpressPublishedEntryById(args = {}) {
  return await updateWordpressDestinationEntryById({
    destinationSiteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    destinationId: args.destinationId,
    body: { status: "draft" },
    authRequired: true
  });
}

async function verifyWordpressRolledBackEntry(args = {}) {
  const readback = await getWordpressItemById({
    siteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    id: args.destinationId,
    authRequired: true
  });

  const actualStatus = String(readback?.status || "").trim().toLowerCase();
  return {
    verified: actualStatus === "draft",
    actual_status: actualStatus || "",
    readback
  };
}

async function executeWordpressSelectivePublishRollback(args = {}) {
  const destinationSiteRef = args.destinationSiteRef;
  const rollbackPlan = args.rollbackPlan || {};
  const executionPlan = args.executionPlan || {};

  const selectedCandidates = filterWordpressSelectivePublishRollbackCandidates({
    rollbackPlan,
    executionPlan
  });

  const results = [];
  const failures = [];

  if (rollbackPlan.enabled !== true) {
    return {
      rollback_attempted: false,
      rollback_execution_status: "disabled",
      selected_candidates: [],
      results,
      failures
    };
  }

  if (executionPlan.rollback_ready !== true) {
    return {
      rollback_attempted: false,
      rollback_execution_status: "blocked_by_rollback_plan",
      selected_candidates: selectedCandidates,
      results,
      failures: [
        {
          code: "selective_publish_rollback_blocked",
          message: "Selective publish rollback blocked by rollback plan.",
          blocking_reasons: executionPlan.blocking_reasons || []
        }
      ]
    };
  }

  for (const candidate of selectedCandidates) {
    const postType = normalizeWordpressPhaseAType(candidate?.post_type || "");
    const collectionSlug = normalizeWordpressCollectionSlug(postType);
    const destinationId = Number(candidate?.destination_id);

    try {
      await rollbackWordpressPublishedEntryById({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const verification = await verifyWordpressRolledBackEntry({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const row = {
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        rollback_requested: true,
        rollback_verified: verification.verified,
        actual_status: verification.actual_status
      };

      results.push(row);

      if (!verification.verified) {
        failures.push({
          post_type: postType,
          slug: String(candidate?.slug || "").trim(),
          destination_id: destinationId,
          code: "selective_publish_rollback_readback_failed",
          message: "Selective publish rollback readback verification failed.",
          actual_status: verification.actual_status
        });
      }
    } catch (err) {
      failures.push({
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        code: err?.code || "selective_publish_rollback_failed",
        message: err?.message || "Selective publish rollback failed."
      });
    }
  }

  return {
    rollback_attempted: true,
    rollback_execution_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    selected_candidates: selectedCandidates,
    results,
    failures
  };
}

function nowIsoSafe() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

function buildWordpressPhaseACutoverJournal(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const checkpoint =
    args.phaseACheckpoint && typeof args.phaseACheckpoint === "object"
      ? args.phaseACheckpoint
      : {};
  const perTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];

  const publishResults = Array.isArray(selectivePublishExecution.results)
    ? selectivePublishExecution.results
    : [];
  const rollbackResults = Array.isArray(selectivePublishRollbackExecution.results)
    ? selectivePublishRollbackExecution.results
    : [];

  const migration = payload?.migration || {};

  const timeline = [
    {
      step: "phase_a_execution",
      status: String(phaseAOutcome.phase_a_outcome || "").trim() || "unknown",
      recorded_at: nowIsoSafe(),
      detail: String(phaseAOutcome.phase_a_outcome_message || "").trim()
    },
    {
      step: "promotion_guard",
      status: String(promotionGuard.promotion_status || "").trim() || "unknown",
      recorded_at: nowIsoSafe(),
      detail: Array.isArray(promotionGuard.blocking_reasons)
        ? promotionGuard.blocking_reasons.join(", ")
        : ""
    },
    {
      step: "selective_publish",
      status: String(selectivePublishExecution.publish_status || "").trim() || "not_run",
      recorded_at: nowIsoSafe(),
      detail: `published=${publishResults.filter(x => x?.publish_verified === true).length}`
    },
    {
      step: "selective_publish_rollback",
      status:
        String(selectivePublishRollbackExecution.rollback_execution_status || "").trim() ||
        "not_run",
      recorded_at: nowIsoSafe(),
      detail: `rolled_back=${rollbackResults.filter(x => x?.rollback_verified === true).length}`
    }
  ];

  return {
    artifact_type: "wordpress_phase_a_cutover_journal",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(phaseAOutcome.phase_a_outcome_message || "").trim(),
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    selective_publish_ready: promotionGuard.selective_publish_ready === true,
    checkpoint,
    per_type_summary: perTypeSummary,
    published_count: publishResults.filter(x => x?.publish_verified === true).length,
    publish_failed_count: Array.isArray(selectivePublishExecution.failures)
      ? selectivePublishExecution.failures.length
      : 0,
    rollback_count: rollbackResults.filter(x => x?.rollback_verified === true).length,
    rollback_failed_count: Array.isArray(selectivePublishRollbackExecution.failures)
      ? selectivePublishRollbackExecution.failures.length
      : 0,
    timeline
  };
}

function classifyWordpressPhaseAFinalCutoverRecommendation(args = {}) {
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const perTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];

  const publishFailures = Array.isArray(selectivePublishExecution.failures)
    ? selectivePublishExecution.failures.length
    : 0;
  const rollbackFailures = Array.isArray(selectivePublishRollbackExecution.failures)
    ? selectivePublishRollbackExecution.failures.length
    : 0;

  const successfulTypes = perTypeSummary
    .filter(row => String(row?.status_classification || "").trim() === "success")
    .map(row => String(row?.post_type || "").trim());

  let recommendation = "hold";
  let recommendation_reason =
    "WordPress Phase A requires further review before cutover.";

  if (String(phaseAOutcome.phase_a_outcome || "").trim() === "failed") {
    recommendation = "do_not_cutover";
    recommendation_reason = "Phase A failed.";
  } else if (promotionGuard.selective_publish_ready !== true) {
    recommendation = "fix_before_cutover";
    recommendation_reason =
      "Promotion guard blocked selective publish readiness.";
  } else if (
    String(selectivePublishExecution.publish_status || "").trim() === "completed" &&
    publishFailures === 0 &&
    rollbackFailures === 0
  ) {
    recommendation = "ready_for_controlled_cutover";
    recommendation_reason =
      "Phase A passed, promotion guard is clear, and selective publish completed cleanly.";
  } else if (
    String(phaseAOutcome.phase_a_outcome || "").trim() === "success" &&
    promotionGuard.selective_publish_ready === true
  ) {
    recommendation = "ready_for_reviewed_cutover";
    recommendation_reason =
      "Phase A succeeded and promotion guard is clear, but publish/rollback history still needs operator review.";
  }

  return {
    final_cutover_recommendation: recommendation,
    final_cutover_reason: recommendation_reason,
    successful_post_types: successfulTypes,
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    publish_status: String(selectivePublishExecution.publish_status || "").trim(),
    rollback_status: String(
      selectivePublishRollbackExecution.rollback_execution_status || ""
    ).trim(),
    publish_failure_count: publishFailures,
    rollback_failure_count: rollbackFailures
  };
}

function buildWordpressPhaseAFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const finalCutoverRecommendation =
    args.finalCutoverRecommendation &&
    typeof args.finalCutoverRecommendation === "object"
      ? args.finalCutoverRecommendation
      : {};
  const operatorArtifact =
    args.operatorArtifact && typeof args.operatorArtifact === "object"
      ? args.operatorArtifact
      : {};
  const cutoverJournal =
    args.cutoverJournal && typeof args.cutoverJournal === "object"
      ? args.cutoverJournal
      : {};
  const selectivePublishCandidates =
    args.selectivePublishCandidates &&
    typeof args.selectivePublishCandidates === "object"
      ? args.selectivePublishCandidates
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackPlan =
    args.selectivePublishRollbackPlan &&
    typeof args.selectivePublishRollbackPlan === "object"
      ? args.selectivePublishRollbackPlan
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const checkpoint =
    args.phaseACheckpoint && typeof args.phaseACheckpoint === "object"
      ? args.phaseACheckpoint
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_a_final_operator_handoff",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(phaseAOutcome.phase_a_outcome_message || "").trim(),
    final_cutover_recommendation: String(
      finalCutoverRecommendation.final_cutover_recommendation || ""
    ).trim(),
    final_cutover_reason: String(
      finalCutoverRecommendation.final_cutover_reason || ""
    ).trim(),
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    selective_publish_ready: promotionGuard.selective_publish_ready === true,
    checkpoint,
    per_type_summary: phaseAPerTypeSummary,
    operator_review_artifact: operatorArtifact,
    cutover_journal: cutoverJournal,
    selective_publish_candidate_count: Number(
      selectivePublishCandidates.candidate_count || 0
    ),
    selective_publish_rejected_count: Number(
      selectivePublishCandidates.rejected_count || 0
    ),
    selective_publish_status: String(
      selectivePublishExecution.publish_status || ""
    ).trim(),
    selective_publish_published_count: Array.isArray(selectivePublishExecution.results)
      ? selectivePublishExecution.results.filter(x => x?.publish_verified === true).length
      : 0,
    selective_publish_failure_count: Array.isArray(selectivePublishExecution.failures)
      ? selectivePublishExecution.failures.length
      : 0,
    rollback_ready: selectivePublishRollbackPlan.rollback_ready === true,
    rollback_status: String(selectivePublishRollbackPlan.rollback_status || "").trim(),
    rollback_execution_status: String(
      selectivePublishRollbackExecution.rollback_execution_status || ""
    ).trim(),
    rollback_applied_count: Array.isArray(selectivePublishRollbackExecution.results)
      ? selectivePublishRollbackExecution.results.filter(x => x?.rollback_verified === true).length
      : 0,
    rollback_failure_count: Array.isArray(selectivePublishRollbackExecution.failures)
      ? selectivePublishRollbackExecution.failures.length
      : 0,
    operator_actions: [
      String(finalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
      "ready_for_controlled_cutover"
        ? "proceed_with_controlled_cutover"
        : "hold_cutover",
      promotionGuard.selective_publish_ready === true
        ? "review_selective_publish_results"
        : "review_blocking_reasons",
      selectivePublishRollbackPlan.rollback_ready === true
        ? "retain_rollback_plan"
        : "rollback_plan_not_available"
    ]
  };
}

const WORDPRESS_PHASE_B_BUILDER_TYPES = new Set([
  "elementor_library",
  "wp_template",
  "wp_template_part",
  "wp_navigation",
  "popup",
  "global_widget",
  "reusable_block",
  "wp_block"
]);

function normalizeWordpressBuilderType(value = "") {
  return normalizeWordpressPhaseAType(value);
}

function isWordpressPhaseBBuilderType(value = "") {
  return WORDPRESS_PHASE_B_BUILDER_TYPES.has(
    normalizeWordpressBuilderType(value)
  );
}

function resolveWordpressPhaseBPlan(payload = {}) {
  const migration = payload?.migration || {};
  const builder = migration.builder_assets && typeof migration.builder_assets === "object"
    ? migration.builder_assets
    : {};

  const requestedTypes = Array.isArray(builder.post_types)
    ? builder.post_types.map(x => normalizeWordpressBuilderType(x)).filter(Boolean)
    : ["elementor_library", "wp_template", "wp_template_part", "wp_navigation"];

  const normalizedTypes = requestedTypes.filter(isWordpressPhaseBBuilderType);

  return {
    enabled: builder.enabled === true,
    audit_only: builder.audit_only === undefined ? true : builder.audit_only === true,
    apply: builder.apply === true,
    post_types: normalizedTypes,
    max_items_per_type: Math.max(1, toPositiveInt(builder.max_items_per_type, 250)),
    dependency_scan_enabled:
      builder.dependency_scan_enabled === undefined
        ? true
        : builder.dependency_scan_enabled === true,
    include_inactive:
      builder.include_inactive === true
  };
}

function assertWordpressPhaseBPlan(plan = {}) {
  if (plan.enabled !== true) {
    return {
      phase_b_status: "disabled",
      phase_b_ready: false,
      blocking_reasons: ["phase_b_not_enabled"]
    };
  }

  const blockingReasons = [];

  if (plan.apply === true && plan.audit_only === true) {
    blockingReasons.push("phase_b_apply_conflicts_with_audit_only");
  }

  if (!Array.isArray(plan.post_types) || plan.post_types.length === 0) {
    blockingReasons.push("phase_b_no_supported_builder_types");
  }

  return {
    phase_b_status:
      blockingReasons.length === 0 ? "audit_ready" : "blocked",
    phase_b_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function inferWordpressBuilderDependencies(item = {}) {
  const raw = JSON.stringify(item || {});

  const signals = {
    uses_elementor_data:
      raw.includes("_elementor_data") || raw.includes("elementor"),
    uses_template_conditions:
      raw.includes("display_conditions") || raw.includes("location"),
    uses_popup_rules:
      raw.includes("popup") || raw.includes("triggers") || raw.includes("conditions"),
    uses_navigation_refs:
      raw.includes("wp_navigation") || raw.includes("navigation"),
    uses_theme_json_refs:
      raw.includes("theme.json") || raw.includes("template_part"),
    uses_global_widget_refs:
      raw.includes("global_widget") || raw.includes("widgetType"),
    uses_shortcode_like_refs:
      raw.includes("[") && raw.includes("]")
  };

  return {
    dependency_flags: signals,
    dependency_count: Object.values(signals).filter(v => v === true).length
  };
}

function buildWordpressBuilderAuditRow(args = {}) {
  const item = args.item || {};
  const postType = normalizeWordpressBuilderType(args.postType);
  const deps = inferWordpressBuilderDependencies(item);
  const refs = extractWordpressBuilderCrossReferences(item);

  return {
    post_type: postType,
    source_id: Number.isFinite(Number(item?.id)) ? Number(item.id) : null,
    slug: String(item?.slug || "").trim(),
    title: String(
      item?.title?.rendered ||
      item?.title ||
      item?.name ||
      item?.slug ||
      ""
    ).trim(),
    status: String(item?.status || "").trim(),
    dependency_count: deps.dependency_count,
    dependency_flags: deps.dependency_flags,
    cross_references: refs,
    cross_reference_counts: {
      template_ids: refs.template_ids.length,
      widget_ids: refs.widget_ids.length,
      navigation_ids: refs.navigation_ids.length,
      popup_ids: refs.popup_ids.length,
      shortcode_tags: refs.shortcode_tags.length
    },
    audit_classification:
      deps.dependency_count > 0 ? "dependency_review_required" : "low_dependency_asset",
    migration_candidate: true
  };
}

function buildWordpressBuilderPhaseBGate(args = {}) {
  const phaseARecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object"
      ? args.phaseBPlan
      : {};
  const phaseBPlanStatus =
    args.phaseBPlanStatus && typeof args.phaseBPlanStatus === "object"
      ? args.phaseBPlanStatus
      : {};

  const blockingReasons = [...(phaseBPlanStatus.blocking_reasons || [])];

  if (
    String(phaseARecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_b");
  }

  return {
    phase_b_gate_status:
      blockingReasons.length === 0 ? "ready_for_builder_audit" : "blocked",
    phase_b_gate_ready: blockingReasons.length === 0,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    blocking_reasons: blockingReasons
  };
}

async function runWordpressBuilderAssetsInventoryAudit(args = {}) {
  const {
    payload = {},
    wpContext = {},
    phaseBPlan = {},
    phaseBGate = {}
  } = args;

  if (phaseBGate.phase_b_gate_ready !== true) {
    return {
      phase_b_inventory_status: "blocked",
      audit_rows: [],
      inventory_counts: [],
      failures: [
        {
          code: "phase_b_builder_audit_blocked",
          message: "Phase B builder audit blocked by phase_b_gate.",
          blocking_reasons: phaseBGate.blocking_reasons || []
        }
      ]
    };
  }

  const auditRows = [];
  const inventoryCounts = [];
  const failures = [];

  for (const postType of phaseBPlan.post_types || []) {
    try {
      const itemsRaw = await listWordpressEntriesByType({
        siteRef: wpContext.source,
        postType,
        authRequired: false
      });

      const items = itemsRaw.slice(0, phaseBPlan.max_items_per_type);
      const keptItems = phaseBPlan.include_inactive
        ? items
        : items.filter(item => {
            const status = String(item?.status || "").trim().toLowerCase();
            return !status || status === "publish" || status === "draft";
          });

      for (const item of keptItems) {
        auditRows.push(
          buildWordpressBuilderAuditRow({
            postType,
            item,
            payload
          })
        );
      }

      inventoryCounts.push({
        post_type: postType,
        discovered_count: itemsRaw.length,
        retained_count: keptItems.length,
        audit_only: phaseBPlan.audit_only === true
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        code: err?.code || "wordpress_builder_inventory_failed",
        message: err?.message || "WordPress builder inventory audit failed."
      });
    }
  }

  return {
    phase_b_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    audit_rows: auditRows,
    inventory_counts: inventoryCounts,
    failures
  };
}

function normalizeWordpressBuilderDependencyFlags(flags = {}) {
  const safeFlags = flags && typeof flags === "object" && !Array.isArray(flags)
    ? flags
    : {};

  return {
    uses_elementor_data: safeFlags.uses_elementor_data === true,
    uses_template_conditions: safeFlags.uses_template_conditions === true,
    uses_popup_rules: safeFlags.uses_popup_rules === true,
    uses_navigation_refs: safeFlags.uses_navigation_refs === true,
    uses_theme_json_refs: safeFlags.uses_theme_json_refs === true,
    uses_global_widget_refs: safeFlags.uses_global_widget_refs === true,
    uses_shortcode_like_refs: safeFlags.uses_shortcode_like_refs === true
  };
}

function classifyWordpressBuilderDependencyRisk(row = {}) {
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const flags = normalizeWordpressBuilderDependencyFlags(row?.dependency_flags || {});

  let riskScore = 0;
  const reasons = [];

  if (flags.uses_elementor_data) {
    riskScore += 3;
    reasons.push("elementor_data_present");
  }
  if (flags.uses_template_conditions) {
    riskScore += 2;
    reasons.push("template_conditions_present");
  }
  if (flags.uses_popup_rules) {
    riskScore += 3;
    reasons.push("popup_rules_present");
  }
  if (flags.uses_navigation_refs) {
    riskScore += 2;
    reasons.push("navigation_refs_present");
  }
  if (flags.uses_theme_json_refs) {
    riskScore += 2;
    reasons.push("theme_json_refs_present");
  }
  if (flags.uses_global_widget_refs) {
    riskScore += 2;
    reasons.push("global_widget_refs_present");
  }
  if (flags.uses_shortcode_like_refs) {
    riskScore += 1;
    reasons.push("shortcode_like_refs_present");
  }

  if (postType === "popup") {
    riskScore += 2;
    reasons.push("popup_post_type");
  }
  if (postType === "wp_template" || postType === "wp_template_part") {
    riskScore += 2;
    reasons.push("theme_template_post_type");
  }
  if (postType === "elementor_library") {
    riskScore += 1;
    reasons.push("elementor_library_post_type");
  }

  let riskClass = "low";
  if (riskScore >= 7) riskClass = "high";
  else if (riskScore >= 4) riskClass = "medium";

  return {
    normalized_dependency_flags: flags,
    dependency_risk_score: riskScore,
    dependency_risk_class: riskClass,
    dependency_risk_reasons: reasons
  };
}

function buildWordpressPhaseBDependencySummary(auditRows = []) {
  const rows = Array.isArray(auditRows) ? auditRows : [];
  const byType = new Map();

  for (const row of rows) {
    const postType = normalizeWordpressBuilderType(row?.post_type || "");
    if (!byType.has(postType)) {
      byType.set(postType, {
        post_type: postType,
        total_count: 0,
        low_risk_count: 0,
        medium_risk_count: 0,
        high_risk_count: 0,
        dependency_review_required_count: 0
      });
    }

    const bucket = byType.get(postType);
    bucket.total_count += 1;

    const riskClass = String(row?.dependency_risk_class || "").trim();
    if (riskClass === "high") bucket.high_risk_count += 1;
    else if (riskClass === "medium") bucket.medium_risk_count += 1;
    else bucket.low_risk_count += 1;

    if (String(row?.audit_classification || "").trim() === "dependency_review_required") {
      bucket.dependency_review_required_count += 1;
    }
  }

  return [...byType.values()];
}

function classifyWordpressBuilderAssetFamily(postType = "") {
  const normalized = normalizeWordpressBuilderType(postType);

  if (normalized === "elementor_library") {
    return "elementor_assets";
  }
  if (normalized === "wp_template" || normalized === "wp_template_part") {
    return "theme_templates";
  }
  if (normalized === "wp_navigation") {
    return "navigation_assets";
  }
  if (normalized === "popup") {
    return "popup_assets";
  }
  if (normalized === "global_widget") {
    return "global_widget_assets";
  }
  if (normalized === "wp_block" || normalized === "reusable_block") {
    return "reusable_block_assets";
  }

  return "other_builder_assets";
}

function classifyWordpressBuilderMigrationBucket(row = {}) {
  const family = classifyWordpressBuilderAssetFamily(row?.post_type || "");
  const riskClass = String(row?.dependency_risk_class || "").trim();
  const auditClass = String(row?.audit_classification || "").trim();

  let bucket = "manual_review";
  let bucketReason = "default_manual_review";

  if (riskClass === "low" && auditClass !== "dependency_review_required") {
    bucket = "candidate_low_complexity";
    bucketReason = "low_risk_low_dependency";
  } else if (riskClass === "low") {
    bucket = "candidate_reviewed_low_risk";
    bucketReason = "low_risk_but_dependency_review_required";
  } else if (riskClass === "medium") {
    bucket = "staged_dependency_review";
    bucketReason = "medium_risk_requires_mapping_review";
  } else if (riskClass === "high") {
    bucket = "blocked_high_dependency";
    bucketReason = "high_risk_dependency_profile";
  }

  if (family === "popup_assets" && bucket !== "blocked_high_dependency") {
    bucket = "staged_dependency_review";
    bucketReason = "popup_assets_require_rule_review";
  }

  if (family === "theme_templates" && riskClass !== "low") {
    bucket = "blocked_high_dependency";
    bucketReason = "theme_templates_not_safe_without_deep_review";
  }

  return {
    asset_family: family,
    migration_bucket: bucket,
    migration_bucket_reason: bucketReason
  };
}

function buildWordpressPhaseBFamilySummary(normalizedAuditRows = []) {
  const rows = Array.isArray(normalizedAuditRows) ? normalizedAuditRows : [];
  const byFamily = new Map();

  for (const row of rows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";

    if (!byFamily.has(family)) {
      byFamily.set(family, {
        asset_family: family,
        total_count: 0,
        candidate_low_complexity_count: 0,
        candidate_reviewed_low_risk_count: 0,
        staged_dependency_review_count: 0,
        blocked_high_dependency_count: 0,
        manual_review_count: 0
      });
    }

    const bucket = byFamily.get(family);
    bucket.total_count += 1;

    const migrationBucket = String(row?.migration_bucket || "").trim();
    if (migrationBucket === "candidate_low_complexity") {
      bucket.candidate_low_complexity_count += 1;
    } else if (migrationBucket === "candidate_reviewed_low_risk") {
      bucket.candidate_reviewed_low_risk_count += 1;
    } else if (migrationBucket === "staged_dependency_review") {
      bucket.staged_dependency_review_count += 1;
    } else if (migrationBucket === "blocked_high_dependency") {
      bucket.blocked_high_dependency_count += 1;
    } else {
      bucket.manual_review_count += 1;
    }
  }

  return [...byFamily.values()];
}

function buildWordpressPhaseBMigrationBuckets(normalizedAuditRows = []) {
  const rows = Array.isArray(normalizedAuditRows) ? normalizedAuditRows : [];
  const buckets = {
    candidate_low_complexity: [],
    candidate_reviewed_low_risk: [],
    staged_dependency_review: [],
    blocked_high_dependency: [],
    manual_review: []
  };

  for (const row of rows) {
    const key = String(row?.migration_bucket || "").trim();
    if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
      buckets.manual_review.push(row);
      continue;
    }
    buckets[key].push(row);
  }

  return buckets;
}

function extractWordpressBuilderCrossReferences(item = {}) {
  const raw = JSON.stringify(item || {});

  const patterns = {
    template_ids: [
      /template[_-]?id["':=\s]+(\d+)/gi,
      /templateId["':=\s]+(\d+)/gi
    ],
    widget_ids: [
      /widget[_-]?id["':=\s]+(\d+)/gi,
      /global[_-]?widget["':=\s]+(\d+)/gi
    ],
    navigation_ids: [
      /navigation[_-]?id["':=\s]+(\d+)/gi,
      /menu[_-]?id["':=\s]+(\d+)/gi
    ],
    popup_ids: [
      /popup[_-]?id["':=\s]+(\d+)/gi,
      /trigger[_-]?popup["':=\s]+(\d+)/gi
    ],
    shortcode_tags: [
      /\[([a-zA-Z0-9_\-]+)(?:\s|\])/g
    ]
  };

  const out = {
    template_ids: [],
    widget_ids: [],
    navigation_ids: [],
    popup_ids: [],
    shortcode_tags: []
  };

  for (const [key, regexList] of Object.entries(patterns)) {
    const values = new Set();
    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(raw)) !== null) {
        const v = String(match[1] || "").trim();
        if (!v) continue;
        values.add(v);
      }
    }
    out[key] = [...values];
  }

  return out;
}

function summarizeWordpressBuilderCrossReferences(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const summary = {
    total_rows: safeRows.length,
    rows_with_template_refs: 0,
    rows_with_widget_refs: 0,
    rows_with_navigation_refs: 0,
    rows_with_popup_refs: 0,
    rows_with_shortcode_refs: 0
  };

  for (const row of safeRows) {
    if ((row?.cross_reference_counts?.template_ids || 0) > 0) {
      summary.rows_with_template_refs += 1;
    }
    if ((row?.cross_reference_counts?.widget_ids || 0) > 0) {
      summary.rows_with_widget_refs += 1;
    }
    if ((row?.cross_reference_counts?.navigation_ids || 0) > 0) {
      summary.rows_with_navigation_refs += 1;
    }
    if ((row?.cross_reference_counts?.popup_ids || 0) > 0) {
      summary.rows_with_popup_refs += 1;
    }
    if ((row?.cross_reference_counts?.shortcode_tags || 0) > 0) {
      summary.rows_with_shortcode_refs += 1;
    }
  }

  return summary;
}

function buildWordpressBuilderNodeKey(row = {}) {
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const sourceId = Number(row?.source_id);
  if (!postType || !Number.isFinite(sourceId)) return "";
  return `${postType}:${sourceId}`;
}

function buildWordpressBuilderReferenceIndex(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const byNodeKey = {};
  const bySourceId = {};

  for (const row of safeRows) {
    const nodeKey = buildWordpressBuilderNodeKey(row);
    const sourceId = Number(row?.source_id);

    if (nodeKey) {
      byNodeKey[nodeKey] = {
        node_key: nodeKey,
        post_type: normalizeWordpressBuilderType(row?.post_type || ""),
        source_id: Number.isFinite(sourceId) ? sourceId : null,
        slug: String(row?.slug || "").trim(),
        asset_family: String(row?.asset_family || "").trim(),
        migration_bucket: String(row?.migration_bucket || "").trim()
      };
    }

    if (Number.isFinite(sourceId)) {
      if (!bySourceId[String(sourceId)]) bySourceId[String(sourceId)] = [];
      bySourceId[String(sourceId)].push({
        node_key: nodeKey,
        post_type: normalizeWordpressBuilderType(row?.post_type || ""),
        source_id: sourceId,
        slug: String(row?.slug || "").trim()
      });
    }
  }

  return {
    by_node_key: byNodeKey,
    by_source_id: bySourceId
  };
}

function buildWordpressBuilderDependencyEdges(rows = [], referenceIndex = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const bySourceId =
    referenceIndex && typeof referenceIndex === "object" && referenceIndex.by_source_id
      ? referenceIndex.by_source_id
      : {};

  const edges = [];
  const unresolved = [];

  const refKinds = [
    ["template_ids", "template_ref"],
    ["widget_ids", "widget_ref"],
    ["navigation_ids", "navigation_ref"],
    ["popup_ids", "popup_ref"]
  ];

  for (const row of safeRows) {
    const fromNode = buildWordpressBuilderNodeKey(row);
    if (!fromNode) continue;

    const refs =
      row?.cross_references && typeof row.cross_references === "object"
        ? row.cross_references
        : {};

    for (const [field, relation] of refKinds) {
      const ids = Array.isArray(refs[field]) ? refs[field] : [];

      for (const rawId of ids) {
        const refId = String(rawId || "").trim();
        if (!refId) continue;

        const matches = Array.isArray(bySourceId[refId]) ? bySourceId[refId] : [];
        if (matches.length === 0) {
          unresolved.push({
            from_node_key: fromNode,
            from_post_type: normalizeWordpressBuilderType(row?.post_type || ""),
            from_source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
            from_slug: String(row?.slug || "").trim(),
            reference_type: relation,
            referenced_source_id: Number(refId) || null,
            unresolved_reason: "missing_target_in_phase_b_inventory"
          });
          continue;
        }

        for (const match of matches) {
          edges.push({
            from_node_key: fromNode,
            from_post_type: normalizeWordpressBuilderType(row?.post_type || ""),
            from_source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
            from_slug: String(row?.slug || "").trim(),
            to_node_key: String(match.node_key || "").trim(),
            to_post_type: String(match.post_type || "").trim(),
            to_source_id: Number.isFinite(Number(match.source_id)) ? Number(match.source_id) : null,
            to_slug: String(match.slug || "").trim(),
            reference_type: relation
          });
        }
      }
    }
  }

  return {
    edges,
    unresolved
  };
}

function summarizeWordpressBuilderDependencyGraph(args = {}) {
  const edges = Array.isArray(args.edges) ? args.edges : [];
  const unresolved = Array.isArray(args.unresolved) ? args.unresolved : [];

  const byRelation = {};
  for (const edge of edges) {
    const relation = String(edge?.reference_type || "").trim() || "unknown";
    byRelation[relation] = (byRelation[relation] || 0) + 1;
  }

  const unresolvedByRelation = {};
  for (const row of unresolved) {
    const relation = String(row?.reference_type || "").trim() || "unknown";
    unresolvedByRelation[relation] = (unresolvedByRelation[relation] || 0) + 1;
  }

  return {
    edge_count: edges.length,
    unresolved_count: unresolved.length,
    relation_counts: byRelation,
    unresolved_relation_counts: unresolvedByRelation
  };
}

function evaluateWordpressPhaseBGraphStability(args = {}) {
  const dependencyGraphSummary =
    args.dependencyGraphSummary &&
    typeof args.dependencyGraphSummary === "object"
      ? args.dependencyGraphSummary
      : {};
  const normalizedAuditRows = Array.isArray(args.normalizedAuditRows)
    ? args.normalizedAuditRows
    : [];
  const migrationBuckets =
    args.migrationBuckets && typeof args.migrationBuckets === "object"
      ? args.migrationBuckets
      : {};

  const unresolvedCount = Number(dependencyGraphSummary.unresolved_count || 0);
  const highRiskCount = normalizedAuditRows.filter(
    row => String(row?.dependency_risk_class || "").trim() === "high"
  ).length;
  const blockedBucketCount = Array.isArray(migrationBuckets.blocked_high_dependency)
    ? migrationBuckets.blocked_high_dependency.length
    : 0;
  const stagedBucketCount = Array.isArray(migrationBuckets.staged_dependency_review)
    ? migrationBuckets.staged_dependency_review.length
    : 0;

  const blockingReasons = [];

  if (unresolvedCount > 0) {
    blockingReasons.push("unresolved_builder_references_present");
  }
  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_builder_assets_present");
  }
  if (blockedBucketCount > 0) {
    blockingReasons.push("blocked_builder_assets_present");
  }

  const graphStable = blockingReasons.length === 0;

  return {
    phase_b_graph_stable: graphStable,
    phase_b_readiness_status: graphStable
      ? "ready_for_builder_migration_planning"
      : "blocked_by_graph_instability",
    blocking_reasons: blockingReasons,
    unresolved_reference_count: unresolvedCount,
    high_risk_asset_count: highRiskCount,
    blocked_bucket_count: blockedBucketCount,
    staged_dependency_review_count: stagedBucketCount
  };
}

function buildWordpressPhaseBReadinessArtifact(args = {}) {
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const phaseBGate =
    args.phaseBGate && typeof args.phaseBGate === "object" ? args.phaseBGate : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const dependencyGraphSummary =
    args.dependencyGraphSummary &&
    typeof args.dependencyGraphSummary === "object"
      ? args.dependencyGraphSummary
      : {};
  const familySummary = Array.isArray(args.familySummary) ? args.familySummary : [];

  return {
    artifact_type: "wordpress_phase_b_readiness_gate",
    artifact_version: "v1",
    phase_b_enabled: phaseBPlan.enabled === true,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    phase_b_gate_status: String(phaseBGate.phase_b_gate_status || "").trim(),
    phase_b_graph_stable: graphStability.phase_b_graph_stable === true,
    phase_b_readiness_status: String(graphStability.phase_b_readiness_status || "").trim(),
    blocking_reasons: Array.isArray(graphStability.blocking_reasons)
      ? graphStability.blocking_reasons
      : [],
    unresolved_reference_count: Number(graphStability.unresolved_reference_count || 0),
    high_risk_asset_count: Number(graphStability.high_risk_asset_count || 0),
    blocked_bucket_count: Number(graphStability.blocked_bucket_count || 0),
    staged_dependency_review_count: Number(
      graphStability.staged_dependency_review_count || 0
    ),
    dependency_graph_edge_count: Number(dependencyGraphSummary.edge_count || 0),
    dependency_graph_unresolved_count: Number(
      dependencyGraphSummary.unresolved_count || 0
    ),
    family_summary: familySummary
  };
}

function buildWordpressPhaseBMigrationPlanningCandidates(args = {}) {
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const migrationBuckets =
    args.migrationBuckets && typeof args.migrationBuckets === "object"
      ? args.migrationBuckets
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (graphStability.phase_b_graph_stable !== true) {
    return {
      planning_status: "blocked",
      candidate_count: 0,
      blocked_count: 0,
      planning_candidates: [],
      blocked_candidates: [],
      blocking_reasons: Array.isArray(graphStability.blocking_reasons)
        ? graphStability.blocking_reasons
        : ["phase_b_graph_not_stable"]
    };
  }

  const stableCandidates = [
    ...(Array.isArray(migrationBuckets.candidate_low_complexity)
      ? migrationBuckets.candidate_low_complexity
      : []),
    ...(Array.isArray(migrationBuckets.candidate_reviewed_low_risk)
      ? migrationBuckets.candidate_reviewed_low_risk
      : [])
  ].slice(0, limit);

  const blockedCandidates = [
    ...(Array.isArray(migrationBuckets.staged_dependency_review)
      ? migrationBuckets.staged_dependency_review
      : []),
    ...(Array.isArray(migrationBuckets.blocked_high_dependency)
      ? migrationBuckets.blocked_high_dependency
      : []),
    ...(Array.isArray(migrationBuckets.manual_review)
      ? migrationBuckets.manual_review
      : [])
  ].slice(0, limit);

  return {
    planning_status: "ready",
    candidate_count: stableCandidates.length,
    blocked_count: blockedCandidates.length,
    planning_candidates: stableCandidates.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      planning_reason: "stable_bucket_candidate"
    })),
    blocked_candidates: blockedCandidates.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      blocked_reason:
        String(row?.migration_bucket_reason || "").trim() || "non_stable_bucket"
    })),
    blocking_reasons: []
  };
}

function buildWordpressPhaseBPlanningArtifact(args = {}) {
  const planningCandidates =
    args.planningCandidates && typeof args.planningCandidates === "object"
      ? args.planningCandidates
      : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};

  return {
    artifact_type: "wordpress_phase_b_planning_candidates",
    artifact_version: "v1",
    planning_status: String(planningCandidates.planning_status || "").trim(),
    phase_b_graph_stable: graphStability.phase_b_graph_stable === true,
    candidate_count: Number(planningCandidates.candidate_count || 0),
    blocked_count: Number(planningCandidates.blocked_count || 0),
    blocking_reasons: Array.isArray(planningCandidates.blocking_reasons)
      ? planningCandidates.blocking_reasons
      : [],
    planning_candidates: Array.isArray(planningCandidates.planning_candidates)
      ? planningCandidates.planning_candidates
      : [],
    blocked_candidates: Array.isArray(planningCandidates.blocked_candidates)
      ? planningCandidates.blocked_candidates
      : []
  };
}

function computeWordpressBuilderSequenceWeight(row = {}) {
  const family = String(row?.asset_family || "").trim();
  const riskClass = String(row?.dependency_risk_class || "").trim();
  const dependencyScore = Number(row?.dependency_risk_score || 0);
  const crossRefCounts =
    row?.cross_reference_counts && typeof row.cross_reference_counts === "object"
      ? row.cross_reference_counts
      : {};

  const familyBaseWeightMap = {
    reusable_block_assets: 10,
    global_widget_assets: 20,
    navigation_assets: 30,
    elementor_assets: 40,
    theme_templates: 50,
    popup_assets: 60,
    other_builder_assets: 70
  };

  const familyBase = Number(familyBaseWeightMap[family] || 70);

  const refWeight =
    Number(crossRefCounts.template_ids || 0) * 3 +
    Number(crossRefCounts.widget_ids || 0) * 2 +
    Number(crossRefCounts.navigation_ids || 0) * 2 +
    Number(crossRefCounts.popup_ids || 0) * 4 +
    Number(crossRefCounts.shortcode_tags || 0);

  const riskWeight =
    riskClass === "low" ? 0 : riskClass === "medium" ? 15 : 30;

  return familyBase + dependencyScore + refWeight + riskWeight;
}

function buildWordpressPhaseBSequencePlanner(args = {}) {
  const planningCandidates =
    args.planningCandidates && typeof args.planningCandidates === "object"
      ? args.planningCandidates
      : {};
  const normalizedAuditRows = Array.isArray(args.normalizedAuditRows)
    ? args.normalizedAuditRows
    : [];

  if (String(planningCandidates.planning_status || "").trim() !== "ready") {
    return {
      sequence_status: "blocked",
      total_sequence_count: 0,
      family_sequence_summary: [],
      migration_sequence: [],
      blocking_reasons: Array.isArray(planningCandidates.blocking_reasons)
        ? planningCandidates.blocking_reasons
        : ["phase_b_planning_not_ready"]
    };
  }

  const candidateKeySet = new Set(
    (Array.isArray(planningCandidates.planning_candidates)
      ? planningCandidates.planning_candidates
      : []
    ).map(row => {
      const postType = normalizeWordpressBuilderType(row?.post_type || "");
      const sourceId = Number(row?.source_id);
      return Number.isFinite(sourceId) ? `${postType}:${sourceId}` : "";
    }).filter(Boolean)
  );

  const selectedRows = normalizedAuditRows
    .filter(row => candidateKeySet.has(buildWordpressBuilderNodeKey(row)))
    .map(row => ({
      ...row,
      migration_sequence_weight: computeWordpressBuilderSequenceWeight(row)
    }))
    .sort((a, b) => {
      const weightDelta =
        Number(a?.migration_sequence_weight || 0) -
        Number(b?.migration_sequence_weight || 0);
      if (weightDelta !== 0) return weightDelta;

      const familyA = String(a?.asset_family || "").trim();
      const familyB = String(b?.asset_family || "").trim();
      if (familyA !== familyB) return familyA.localeCompare(familyB);

      return String(a?.slug || "").trim().localeCompare(String(b?.slug || "").trim());
    })
    .map((row, index) => ({
      sequence_index: index + 1,
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      migration_sequence_weight: Number(row?.migration_sequence_weight || 0),
      planning_reason: "ordered_by_family_and_dependency_weight"
    }));

  const familySummaryMap = new Map();
  for (const row of selectedRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familySummaryMap.has(family)) {
      familySummaryMap.set(family, {
        asset_family: family,
        total_count: 0,
        first_sequence_index: null,
        last_sequence_index: null
      });
    }
    const bucket = familySummaryMap.get(family);
    bucket.total_count += 1;
    if (bucket.first_sequence_index === null) {
      bucket.first_sequence_index = row.sequence_index;
    }
    bucket.last_sequence_index = row.sequence_index;
  }

  return {
    sequence_status: "ready",
    total_sequence_count: selectedRows.length,
    family_sequence_summary: [...familySummaryMap.values()],
    migration_sequence: selectedRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBSequenceArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_b_sequence_plan",
    artifact_version: "v1",
    sequence_status: String(planner.sequence_status || "").trim(),
    total_sequence_count: Number(planner.total_sequence_count || 0),
    family_sequence_summary: Array.isArray(planner.family_sequence_summary)
      ? planner.family_sequence_summary
      : [],
    migration_sequence: Array.isArray(planner.migration_sequence)
      ? planner.migration_sequence
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function extractWordpressBuilderCompatibilitySignals(row = {}) {
  const flags =
    row?.dependency_flags && typeof row.dependency_flags === "object"
      ? row.dependency_flags
      : {};
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const assetFamily = String(row?.asset_family || "").trim();

  return {
    requires_elementor:
      postType === "elementor_library" ||
      assetFamily === "elementor_assets" ||
      flags.uses_elementor_data === true,
    requires_theme_templates:
      postType === "wp_template" ||
      postType === "wp_template_part" ||
      assetFamily === "theme_templates" ||
      flags.uses_theme_json_refs === true,
    requires_navigation_support:
      postType === "wp_navigation" ||
      assetFamily === "navigation_assets" ||
      flags.uses_navigation_refs === true,
    requires_popup_support:
      postType === "popup" ||
      assetFamily === "popup_assets" ||
      flags.uses_popup_rules === true,
    requires_global_widget_support:
      postType === "global_widget" ||
      assetFamily === "global_widget_assets" ||
      flags.uses_global_widget_refs === true,
    requires_shortcode_review:
      flags.uses_shortcode_like_refs === true
  };
}

function evaluateWordpressBuilderCompatibilityForRow(row = {}) {
  const signals = extractWordpressBuilderCompatibilitySignals(row);
  const reasons = [];

  if (signals.requires_elementor) {
    reasons.push("elementor_compatibility_required");
  }
  if (signals.requires_theme_templates) {
    reasons.push("theme_template_compatibility_required");
  }
  if (signals.requires_navigation_support) {
    reasons.push("navigation_support_required");
  }
  if (signals.requires_popup_support) {
    reasons.push("popup_rule_support_required");
  }
  if (signals.requires_global_widget_support) {
    reasons.push("global_widget_support_required");
  }
  if (signals.requires_shortcode_review) {
    reasons.push("shortcode_review_required");
  }

  const strictBlock =
    signals.requires_popup_support ||
    signals.requires_theme_templates;

  return {
    compatibility_signals: signals,
    compatibility_reasons: reasons,
    compatibility_gate_status: strictBlock
      ? "mapping_review_required"
      : reasons.length > 0
      ? "compatibility_review_required"
      : "compatible_for_mapping",
    compatibility_blocking: strictBlock === true
  };
}

function buildWordpressPhaseBMappingPrerequisiteGate(args = {}) {
  const sequencePlanner =
    args.sequencePlanner && typeof args.sequencePlanner === "object"
      ? args.sequencePlanner
      : {};

  if (String(sequencePlanner.sequence_status || "").trim() !== "ready") {
    return {
      mapping_gate_status: "blocked",
      mapping_gate_ready: false,
      mapping_ready_count: 0,
      mapping_review_required_count: 0,
      compatibility_review_required_count: 0,
      blocked_count: 0,
      blocking_reasons: Array.isArray(sequencePlanner.blocking_reasons)
        ? sequencePlanner.blocking_reasons
        : ["phase_b_sequence_not_ready"],
      mapping_rows: []
    };
  }

  const rows = Array.isArray(sequencePlanner.migration_sequence)
    ? sequencePlanner.migration_sequence
    : [];

  const mappingRows = rows.map(row => {
    const compatibility = evaluateWordpressBuilderCompatibilityForRow(row);
    return {
      ...row,
      compatibility_signals: compatibility.compatibility_signals,
      compatibility_reasons: compatibility.compatibility_reasons,
      compatibility_gate_status: compatibility.compatibility_gate_status,
      compatibility_blocking: compatibility.compatibility_blocking,
      mapping_prerequisite_status:
        compatibility.compatibility_blocking === true
          ? "blocked"
          : compatibility.compatibility_gate_status === "compatible_for_mapping"
          ? "ready_for_mapping"
          : "review_before_mapping"
    };
  });

  const mappingReadyCount = mappingRows.filter(
    row => String(row?.mapping_prerequisite_status || "").trim() === "ready_for_mapping"
  ).length;

  const mappingReviewRequiredCount = mappingRows.filter(
    row => String(row?.compatibility_gate_status || "").trim() === "mapping_review_required"
  ).length;

  const compatibilityReviewRequiredCount = mappingRows.filter(
    row => String(row?.compatibility_gate_status || "").trim() === "compatibility_review_required"
  ).length;

  const blockedCount = mappingRows.filter(
    row => row?.compatibility_blocking === true
  ).length;

  return {
    mapping_gate_status:
      blockedCount === 0 ? "ready_for_mapping_planning" : "blocked_by_mapping_prerequisites",
    mapping_gate_ready: blockedCount === 0,
    mapping_ready_count: mappingReadyCount,
    mapping_review_required_count: mappingReviewRequiredCount,
    compatibility_review_required_count: compatibilityReviewRequiredCount,
    blocked_count: blockedCount,
    blocking_reasons:
      blockedCount === 0 ? [] : ["builder_mapping_prerequisites_unresolved"],
    mapping_rows: mappingRows
  };
}

function buildWordpressPhaseBMappingPrerequisiteArtifact(args = {}) {
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_b_mapping_prerequisite_gate",
    artifact_version: "v1",
    mapping_gate_status: String(gate.mapping_gate_status || "").trim(),
    mapping_gate_ready: gate.mapping_gate_ready === true,
    mapping_ready_count: Number(gate.mapping_ready_count || 0),
    mapping_review_required_count: Number(gate.mapping_review_required_count || 0),
    compatibility_review_required_count: Number(
      gate.compatibility_review_required_count || 0
    ),
    blocked_count: Number(gate.blocked_count || 0),
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    mapping_rows: Array.isArray(gate.mapping_rows) ? gate.mapping_rows : []
  };
}

function buildWordpressBuilderFamilyMappingTemplate(assetFamily = "") {
  const family = String(assetFamily || "").trim();

  if (family === "elementor_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "meta._elementor_data"],
      target_fields: ["title", "slug", "status", "content", "meta._elementor_data"],
      prerequisite_checks: [
        "elementor_plugin_available",
        "elementor_meta_supported",
        "shortcode_review_if_present"
      ],
      mapping_mode: "meta_preserving"
    };
  }

  if (family === "theme_templates") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "template_meta"],
      target_fields: ["title", "slug", "status", "content", "template_meta"],
      prerequisite_checks: [
        "theme_template_support_available",
        "theme_compatibility_review",
        "template_condition_review"
      ],
      mapping_mode: "template_condition_aware"
    };
  }

  if (family === "navigation_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content"],
      target_fields: ["title", "slug", "status", "content"],
      prerequisite_checks: [
        "navigation_post_type_available",
        "navigation_reference_review"
      ],
      mapping_mode: "structure_preserving"
    };
  }

  if (family === "popup_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "popup_rules"],
      target_fields: ["title", "slug", "status", "content", "popup_rules"],
      prerequisite_checks: [
        "popup_support_available",
        "popup_trigger_review",
        "display_condition_review"
      ],
      mapping_mode: "rule_aware"
    };
  }

  if (family === "global_widget_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "widget_meta"],
      target_fields: ["title", "slug", "status", "content", "widget_meta"],
      prerequisite_checks: [
        "global_widget_support_available",
        "widget_reference_review"
      ],
      mapping_mode: "widget_meta_preserving"
    };
  }

  if (family === "reusable_block_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content"],
      target_fields: ["title", "slug", "status", "content"],
      prerequisite_checks: [
        "reusable_block_support_available"
      ],
      mapping_mode: "content_preserving"
    };
  }

  return {
    mapping_family: family || "other_builder_assets",
    source_fields: ["title", "slug", "status", "content"],
    target_fields: ["title", "slug", "status", "content"],
    prerequisite_checks: [
      "manual_family_review"
    ],
    mapping_mode: "manual_review"
  };
}

function buildWordpressPhaseBMappingPlanSkeleton(args = {}) {
  const mappingGate =
    args.mappingGate && typeof args.mappingGate === "object"
      ? args.mappingGate
      : {};

  if (mappingGate.mapping_gate_ready !== true) {
    return {
      mapping_plan_status: "blocked",
      family_mapping_plans: [],
      asset_mapping_rows: [],
      blocking_reasons: Array.isArray(mappingGate.blocking_reasons)
        ? mappingGate.blocking_reasons
        : ["phase_b_mapping_gate_not_ready"]
    };
  }

  const mappingRows = Array.isArray(mappingGate.mapping_rows)
    ? mappingGate.mapping_rows
    : [];

  const familyPlanMap = new Map();
  const assetMappingRows = [];

  for (const row of mappingRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";

    if (!familyPlanMap.has(family)) {
      familyPlanMap.set(family, {
        ...buildWordpressBuilderFamilyMappingTemplate(family),
        asset_count: 0
      });
    }

    const familyPlan = familyPlanMap.get(family);
    familyPlan.asset_count += 1;

    assetMappingRows.push({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: family,
      migration_bucket: String(row?.migration_bucket || "").trim(),
      mapping_prerequisite_status: String(row?.mapping_prerequisite_status || "").trim(),
      compatibility_gate_status: String(row?.compatibility_gate_status || "").trim(),
      mapping_mode: String(familyPlan.mapping_mode || "").trim(),
      source_fields: Array.isArray(familyPlan.source_fields)
        ? familyPlan.source_fields
        : [],
      target_fields: Array.isArray(familyPlan.target_fields)
        ? familyPlan.target_fields
        : [],
      prerequisite_checks: Array.isArray(familyPlan.prerequisite_checks)
        ? familyPlan.prerequisite_checks
        : []
    });
  }

  return {
    mapping_plan_status: "ready",
    family_mapping_plans: [...familyPlanMap.values()],
    asset_mapping_rows: assetMappingRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBMappingPlanArtifact(args = {}) {
  const mappingPlan =
    args.mappingPlan && typeof args.mappingPlan === "object"
      ? args.mappingPlan
      : {};

  return {
    artifact_type: "wordpress_phase_b_mapping_plan_skeleton",
    artifact_version: "v1",
    mapping_plan_status: String(mappingPlan.mapping_plan_status || "").trim(),
    family_mapping_plans: Array.isArray(mappingPlan.family_mapping_plans)
      ? mappingPlan.family_mapping_plans
      : [],
    asset_mapping_rows: Array.isArray(mappingPlan.asset_mapping_rows)
      ? mappingPlan.asset_mapping_rows
      : [],
    blocking_reasons: Array.isArray(mappingPlan.blocking_reasons)
      ? mappingPlan.blocking_reasons
      : []
  };
}

function buildWordpressBuilderFamilyMetaPreservationPlan(assetFamily = "") {
  const family = String(assetFamily || "").trim();

  if (family === "elementor_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_edit_mode",
        "_elementor_template_type",
        "_elementor_version"
      ],
      optional_meta_keys: [
        "_wp_page_template"
      ],
      content_strategy: "preserve_rendered_and_builder_meta"
    };
  }

  if (family === "theme_templates") {
    return {
      preserve_meta_keys: [
        "_wp_template_type",
        "_wp_theme"
      ],
      optional_meta_keys: [
        "_wp_page_template"
      ],
      content_strategy: "preserve_template_content_and_template_meta"
    };
  }

  if (family === "popup_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_template_type"
      ],
      optional_meta_keys: [
        "_elementor_conditions",
        "_elementor_triggers"
      ],
      content_strategy: "preserve_popup_content_and_rule_meta"
    };
  }

  if (family === "global_widget_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_template_type"
      ],
      optional_meta_keys: [
        "_elementor_widget_type"
      ],
      content_strategy: "preserve_widget_meta_and_content"
    };
  }

  if (family === "navigation_assets") {
    return {
      preserve_meta_keys: [],
      optional_meta_keys: [
        "_menu_item_type"
      ],
      content_strategy: "preserve_navigation_structure"
    };
  }

  if (family === "reusable_block_assets") {
    return {
      preserve_meta_keys: [],
      optional_meta_keys: [],
      content_strategy: "preserve_block_content"
    };
  }

  return {
    preserve_meta_keys: [],
    optional_meta_keys: [],
    content_strategy: "manual_review"
  };
}

function resolveWordpressBuilderFieldMappingRow(row = {}) {
  const assetFamily = String(row?.asset_family || "").trim() || "other_builder_assets";
  const metaPlan = buildWordpressBuilderFamilyMetaPreservationPlan(assetFamily);

  const sourceFields = Array.isArray(row?.source_fields) ? row.source_fields : [];
  const targetFields = Array.isArray(row?.target_fields) ? row.target_fields : [];
  const preserveMetaKeys = Array.isArray(metaPlan.preserve_meta_keys)
    ? metaPlan.preserve_meta_keys
    : [];
  const optionalMetaKeys = Array.isArray(metaPlan.optional_meta_keys)
    ? metaPlan.optional_meta_keys
    : [];

  const fieldMappings = sourceFields.map(field => ({
    source_field: String(field || "").trim(),
    target_field: targetFields.includes(field) ? String(field || "").trim() : "",
    mapping_status: targetFields.includes(field) ? "mapped_direct" : "requires_review"
  }));

  const metaMappings = [
    ...preserveMetaKeys.map(key => ({
      meta_key: String(key || "").trim(),
      preservation_mode: "required_preserve",
      mapping_status: "planned"
    })),
    ...optionalMetaKeys.map(key => ({
      meta_key: String(key || "").trim(),
      preservation_mode: "optional_preserve",
      mapping_status: "planned_optional"
    }))
  ];

  const directMappingsReady = fieldMappings.every(
    row => String(row?.mapping_status || "").trim() === "mapped_direct"
  );

  return {
    ...row,
    field_mappings: fieldMappings,
    meta_preservation_plan: {
      preserve_meta_keys: preserveMetaKeys,
      optional_meta_keys: optionalMetaKeys,
      content_strategy: String(metaPlan.content_strategy || "").trim()
    },
    meta_mappings: metaMappings,
    field_mapping_status:
      directMappingsReady ? "direct_mapping_ready" : "field_review_required"
  };
}

function buildWordpressPhaseBFieldMappingResolver(args = {}) {
  const mappingPlan =
    args.mappingPlan && typeof args.mappingPlan === "object"
      ? args.mappingPlan
      : {};

  if (String(mappingPlan.mapping_plan_status || "").trim() !== "ready") {
    return {
      field_mapping_status: "blocked",
      resolved_mapping_rows: [],
      family_mapping_summary: [],
      blocking_reasons: Array.isArray(mappingPlan.blocking_reasons)
        ? mappingPlan.blocking_reasons
        : ["phase_b_mapping_plan_not_ready"]
    };
  }

  const assetRows = Array.isArray(mappingPlan.asset_mapping_rows)
    ? mappingPlan.asset_mapping_rows
    : [];

  const resolvedRows = assetRows.map(resolveWordpressBuilderFieldMappingRow);

  const familyMap = new Map();
  for (const row of resolvedRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        asset_family: family,
        total_count: 0,
        direct_mapping_ready_count: 0,
        field_review_required_count: 0,
        required_meta_keys: new Set(),
        optional_meta_keys: new Set()
      });
    }

    const bucket = familyMap.get(family);
    bucket.total_count += 1;

    if (String(row?.field_mapping_status || "").trim() === "direct_mapping_ready") {
      bucket.direct_mapping_ready_count += 1;
    } else {
      bucket.field_review_required_count += 1;
    }

    const metaPlan =
      row?.meta_preservation_plan && typeof row.meta_preservation_plan === "object"
        ? row.meta_preservation_plan
        : {};

    for (const key of Array.isArray(metaPlan.preserve_meta_keys)
      ? metaPlan.preserve_meta_keys
      : []) {
      if (String(key || "").trim()) bucket.required_meta_keys.add(String(key || "").trim());
    }

    for (const key of Array.isArray(metaPlan.optional_meta_keys)
      ? metaPlan.optional_meta_keys
      : []) {
      if (String(key || "").trim()) bucket.optional_meta_keys.add(String(key || "").trim());
    }
  }

  const familyMappingSummary = [...familyMap.values()].map(row => ({
    asset_family: row.asset_family,
    total_count: row.total_count,
    direct_mapping_ready_count: row.direct_mapping_ready_count,
    field_review_required_count: row.field_review_required_count,
    required_meta_keys: [...row.required_meta_keys],
    optional_meta_keys: [...row.optional_meta_keys]
  }));

  return {
    field_mapping_status: "ready",
    resolved_mapping_rows: resolvedRows,
    family_mapping_summary: familyMappingSummary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBFieldMappingArtifact(args = {}) {
  const resolver =
    args.resolver && typeof args.resolver === "object"
      ? args.resolver
      : {};

  return {
    artifact_type: "wordpress_phase_b_field_mapping_plan",
    artifact_version: "v1",
    field_mapping_status: String(resolver.field_mapping_status || "").trim(),
    resolved_mapping_rows: Array.isArray(resolver.resolved_mapping_rows)
      ? resolver.resolved_mapping_rows
      : [],
    family_mapping_summary: Array.isArray(resolver.family_mapping_summary)
      ? resolver.family_mapping_summary
      : [],
    blocking_reasons: Array.isArray(resolver.blocking_reasons)
      ? resolver.blocking_reasons
      : []
  };
}

function buildWordpressBuilderDryRunPayloadRow(row = {}) {
  const fieldMappings = Array.isArray(row?.field_mappings) ? row.field_mappings : [];
  const metaMappings = Array.isArray(row?.meta_mappings) ? row.meta_mappings : [];

  const mappedFields = fieldMappings
    .filter(x => String(x?.mapping_status || "").trim() === "mapped_direct")
    .map(x => ({
      source_field: String(x?.source_field || "").trim(),
      target_field: String(x?.target_field || "").trim()
    }));

  const requiredMeta = metaMappings
    .filter(x => String(x?.preservation_mode || "").trim() === "required_preserve")
    .map(x => String(x?.meta_key || "").trim())
    .filter(Boolean);

  const optionalMeta = metaMappings
    .filter(x => String(x?.preservation_mode || "").trim() === "optional_preserve")
    .map(x => String(x?.meta_key || "").trim())
    .filter(Boolean);

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    asset_family: String(row?.asset_family || "").trim(),
    mapping_mode: String(row?.mapping_mode || "").trim(),
    field_mapping_status: String(row?.field_mapping_status || "").trim(),
    mapped_fields: mappedFields,
    meta_preservation: {
      required_meta_keys: requiredMeta,
      optional_meta_keys: optionalMeta,
      content_strategy: String(
        row?.meta_preservation_plan?.content_strategy || ""
      ).trim()
    },
    dry_run_mutation_shape: {
      title: "source->target",
      slug: "source->target",
      status: "draft",
      content: mappedFields.some(x => x.target_field === "content")
        ? "preserve_from_source"
        : "review_required",
      meta: {
        required: requiredMeta,
        optional: optionalMeta
      }
    }
  };
}

function buildWordpressPhaseBDryRunMigrationPayloadPlanner(args = {}) {
  const resolver =
    args.resolver && typeof args.resolver === "object"
      ? args.resolver
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (String(resolver.field_mapping_status || "").trim() !== "ready") {
    return {
      dry_run_status: "blocked",
      payload_count: 0,
      dry_run_payload_rows: [],
      family_payload_summary: [],
      blocking_reasons: Array.isArray(resolver.blocking_reasons)
        ? resolver.blocking_reasons
        : ["phase_b_field_mapping_not_ready"]
    };
  }

  const resolvedRows = Array.isArray(resolver.resolved_mapping_rows)
    ? resolver.resolved_mapping_rows
    : [];

  const eligibleRows = resolvedRows.filter(row => {
    const status = String(row?.mapping_prerequisite_status || "").trim();
    return status === "ready_for_mapping" || status === "review_before_mapping";
  });

  const dryRunPayloadRows = eligibleRows
    .slice(0, limit)
    .map(buildWordpressBuilderDryRunPayloadRow);

  const familyMap = new Map();
  for (const row of dryRunPayloadRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        asset_family: family,
        payload_count: 0,
        direct_mapping_ready_count: 0,
        field_review_required_count: 0
      });
    }
    const bucket = familyMap.get(family);
    bucket.payload_count += 1;
    if (String(row?.field_mapping_status || "").trim() === "direct_mapping_ready") {
      bucket.direct_mapping_ready_count += 1;
    } else {
      bucket.field_review_required_count += 1;
    }
  }

  return {
    dry_run_status: "ready",
    payload_count: dryRunPayloadRows.length,
    dry_run_payload_rows: dryRunPayloadRows,
    family_payload_summary: [...familyMap.values()],
    blocking_reasons: []
  };
}

function buildWordpressPhaseBDryRunArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object"
      ? args.planner
      : {};

  return {
    artifact_type: "wordpress_phase_b_dry_run_payload_plan",
    artifact_version: "v1",
    dry_run_status: String(planner.dry_run_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    family_payload_summary: Array.isArray(planner.family_payload_summary)
      ? planner.family_payload_summary
      : [],
    dry_run_payload_rows: Array.isArray(planner.dry_run_payload_rows)
      ? planner.dry_run_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseBExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const builder = migration.builder_assets && typeof migration.builder_assets === "object"
    ? migration.builder_assets
    : {};
  const execution = builder.execution && typeof builder.execution === "object"
    ? builder.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 50)),
    allow_review_required_rows: execution.allow_review_required_rows === true
  };
}

function buildWordpressPhaseBExecutionGuard(args = {}) {
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const mappingGate =
    args.mappingGate && typeof args.mappingGate === "object"
      ? args.mappingGate
      : {};
  const dryRunPlanner =
    args.dryRunPlanner && typeof args.dryRunPlanner === "object"
      ? args.dryRunPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseBPlan.enabled !== true) {
    blockingReasons.push("phase_b_not_enabled");
  }
  if (phaseBPlan.audit_only === true) {
    blockingReasons.push("phase_b_audit_only_enabled");
  }
  if (graphStability.phase_b_graph_stable !== true) {
    blockingReasons.push("phase_b_graph_not_stable");
  }
  if (mappingGate.mapping_gate_ready !== true) {
    blockingReasons.push("phase_b_mapping_gate_not_ready");
  }
  if (String(dryRunPlanner.dry_run_status || "").trim() !== "ready") {
    blockingReasons.push("phase_b_dry_run_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_b_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_b_execution_apply_conflicts_with_dry_run_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_builder_mutation_execution"
      : "blocked_before_builder_mutation_execution",
    execution_guard_ready: executionReady,
    blocking_reasons: blockingReasons,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0)
  };
}

function buildWordpressPhaseBExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_b_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseBMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const fieldMappingResolver =
    args.fieldMappingResolver && typeof args.fieldMappingResolver === "object"
      ? args.fieldMappingResolver
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_b_execution_guard_not_ready"]
    };
  }

  const rows = Array.isArray(fieldMappingResolver.resolved_mapping_rows)
    ? fieldMappingResolver.resolved_mapping_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of rows) {
    const mappingStatus = String(row?.field_mapping_status || "").trim();
    const prerequisiteStatus = String(row?.mapping_prerequisite_status || "").trim();

    const baseRecord = {
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      field_mapping_status: mappingStatus,
      mapping_prerequisite_status: prerequisiteStatus,
      mapping_mode: String(row?.mapping_mode || "").trim()
    };

    if (mappingStatus !== "direct_mapping_ready") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "field_mapping_not_direct_ready"
      });
      continue;
    }

    if (prerequisiteStatus === "blocked") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "mapping_prerequisite_blocked"
      });
      continue;
    }

    if (
      prerequisiteStatus === "review_before_mapping" &&
      executionPlan.allow_review_required_rows !== true
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "review_required_rows_not_allowed"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "direct_mapping_ready_for_builder_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 50))
  );

  return {
    selector_status: "ready",
    selected_count: limitedSelected.length,
    rejected_count: rejected.length,
    selected_candidates: limitedSelected,
    rejected_candidates: rejected,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_b_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_candidates: Array.isArray(selector.selected_candidates)
      ? selector.selected_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressBuilderMutationPayloadFromResolvedRow(row = {}) {
  const fieldMappings = Array.isArray(row?.field_mappings) ? row.field_mappings : [];
  const metaPlan =
    row?.meta_preservation_plan && typeof row.meta_preservation_plan === "object"
      ? row.meta_preservation_plan
      : {};

  const payload = {};

  for (const mapping of fieldMappings) {
    const sourceField = String(mapping?.source_field || "").trim();
    const targetField = String(mapping?.target_field || "").trim();
    const mappingStatus = String(mapping?.mapping_status || "").trim();

    if (!sourceField || !targetField || mappingStatus !== "mapped_direct") {
      continue;
    }

    if (targetField === "title") payload.title = "preserve_from_source";
    else if (targetField === "slug") payload.slug = "preserve_from_source";
    else if (targetField === "status") payload.status = "draft";
    else if (targetField === "content") payload.content = "preserve_from_source";
    else payload[targetField] = "preserve_from_source";
  }

  payload.meta = {
    required: Array.isArray(metaPlan.preserve_meta_keys)
      ? metaPlan.preserve_meta_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    optional: Array.isArray(metaPlan.optional_meta_keys)
      ? metaPlan.optional_meta_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    content_strategy: String(metaPlan.content_strategy || "").trim()
  };

  return payload;
}

function buildWordpressPhaseBMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};
  const resolver =
    args.resolver && typeof args.resolver === "object" ? args.resolver : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_b_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];
  const resolvedRows = Array.isArray(resolver.resolved_mapping_rows)
    ? resolver.resolved_mapping_rows
    : [];

  const resolvedMap = new Map(
    resolvedRows.map(row => [
      `${normalizeWordpressBuilderType(row?.post_type || "")}:${Number(row?.source_id || 0)}`,
      row
    ])
  );

  const composedPayloads = selectedCandidates.map(candidate => {
    const key = `${normalizeWordpressBuilderType(candidate?.post_type || "")}:${Number(candidate?.source_id || 0)}`;
    const resolvedRow = resolvedMap.get(key) || {};

    return {
      post_type: String(candidate?.post_type || "").trim(),
      source_id: Number.isFinite(Number(candidate?.source_id))
        ? Number(candidate.source_id)
        : null,
      slug: String(candidate?.slug || "").trim(),
      title: String(candidate?.title || "").trim(),
      asset_family: String(candidate?.asset_family || "").trim(),
      mapping_mode: String(resolvedRow?.mapping_mode || candidate?.mapping_mode || "").trim(),
      field_mapping_status: String(
        resolvedRow?.field_mapping_status || candidate?.field_mapping_status || ""
      ).trim(),
      mutation_payload: buildWordpressBuilderMutationPayloadFromResolvedRow(resolvedRow),
      payload_reason: "composed_from_direct_mapping_ready_candidate"
    };
  });

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_b_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    composed_payloads: Array.isArray(composer.composed_payloads)
      ? composer.composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressBuilderDryRunResult(row = {}) {
  const payload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};

  const requiredMeta = Array.isArray(payload?.meta?.required)
    ? payload.meta.required
    : [];
  const optionalMeta = Array.isArray(payload?.meta?.optional)
    ? payload.meta.optional
    : [];

  const preview = {
    mutation_mode: "dry_run",
    expected_target_status: String(payload?.status || "draft").trim(),
    expected_content_strategy: String(payload?.meta?.content_strategy || "").trim(),
    mapped_field_count: Object.keys(payload).filter(k => k !== "meta").length,
    required_meta_key_count: requiredMeta.length,
    optional_meta_key_count: optionalMeta.length
  };

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    asset_family: String(row?.asset_family || "").trim(),
    mapping_mode: String(row?.mapping_mode || "").trim(),
    field_mapping_status: String(row?.field_mapping_status || "").trim(),
    dry_run_result: "simulated_ready",
    mutation_evidence_preview: preview,
    preview_payload: payload
  };
}

function buildWordpressPhaseBDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      mutation_evidence_preview_summary: {
        total_rows: 0,
        expected_draft_count: 0,
        total_required_meta_keys: 0,
        total_optional_meta_keys: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_b_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressBuilderDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.mutation_evidence_preview && typeof row.mutation_evidence_preview === "object"
          ? row.mutation_evidence_preview
          : {};

      acc.total_rows += 1;
      if (String(preview.expected_target_status || "").trim() === "draft") {
        acc.expected_draft_count += 1;
      }
      acc.total_required_meta_keys += Number(preview.required_meta_key_count || 0);
      acc.total_optional_meta_keys += Number(preview.optional_meta_key_count || 0);
      return acc;
    },
    {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    mutation_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseBDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_b_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    mutation_evidence_preview_summary:
      simulator?.mutation_evidence_preview_summary &&
      typeof simulator.mutation_evidence_preview_summary === "object"
        ? simulator.mutation_evidence_preview_summary
        : {
            total_rows: 0,
            expected_draft_count: 0,
            total_required_meta_keys: 0,
            total_optional_meta_keys: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseBFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const phaseBGate =
    args.phaseBGate && typeof args.phaseBGate === "object" ? args.phaseBGate : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const planningArtifact =
    args.planningArtifact && typeof args.planningArtifact === "object"
      ? args.planningArtifact
      : {};
  const sequenceArtifact =
    args.sequenceArtifact && typeof args.sequenceArtifact === "object"
      ? args.sequenceArtifact
      : {};
  const mappingPrerequisiteArtifact =
    args.mappingPrerequisiteArtifact &&
    typeof args.mappingPrerequisiteArtifact === "object"
      ? args.mappingPrerequisiteArtifact
      : {};
  const mappingPlanArtifact =
    args.mappingPlanArtifact && typeof args.mappingPlanArtifact === "object"
      ? args.mappingPlanArtifact
      : {};
  const fieldMappingArtifact =
    args.fieldMappingArtifact && typeof args.fieldMappingArtifact === "object"
      ? args.fieldMappingArtifact
      : {};
  const dryRunArtifact =
    args.dryRunArtifact && typeof args.dryRunArtifact === "object"
      ? args.dryRunArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedAudit =
    args.normalizedAudit && typeof args.normalizedAudit === "object"
      ? args.normalizedAudit
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_b_final_operator_handoff",
    artifact_version: "v1",
    phase_b_enabled: phaseBPlan.enabled === true,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    phase_b_apply_requested: phaseBPlan.apply === true,
    requested_builder_post_types: Array.isArray(phaseBPlan.post_types)
      ? phaseBPlan.post_types
      : (
          Array.isArray(migration?.builder_assets?.post_types)
            ? migration.builder_assets.post_types
            : []
        ),
    phase_b_gate_status: String(phaseBGate.phase_b_gate_status || "").trim(),
    phase_b_readiness_status: String(readinessArtifact.phase_b_readiness_status || "").trim(),
    phase_b_graph_stable: readinessArtifact.phase_b_graph_stable === true,
    phase_b_planning_status: String(planningArtifact.planning_status || "").trim(),
    phase_b_sequence_status: String(sequenceArtifact.sequence_status || "").trim(),
    phase_b_mapping_gate_status: String(
      mappingPrerequisiteArtifact.mapping_gate_status || ""
    ).trim(),
    phase_b_mapping_plan_status: String(mappingPlanArtifact.mapping_plan_status || "").trim(),
    phase_b_field_mapping_status: String(
      fieldMappingArtifact.field_mapping_status || ""
    ).trim(),
    phase_b_dry_run_status: String(dryRunArtifact.dry_run_status || "").trim(),
    phase_b_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_b_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_b_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_b_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_totals:
      normalizedAudit?.dependency_totals &&
      typeof normalizedAudit.dependency_totals === "object"
        ? normalizedAudit.dependency_totals
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0
          },
    graph_summary:
      normalizedAudit?.dependency_graph_summary &&
      typeof normalizedAudit.dependency_graph_summary === "object"
        ? normalizedAudit.dependency_graph_summary
        : {
            edge_count: 0,
            unresolved_count: 0,
            relation_counts: {},
            unresolved_relation_counts: {}
          },
    family_summary: Array.isArray(normalizedAudit.family_summary)
      ? normalizedAudit.family_summary
      : [],
    planning_candidate_count: Number(planningArtifact.candidate_count || 0),
    planning_blocked_count: Number(planningArtifact.blocked_count || 0),
    mapping_ready_count: Number(mappingPrerequisiteArtifact.mapping_ready_count || 0),
    mapping_review_required_count: Number(
      mappingPrerequisiteArtifact.mapping_review_required_count || 0
    ),
    compatibility_review_required_count: Number(
      mappingPrerequisiteArtifact.compatibility_review_required_count || 0
    ),
    blocked_mapping_count: Number(mappingPrerequisiteArtifact.blocked_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseBGate.blocking_reasons) ? phaseBGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(planningArtifact.blocking_reasons)
        ? planningArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mappingPrerequisiteArtifact.blocking_reasons)
        ? mappingPrerequisiteArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.phase_b_graph_stable === true
        ? "review_stable_builder_candidates"
        : "resolve_builder_graph_instability",
      String(mappingPrerequisiteArtifact.mapping_gate_status || "").trim() ===
      "ready_for_mapping_planning"
        ? "review_mapping_plan"
        : "resolve_mapping_prerequisites",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_builder_mutation_execution"
        ? "approve_builder_mutation_trial"
        : "hold_builder_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_dry_run_execution_preview"
        : "no_dry_run_preview_available"
    ],
    readiness_artifact: readinessArtifact,
    planning_artifact: planningArtifact,
    sequence_artifact: sequenceArtifact,
    mapping_prerequisite_artifact: mappingPrerequisiteArtifact,
    mapping_plan_artifact: mappingPlanArtifact,
    field_mapping_artifact: fieldMappingArtifact,
    dry_run_artifact: dryRunArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

function resolveWordpressPhaseCPlan(payload = {}) {
  const migration = payload?.migration || {};
  const settings = migration.site_settings && typeof migration.site_settings === "object"
    ? migration.site_settings
    : {};

  return {
    enabled: settings.enabled === true,
    reconciliation_only:
      settings.reconciliation_only === undefined
        ? true
        : settings.reconciliation_only === true,
    apply: settings.apply === true,
    include_keys: Array.isArray(settings.include_keys)
      ? settings.include_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [
          "permalink_structure",
          "timezone_string",
          "language",
          "active_theme",
          "reading_settings",
          "writing_settings"
        ]
  };
}

function assertWordpressPhaseCPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }

  if (plan.apply === true && plan.reconciliation_only === true) {
    blockingReasons.push("phase_c_apply_conflicts_with_reconciliation_only");
  }

  if (!Array.isArray(plan.include_keys) || plan.include_keys.length === 0) {
    blockingReasons.push("phase_c_no_settings_keys_requested");
  }

  return {
    phase_c_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_c_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseCGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCPlanStatus =
    args.phaseCPlanStatus && typeof args.phaseCPlanStatus === "object"
      ? args.phaseCPlanStatus
      : {};
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object"
      ? args.phaseCPlan
      : {};

  const blockingReasons = [...(phaseCPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_c");
  }

  if (
    phaseCPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  return {
    phase_c_gate_status:
      blockingReasons.length === 0
        ? "ready_for_settings_inventory"
        : "blocked",
    phase_c_gate_ready: blockingReasons.length === 0,
    reconciliation_only: phaseCPlan.reconciliation_only === true,
    blocking_reasons: blockingReasons
  };
}

function normalizeWordpressSettingsInventoryRecord(args = {}) {
  return {
    setting_key: String(args.setting_key || "").trim(),
    source_value:
      args.source_value === undefined || args.source_value === null
        ? ""
        : args.source_value,
    destination_value:
      args.destination_value === undefined || args.destination_value === null
        ? ""
        : args.destination_value
  };
}

function classifyWordpressSettingReconciliationRow(row = {}) {
  const sourceValue = row?.source_value;
  const destinationValue = row?.destination_value;

  const sourceText =
    typeof sourceValue === "object" ? JSON.stringify(sourceValue) : String(sourceValue ?? "");
  const destinationText =
    typeof destinationValue === "object"
      ? JSON.stringify(destinationValue)
      : String(destinationValue ?? "");

  const same = sourceText === destinationText;

  return {
    ...row,
    reconciliation_status: same ? "aligned" : "diff_detected",
    reconciliation_action: same ? "no_change" : "review_and_reconcile"
  };
}

async function collectWordpressSiteSettingsInventory(args = {}) {
  const {
    wpContext = {},
    phaseCGate = {},
    phaseCPlan = {}
  } = args;

  if (phaseCGate.phase_c_gate_ready !== true) {
    return {
      phase_c_inventory_status: "blocked",
      inventory_rows: [],
      summary: {
        total_count: 0,
        aligned_count: 0,
        diff_count: 0
      },
      failures: [
        {
          code: "phase_c_settings_inventory_blocked",
          message: "Phase C settings inventory blocked by phase_c_gate.",
          blocking_reasons: phaseCGate.blocking_reasons || []
        }
      ]
    };
  }

  const includeKeys = new Set(phaseCPlan.include_keys || []);
  const sourceProfile = wpContext?.source || {};
  const destinationProfile = wpContext?.destination || {};

  const candidateRows = [];

  if (includeKeys.has("permalink_structure")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "permalink_structure",
        source_value: sourceProfile?.permalink_structure || "",
        destination_value: destinationProfile?.permalink_structure || ""
      })
    );
  }

  if (includeKeys.has("timezone_string")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "timezone_string",
        source_value: sourceProfile?.timezone_string || "",
        destination_value: destinationProfile?.timezone_string || ""
      })
    );
  }

  if (includeKeys.has("language")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "language",
        source_value: sourceProfile?.language || sourceProfile?.site_language || "",
        destination_value:
          destinationProfile?.language || destinationProfile?.site_language || ""
      })
    );
  }

  if (includeKeys.has("active_theme")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "active_theme",
        source_value: sourceProfile?.active_theme || "",
        destination_value: destinationProfile?.active_theme || ""
      })
    );
  }

  if (includeKeys.has("reading_settings")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "reading_settings",
        source_value: sourceProfile?.reading_settings || {},
        destination_value: destinationProfile?.reading_settings || {}
      })
    );
  }

  if (includeKeys.has("writing_settings")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "writing_settings",
        source_value: sourceProfile?.writing_settings || {},
        destination_value: destinationProfile?.writing_settings || {}
      })
    );
  }

  const inventoryRows = candidateRows.map(classifyWordpressSettingReconciliationRow);

  const summary = inventoryRows.reduce(
    (acc, row) => {
      acc.total_count += 1;
      if (String(row?.reconciliation_status || "").trim() === "aligned") {
        acc.aligned_count += 1;
      } else {
        acc.diff_count += 1;
      }
      return acc;
    },
    {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    }
  );

  return {
    phase_c_inventory_status: "completed",
    inventory_rows: inventoryRows,
    summary,
    failures: []
  };
}

function buildWordpressPhaseCInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_c_settings_inventory",
    artifact_version: "v1",
    phase_c_gate_status: String(gate.phase_c_gate_status || "").trim(),
    phase_c_inventory_status: String(inventory.phase_c_inventory_status || "").trim(),
    reconciliation_only: gate.reconciliation_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0
          },
    inventory_rows: Array.isArray(inventory.inventory_rows)
      ? inventory.inventory_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressSettingValueForDiff(settingKey = "", value = "") {
  const key = String(settingKey || "").trim();

  if (key === "permalink_structure") {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  if (key === "timezone_string" || key === "language" || key === "active_theme") {
    return String(value || "").trim().toLowerCase();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return JSON.stringify(sorted);
  }

  if (Array.isArray(value)) {
    return JSON.stringify([...value]);
  }

  return String(value ?? "").trim();
}

function classifyWordpressSettingReconciliationBucket(row = {}) {
  const key = String(row?.setting_key || "").trim();
  const sourceNormalized = normalizeWordpressSettingValueForDiff(
    key,
    row?.source_value
  );
  const destinationNormalized = normalizeWordpressSettingValueForDiff(
    key,
    row?.destination_value
  );

  const same = sourceNormalized === destinationNormalized;

  let bucket = "review_required";
  let bucketReason = "default_settings_review";

  if (same) {
    bucket = "already_aligned";
    bucketReason = "normalized_values_match";
  } else if (
    key === "permalink_structure" ||
    key === "timezone_string" ||
    key === "language"
  ) {
    bucket = "safe_reconcile_candidate";
    bucketReason = "core_setting_with_safe_reconciliation_path";
  } else if (key === "active_theme") {
    bucket = "environment_sensitive_review";
    bucketReason = "theme_setting_environment_sensitive";
  } else if (key === "reading_settings" || key === "writing_settings") {
    bucket = "structured_settings_review";
    bucketReason = "structured_settings_require_diff_review";
  }

  return {
    ...row,
    source_value_normalized: sourceNormalized,
    destination_value_normalized: destinationNormalized,
    diff_detected: !same,
    reconciliation_bucket: bucket,
    reconciliation_bucket_reason: bucketReason
  };
}

function buildWordpressPhaseCNormalizedDiff(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(classifyWordpressSettingReconciliationBucket);

  const summary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const bucket = String(row?.reconciliation_bucket || "").trim();
      if (bucket === "already_aligned") acc.already_aligned_count += 1;
      else if (bucket === "safe_reconcile_candidate") acc.safe_reconcile_candidate_count += 1;
      else if (bucket === "environment_sensitive_review") acc.environment_sensitive_review_count += 1;
      else if (bucket === "structured_settings_review") acc.structured_settings_review_count += 1;
      else acc.review_required_count += 1;

      if (row?.diff_detected === true) acc.diff_count += 1;
      else acc.aligned_count += 1;

      return acc;
    },
    {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    }
  );

  const buckets = {
    already_aligned: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "already_aligned"
    ),
    safe_reconcile_candidate: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "safe_reconcile_candidate"
    ),
    environment_sensitive_review: normalizedRows.filter(
      row =>
        String(row?.reconciliation_bucket || "").trim() ===
        "environment_sensitive_review"
    ),
    structured_settings_review: normalizedRows.filter(
      row =>
        String(row?.reconciliation_bucket || "").trim() ===
        "structured_settings_review"
    ),
    review_required: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "review_required"
    )
  };

  return {
    normalized_diff_rows: normalizedRows,
    diff_summary: summary,
    reconciliation_buckets: buckets
  };
}

function buildWordpressPhaseCDiffArtifact(args = {}) {
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_c_settings_diff",
    artifact_version: "v1",
    phase_c_gate_status: String(gate.phase_c_gate_status || "").trim(),
    reconciliation_only: gate.reconciliation_only === true,
    diff_summary:
      normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
        ? normalizedDiff.diff_summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0,
            already_aligned_count: 0,
            safe_reconcile_candidate_count: 0,
            environment_sensitive_review_count: 0,
            structured_settings_review_count: 0,
            review_required_count: 0
          },
    normalized_diff_rows: Array.isArray(normalizedDiff.normalized_diff_rows)
      ? normalizedDiff.normalized_diff_rows
      : [],
    reconciliation_buckets:
      normalizedDiff?.reconciliation_buckets &&
      typeof normalizedDiff.reconciliation_buckets === "object"
        ? normalizedDiff.reconciliation_buckets
        : {
            already_aligned: [],
            safe_reconcile_candidate: [],
            environment_sensitive_review: [],
            structured_settings_review: [],
            review_required: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseCReconciliationReadiness(args = {}) {
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};

  const summary =
    normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
      ? normalizedDiff.diff_summary
      : {};
  const buckets =
    normalizedDiff?.reconciliation_buckets &&
    typeof normalizedDiff.reconciliation_buckets === "object"
      ? normalizedDiff.reconciliation_buckets
      : {};

  const blockingReasons = [...(phaseCGate.blocking_reasons || [])];

  if (phaseCGate.phase_c_gate_ready !== true) {
    blockingReasons.push("phase_c_gate_not_ready");
  }

  if (phaseCPlan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }

  const environmentSensitiveCount = Array.isArray(buckets.environment_sensitive_review)
    ? buckets.environment_sensitive_review.length
    : 0;
  const structuredReviewCount = Array.isArray(buckets.structured_settings_review)
    ? buckets.structured_settings_review.length
    : 0;
  const reviewRequiredCount = Array.isArray(buckets.review_required)
    ? buckets.review_required.length
    : 0;
  const safeCandidateCount = Array.isArray(buckets.safe_reconcile_candidate)
    ? buckets.safe_reconcile_candidate.length
    : 0;

  if (environmentSensitiveCount > 0) {
    blockingReasons.push("environment_sensitive_settings_present");
  }
  if (structuredReviewCount > 0) {
    blockingReasons.push("structured_settings_review_present");
  }
  if (reviewRequiredCount > 0) {
    blockingReasons.push("general_settings_review_required");
  }

  const reconciliationReady = blockingReasons.length === 0;

  return {
    reconciliation_readiness_status: reconciliationReady
      ? "ready_for_safe_reconciliation"
      : "blocked_for_reconciliation",
    reconciliation_ready: reconciliationReady,
    safe_candidate_count: safeCandidateCount,
    environment_sensitive_count: environmentSensitiveCount,
    structured_review_count: structuredReviewCount,
    review_required_count: reviewRequiredCount,
    total_diff_count: Number(summary.diff_count || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseCSafeApplyCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 50));

  const buckets =
    normalizedDiff?.reconciliation_buckets &&
    typeof normalizedDiff.reconciliation_buckets === "object"
      ? normalizedDiff.reconciliation_buckets
      : {};

  if (readiness.reconciliation_ready !== true) {
    return {
      safe_apply_status: "blocked",
      candidate_count: 0,
      candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_c_reconciliation_not_ready"]
    };
  }

  const safeRows = Array.isArray(buckets.safe_reconcile_candidate)
    ? buckets.safe_reconcile_candidate
    : [];

  const candidates = safeRows.slice(0, limit).map(row => ({
    setting_key: String(row?.setting_key || "").trim(),
    source_value: row?.source_value ?? "",
    destination_value: row?.destination_value ?? "",
    source_value_normalized: row?.source_value_normalized ?? "",
    destination_value_normalized: row?.destination_value_normalized ?? "",
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    candidate_reason: "safe_reconcile_candidate"
  }));

  return {
    safe_apply_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseCReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeApplyCandidates =
    args.safeApplyCandidates && typeof args.safeApplyCandidates === "object"
      ? args.safeApplyCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_c_reconciliation_readiness",
    artifact_version: "v1",
    reconciliation_readiness_status: String(
      readiness.reconciliation_readiness_status || ""
    ).trim(),
    reconciliation_ready: readiness.reconciliation_ready === true,
    safe_candidate_count: Number(readiness.safe_candidate_count || 0),
    environment_sensitive_count: Number(readiness.environment_sensitive_count || 0),
    structured_review_count: Number(readiness.structured_review_count || 0),
    review_required_count: Number(readiness.review_required_count || 0),
    total_diff_count: Number(readiness.total_diff_count || 0),
    safe_apply_status: String(safeApplyCandidates.safe_apply_status || "").trim(),
    safe_apply_candidate_count: Number(safeApplyCandidates.candidate_count || 0),
    candidates: Array.isArray(safeApplyCandidates.candidates)
      ? safeApplyCandidates.candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeApplyCandidates.blocking_reasons)
        ? safeApplyCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressSettingReconciliationPayloadRow(row = {}) {
  const settingKey = String(row?.setting_key || "").trim();

  return {
    setting_key: settingKey,
    source_value: row?.source_value ?? "",
    destination_value: row?.destination_value ?? "",
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: "apply_source_value_to_destination",
    payload_shape: {
      key: settingKey,
      value: row?.source_value ?? "",
      mode: "safe_reconcile_candidate"
    }
  };
}

function buildWordpressPhaseCReconciliationPayloadPlanner(args = {}) {
  const safeApplyCandidates =
    args.safeApplyCandidates && typeof args.safeApplyCandidates === "object"
      ? args.safeApplyCandidates
      : {};

  if (String(safeApplyCandidates.safe_apply_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      payload_rows: [],
      blocking_reasons: Array.isArray(safeApplyCandidates.blocking_reasons)
        ? safeApplyCandidates.blocking_reasons
        : ["phase_c_safe_apply_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeApplyCandidates.candidates)
    ? safeApplyCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressSettingReconciliationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseCReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_c_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    payload_rows: Array.isArray(planner.payload_rows)
      ? planner.payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseCExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const settings = migration.site_settings && typeof migration.site_settings === "object"
    ? migration.site_settings
    : {};
  const execution = settings.execution && typeof settings.execution === "object"
    ? settings.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 25))
  };
}

function buildWordpressPhaseCExecutionGuard(args = {}) {
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseCPlan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }
  if (phaseCGate.phase_c_gate_ready !== true) {
    blockingReasons.push("phase_c_gate_not_ready");
  }
  if (readiness.reconciliation_ready !== true) {
    blockingReasons.push("phase_c_reconciliation_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_c_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_c_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_c_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseCPlan.reconciliation_only === true && phaseCPlan.apply === true) {
    blockingReasons.push("phase_c_plan_apply_conflicts_with_reconciliation_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_settings_reconciliation_execution"
      : "blocked_before_settings_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseCExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_c_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseCMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_c_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_c_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      setting_key: String(row?.setting_key || "").trim(),
      reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
      reconciliation_action: String(row?.reconciliation_action || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (String(baseRecord.reconciliation_bucket || "").trim() !== "safe_reconcile_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_safe_reconcile_bucket"
      });
      continue;
    }

    if (String(baseRecord.reconciliation_action || "").trim() !== "apply_source_value_to_destination") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_reconciliation_action"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_reconcile_candidate_ready_for_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 25))
  );

  return {
    selector_status: "ready",
    selected_count: limitedSelected.length,
    rejected_count: rejected.length,
    selected_candidates: limitedSelected,
    rejected_candidates: rejected,
    blocking_reasons: []
  };
}

function buildWordpressPhaseCMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_c_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_candidates: Array.isArray(selector.selected_candidates)
      ? selector.selected_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressSettingMutationPayloadFromCandidate(row = {}) {
  const settingKey = String(row?.setting_key || "").trim();
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    setting_key: settingKey,
    mutation_mode: "safe_reconciliation",
    target_scope: "destination_site_setting",
    payload: {
      key: settingKey,
      value: Object.prototype.hasOwnProperty.call(payloadShape, "value")
        ? payloadShape.value
        : "",
      mode: String(payloadShape.mode || "safe_reconcile_candidate").trim()
    }
  };
}

function buildWordpressPhaseCMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_c_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    setting_key: String(row?.setting_key || "").trim(),
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: String(row?.reconciliation_action || "").trim(),
    payload_reason: "composed_from_safe_reconcile_candidate",
    mutation_payload: buildWordpressSettingMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseCMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_c_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    composed_payloads: Array.isArray(composer.composed_payloads)
      ? composer.composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressSettingDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  return {
    setting_key: String(row?.setting_key || "").trim(),
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: String(row?.reconciliation_action || "").trim(),
    dry_run_result: "simulated_ready",
    reconciliation_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_apply_key: String(payload.key || "").trim(),
      expected_apply_mode: String(payload.mode || "").trim(),
      expected_source_value_applied: Object.prototype.hasOwnProperty.call(payload, "value")
    },
    preview_payload: mutationPayload
  };
}

function buildWordpressPhaseCDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      reconciliation_evidence_preview_summary: {
        total_rows: 0,
        safe_reconcile_count: 0,
        expected_apply_key_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_c_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressSettingDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.reconciliation_evidence_preview &&
        typeof row.reconciliation_evidence_preview === "object"
          ? row.reconciliation_evidence_preview
          : {};

      acc.total_rows += 1;
      if (String(preview.expected_apply_mode || "").trim() === "safe_reconcile_candidate") {
        acc.safe_reconcile_count += 1;
      }
      if (String(preview.expected_apply_key || "").trim()) {
        acc.expected_apply_key_count += 1;
      }
      return acc;
    },
    {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    reconciliation_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseCDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_c_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    reconciliation_evidence_preview_summary:
      simulator?.reconciliation_evidence_preview_summary &&
      typeof simulator.reconciliation_evidence_preview_summary === "object"
        ? simulator.reconciliation_evidence_preview_summary
        : {
            total_rows: 0,
            safe_reconcile_count: 0,
            expected_apply_key_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseCFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const diffArtifact =
    args.diffArtifact && typeof args.diffArtifact === "object"
      ? args.diffArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const payloadArtifact =
    args.payloadArtifact && typeof args.payloadArtifact === "object"
      ? args.payloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_c_final_operator_handoff",
    artifact_version: "v1",
    phase_c_enabled: phaseCPlan.enabled === true,
    phase_c_reconciliation_only: phaseCPlan.reconciliation_only === true,
    phase_c_apply_requested: phaseCPlan.apply === true,
    requested_settings_keys: Array.isArray(phaseCPlan.include_keys)
      ? phaseCPlan.include_keys
      : (
          Array.isArray(migration?.site_settings?.include_keys)
            ? migration.site_settings.include_keys
            : []
        ),
    phase_c_gate_status: String(phaseCGate.phase_c_gate_status || "").trim(),
    phase_c_inventory_status: String(inventoryArtifact.phase_c_inventory_status || "").trim(),
    phase_c_diff_status: String(diffArtifact.phase_c_gate_status || "").trim(),
    phase_c_reconciliation_readiness_status: String(
      readinessArtifact.reconciliation_readiness_status || ""
    ).trim(),
    phase_c_safe_apply_status: String(readinessArtifact.safe_apply_status || "").trim(),
    phase_c_payload_planner_status: String(
      payloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_c_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_c_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_c_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_c_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0
          },
    diff_summary:
      normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
        ? normalizedDiff.diff_summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0,
            already_aligned_count: 0,
            safe_reconcile_candidate_count: 0,
            environment_sensitive_review_count: 0,
            structured_settings_review_count: 0,
            review_required_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_apply_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseCGate.blocking_reasons) ? phaseCGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(payloadArtifact.blocking_reasons)
        ? payloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.reconciliation_ready === true
        ? "review_safe_reconciliation_candidates"
        : "resolve_settings_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_settings_reconciliation_execution"
        ? "approve_settings_mutation_trial"
        : "hold_settings_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_settings_dry_run_preview"
        : "no_settings_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    diff_artifact: diffArtifact,
    readiness_artifact: readinessArtifact,
    payload_artifact: payloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

const WORDPRESS_PHASE_D_FORM_TYPES = new Set([
  "wpcf7_contact_form",
  "wpforms",
  "fluentform",
  "gf_form",
  "elementor_form",
  "formidable_form"
]);

function normalizeWordpressFormType(value = "") {
  return normalizeWordpressPhaseAType(value);
}

function isWordpressPhaseDFormType(value = "") {
  return WORDPRESS_PHASE_D_FORM_TYPES.has(normalizeWordpressFormType(value));
}

function resolveWordpressPhaseDPlan(payload = {}) {
  const migration = payload?.migration || {};
  const forms = migration.forms_integrations && typeof migration.forms_integrations === "object"
    ? migration.forms_integrations
    : {};

  const requestedTypes = Array.isArray(forms.post_types)
    ? forms.post_types.map(x => normalizeWordpressFormType(x)).filter(Boolean)
    : [
        "wpcf7_contact_form",
        "wpforms",
        "fluentform",
        "gf_form",
        "elementor_form"
      ];

  return {
    enabled: forms.enabled === true,
    inventory_only:
      forms.inventory_only === undefined ? true : forms.inventory_only === true,
    apply: forms.apply === true,
    post_types: requestedTypes.filter(isWordpressPhaseDFormType),
    include_integrations:
      forms.include_integrations === undefined
        ? true
        : forms.include_integrations === true,
    max_items_per_type: Math.max(1, toPositiveInt(forms.max_items_per_type, 250))
  };
}

function assertWordpressPhaseDPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_d_apply_conflicts_with_inventory_only");
  }

  if (!Array.isArray(plan.post_types) || plan.post_types.length === 0) {
    blockingReasons.push("phase_d_no_supported_form_types");
  }

  return {
    phase_d_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_d_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseDGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDPlanStatus =
    args.phaseDPlanStatus && typeof args.phaseDPlanStatus === "object"
      ? args.phaseDPlanStatus
      : {};

  const blockingReasons = [...(phaseDPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_d");
  }

  if (
    phaseDPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseDPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  return {
    phase_d_gate_status:
      blockingReasons.length === 0 ? "ready_for_forms_inventory" : "blocked",
    phase_d_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseDPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

function inferWordpressFormIntegrationSignals(item = {}) {
  const raw = JSON.stringify(item || {});

  return {
    has_email_routing:
      raw.includes("mail") || raw.includes("email") || raw.includes("recipient"),
    has_webhook:
      raw.includes("webhook") || raw.includes("zapier") || raw.includes("make.com"),
    has_recaptcha:
      raw.includes("recaptcha") || raw.includes("captcha"),
    has_smtp_dependency:
      raw.includes("smtp") || raw.includes("mailer"),
    has_crm_integration:
      raw.includes("hubspot") ||
      raw.includes("salesforce") ||
      raw.includes("mailchimp") ||
      raw.includes("crm"),
    has_payment_integration:
      raw.includes("stripe") ||
      raw.includes("paypal") ||
      raw.includes("payment"),
    has_file_upload:
      raw.includes("file") && raw.includes("upload"),
    has_conditional_logic:
      raw.includes("conditional") || raw.includes("logic")
  };
}

function classifyWordpressFormInventoryRow(args = {}) {
  const item = args.item || {};
  const postType = normalizeWordpressFormType(args.postType);
  const integrations = inferWordpressFormIntegrationSignals(item);
  const integrationCount = Object.values(integrations).filter(v => v === true).length;

  return {
    post_type: postType,
    source_id: Number.isFinite(Number(item?.id)) ? Number(item.id) : null,
    slug: String(item?.slug || "").trim(),
    title: String(
      item?.title?.rendered ||
      item?.title ||
      item?.name ||
      item?.slug ||
      ""
    ).trim(),
    status: String(item?.status || "").trim(),
    integration_signals: integrations,
    integration_count: integrationCount,
    inventory_classification:
      integrationCount > 0 ? "integration_review_required" : "simple_form_candidate",
    migration_candidate: true
  };
}

async function runWordpressFormsIntegrationsInventory(args = {}) {
  const {
    wpContext = {},
    phaseDPlan = {},
    phaseDGate = {}
  } = args;

  if (phaseDGate.phase_d_gate_ready !== true) {
    return {
      phase_d_inventory_status: "blocked",
      inventory_rows: [],
      inventory_counts: [],
      failures: [
        {
          code: "phase_d_forms_inventory_blocked",
          message: "Phase D forms/integrations inventory blocked by phase_d_gate.",
          blocking_reasons: phaseDGate.blocking_reasons || []
        }
      ]
    };
  }

  const inventoryRows = [];
  const inventoryCounts = [];
  const failures = [];

  for (const postType of phaseDPlan.post_types || []) {
    try {
      const itemsRaw = await listWordpressEntriesByType({
        siteRef: wpContext.source,
        postType,
        authRequired: false
      });

      const items = itemsRaw.slice(0, phaseDPlan.max_items_per_type);

      for (const item of items) {
        inventoryRows.push(
          classifyWordpressFormInventoryRow({
            postType,
            item
          })
        );
      }

      inventoryCounts.push({
        post_type: postType,
        discovered_count: itemsRaw.length,
        retained_count: items.length,
        inventory_only: phaseDPlan.inventory_only === true
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        code: err?.code || "wordpress_forms_inventory_failed",
        message: err?.message || "WordPress forms/integrations inventory failed."
      });
    }
  }

  return {
    phase_d_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    inventory_rows: inventoryRows,
    inventory_counts: inventoryCounts,
    failures
  };
}

function buildWordpressPhaseDInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_d_forms_integrations_inventory",
    artifact_version: "v1",
    phase_d_gate_status: String(gate.phase_d_gate_status || "").trim(),
    phase_d_inventory_status: String(inventory.phase_d_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    inventory_counts: Array.isArray(inventory.inventory_counts)
      ? inventory.inventory_counts
      : [],
    inventory_rows: Array.isArray(inventory.inventory_rows)
      ? inventory.inventory_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressFormIntegrationSignals(signals = {}) {
  const safeSignals =
    signals && typeof signals === "object" && !Array.isArray(signals)
      ? signals
      : {};

  return {
    has_email_routing: safeSignals.has_email_routing === true,
    has_webhook: safeSignals.has_webhook === true,
    has_recaptcha: safeSignals.has_recaptcha === true,
    has_smtp_dependency: safeSignals.has_smtp_dependency === true,
    has_crm_integration: safeSignals.has_crm_integration === true,
    has_payment_integration: safeSignals.has_payment_integration === true,
    has_file_upload: safeSignals.has_file_upload === true,
    has_conditional_logic: safeSignals.has_conditional_logic === true
  };
}

function classifyWordpressFormMigrationStrategy(row = {}) {
  const postType = normalizeWordpressFormType(row?.post_type || "");
  const signals = normalizeWordpressFormIntegrationSignals(row?.integration_signals || {});

  let strategyScore = 0;
  const reasons = [];

  if (signals.has_email_routing) {
    strategyScore += 1;
    reasons.push("email_routing_present");
  }
  if (signals.has_webhook) {
    strategyScore += 2;
    reasons.push("webhook_present");
  }
  if (signals.has_recaptcha) {
    strategyScore += 2;
    reasons.push("recaptcha_present");
  }
  if (signals.has_smtp_dependency) {
    strategyScore += 2;
    reasons.push("smtp_dependency_present");
  }
  if (signals.has_crm_integration) {
    strategyScore += 3;
    reasons.push("crm_integration_present");
  }
  if (signals.has_payment_integration) {
    strategyScore += 4;
    reasons.push("payment_integration_present");
  }
  if (signals.has_file_upload) {
    strategyScore += 2;
    reasons.push("file_upload_present");
  }
  if (signals.has_conditional_logic) {
    strategyScore += 2;
    reasons.push("conditional_logic_present");
  }

  if (postType === "elementor_form") {
    strategyScore += 2;
    reasons.push("elementor_form_type");
  }
  if (postType === "gf_form") {
    strategyScore += 2;
    reasons.push("gravity_forms_type");
  }

  let migration_strategy = "simple_migrate_candidate";
  let migration_strategy_reason = "low_complexity_form";

  if (strategyScore >= 8) {
    migration_strategy = "rebuild_required";
    migration_strategy_reason = "high_integration_complexity";
  } else if (strategyScore >= 4) {
    migration_strategy = "reviewed_migrate_or_rebuild";
    migration_strategy_reason = "medium_integration_complexity";
  }

  if (signals.has_payment_integration) {
    migration_strategy = "rebuild_required";
    migration_strategy_reason = "payment_integrations_not_safe_for_direct_migration";
  }

  return {
    normalized_integration_signals: signals,
    integration_strategy_score: strategyScore,
    integration_strategy_reasons: reasons,
    migration_strategy,
    migration_strategy_reason
  };
}

function buildWordpressPhaseDNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(row => {
    const strategy = classifyWordpressFormMigrationStrategy(row);
    return {
      ...row,
      integration_signals: strategy.normalized_integration_signals,
      integration_strategy_score: strategy.integration_strategy_score,
      integration_strategy_reasons: strategy.integration_strategy_reasons,
      migration_strategy: strategy.migration_strategy,
      migration_strategy_reason: strategy.migration_strategy_reason
    };
  });

  const summary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const strategy = String(row?.migration_strategy || "").trim();
      if (strategy === "simple_migrate_candidate") acc.simple_migrate_candidate_count += 1;
      else if (strategy === "reviewed_migrate_or_rebuild") acc.reviewed_migrate_or_rebuild_count += 1;
      else if (strategy === "rebuild_required") acc.rebuild_required_count += 1;

      return acc;
    },
    {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    }
  );

  const strategy_buckets = {
    simple_migrate_candidate: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "simple_migrate_candidate"
    ),
    reviewed_migrate_or_rebuild: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "reviewed_migrate_or_rebuild"
    ),
    rebuild_required: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "rebuild_required"
    )
  };

  return {
    normalized_inventory_rows: normalizedRows,
    strategy_summary: summary,
    strategy_buckets
  };
}

function buildWordpressPhaseDNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_d_forms_integrations_strategy",
    artifact_version: "v1",
    phase_d_gate_status: String(gate.phase_d_gate_status || "").trim(),
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            simple_migrate_candidate_count: 0,
            reviewed_migrate_or_rebuild_count: 0,
            rebuild_required_count: 0
          },
    normalized_inventory_rows: Array.isArray(normalizedInventory.normalized_inventory_rows)
      ? normalizedInventory.normalized_inventory_rows
      : [],
    strategy_buckets:
      normalizedInventory?.strategy_buckets &&
      typeof normalizedInventory.strategy_buckets === "object"
        ? normalizedInventory.strategy_buckets
        : {
            simple_migrate_candidate: [],
            reviewed_migrate_or_rebuild: [],
            rebuild_required: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseDReadinessGate(args = {}) {
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const strategySummary =
    normalizedInventory?.strategy_summary &&
    typeof normalizedInventory.strategy_summary === "object"
      ? normalizedInventory.strategy_summary
      : {};
  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  const blockingReasons = [...(phaseDGate.blocking_reasons || [])];

  if (phaseDPlan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }

  const rebuildRequiredCount = Number(
    strategySummary.rebuild_required_count || 0
  );
  const reviewedCount = Number(
    strategySummary.reviewed_migrate_or_rebuild_count || 0
  );
  const simpleCount = Number(
    strategySummary.simple_migrate_candidate_count || 0
  );

  if (rebuildRequiredCount > 0) {
    blockingReasons.push("rebuild_required_integrations_present");
  }

  const readiness = blockingReasons.length === 0;

  const safeCandidates = Array.isArray(strategyBuckets.simple_migrate_candidate)
    ? strategyBuckets.simple_migrate_candidate
    : [];

  return {
    readiness_status: readiness
      ? "ready_for_safe_forms_migration"
      : "blocked_for_forms_migration",
    readiness_ready: readiness,
    simple_migrate_candidate_count: simpleCount,
    reviewed_migrate_or_rebuild_count: reviewedCount,
    rebuild_required_count: rebuildRequiredCount,
    safe_candidate_count: safeCandidates.length,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseDSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 50));

  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_d_readiness_not_ready"]
    };
  }

  const candidates = (
    Array.isArray(strategyBuckets.simple_migrate_candidate)
      ? strategyBuckets.simple_migrate_candidate
      : []
  )
    .slice(0, limit)
    .map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      inventory_classification: String(row?.inventory_classification || "").trim(),
      candidate_reason: "simple_migrate_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseDReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_d_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    simple_migrate_candidate_count: Number(
      readiness.simple_migrate_candidate_count || 0
    ),
    reviewed_migrate_or_rebuild_count: Number(
      readiness.reviewed_migrate_or_rebuild_count || 0
    ),
    rebuild_required_count: Number(readiness.rebuild_required_count || 0),
    safe_candidate_count: Number(readiness.safe_candidate_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidates: Array.isArray(safeCandidates.candidates)
      ? safeCandidates.candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressFormSafeMigrationPayloadRow(row = {}) {
  const postType = String(row?.post_type || "").trim();

  return {
    post_type: postType,
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    inventory_classification: String(row?.inventory_classification || "").trim(),
    payload_mode: "safe_form_migration_candidate",
    payload_shape: {
      post_type: postType,
      title: "preserve_from_source",
      slug: "preserve_from_source",
      status: "draft",
      content: "preserve_from_source",
      integrations: {
        email_routing: "preserve_if_supported",
        webhook: "review_if_present",
        recaptcha: "review_if_present",
        smtp: "environment_rebind_required",
        crm: "review_if_present",
        payment: "not_allowed_in_safe_candidates",
        file_upload: "review_if_present",
        conditional_logic: "preserve_if_supported"
      }
    }
  };
}

function buildWordpressPhaseDMigrationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_d_safe_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeCandidates.candidates)
    ? safeCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressFormSafeMigrationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseDMigrationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_d_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    payload_rows: Array.isArray(planner.payload_rows)
      ? planner.payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseDExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const forms = migration.forms_integrations && typeof migration.forms_integrations === "object"
    ? migration.forms_integrations
    : {};
  const execution = forms.execution && typeof forms.execution === "object"
    ? forms.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 25))
  };
}

function buildWordpressPhaseDExecutionGuard(args = {}) {
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseDPlan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }
  if (phaseDGate.phase_d_gate_ready !== true) {
    blockingReasons.push("phase_d_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_d_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_d_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_d_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_d_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseDPlan.inventory_only === true && phaseDPlan.apply === true) {
    blockingReasons.push("phase_d_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_forms_migration_execution"
      : "blocked_before_forms_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseDExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_d_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseDMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_d_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_d_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      payload_mode: String(row?.payload_mode || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (String(baseRecord.migration_strategy || "").trim() !== "simple_migrate_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_simple_migrate_strategy"
      });
      continue;
    }

    if (String(baseRecord.payload_mode || "").trim() !== "safe_form_migration_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_payload_mode"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_form_migration_candidate_ready_for_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 25))
  );

  return {
    selector_status: "ready",
    selected_count: limitedSelected.length,
    rejected_count: rejected.length,
    selected_candidates: limitedSelected,
    rejected_candidates: rejected,
    blocking_reasons: []
  };
}

function buildWordpressPhaseDMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_d_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_candidates: Array.isArray(selector.selected_candidates)
      ? selector.selected_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressFormMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};
  const integrations =
    payloadShape?.integrations && typeof payloadShape.integrations === "object"
      ? payloadShape.integrations
      : {};

  return {
    post_type: String(row?.post_type || "").trim(),
    mutation_mode: "safe_form_migration",
    target_scope: "destination_form_entity",
    payload: {
      title: Object.prototype.hasOwnProperty.call(payloadShape, "title")
        ? payloadShape.title
        : "preserve_from_source",
      slug: Object.prototype.hasOwnProperty.call(payloadShape, "slug")
        ? payloadShape.slug
        : "preserve_from_source",
      status: Object.prototype.hasOwnProperty.call(payloadShape, "status")
        ? payloadShape.status
        : "draft",
      content: Object.prototype.hasOwnProperty.call(payloadShape, "content")
        ? payloadShape.content
        : "preserve_from_source",
      integrations: {
        email_routing: String(integrations.email_routing || "").trim(),
        webhook: String(integrations.webhook || "").trim(),
        recaptcha: String(integrations.recaptcha || "").trim(),
        smtp: String(integrations.smtp || "").trim(),
        crm: String(integrations.crm || "").trim(),
        payment: String(integrations.payment || "").trim(),
        file_upload: String(integrations.file_upload || "").trim(),
        conditional_logic: String(integrations.conditional_logic || "").trim()
      }
    }
  };
}

function buildWordpressPhaseDMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_d_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_reason: "composed_from_safe_form_migration_candidate",
    mutation_payload: buildWordpressFormMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseDMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_d_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    composed_payloads: Array.isArray(composer.composed_payloads)
      ? composer.composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressFormDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};
  const integrations =
    payload?.integrations && typeof payload.integrations === "object"
      ? payload.integrations
      : {};

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    dry_run_result: "simulated_ready",
    integration_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_target_status: String(payload.status || "").trim(),
      expected_title_mode: String(payload.title || "").trim(),
      expected_slug_mode: String(payload.slug || "").trim(),
      expected_content_mode: String(payload.content || "").trim(),
      integrations_preview: {
        email_routing: String(integrations.email_routing || "").trim(),
        webhook: String(integrations.webhook || "").trim(),
        recaptcha: String(integrations.recaptcha || "").trim(),
        smtp: String(integrations.smtp || "").trim(),
        crm: String(integrations.crm || "").trim(),
        payment: String(integrations.payment || "").trim(),
        file_upload: String(integrations.file_upload || "").trim(),
        conditional_logic: String(integrations.conditional_logic || "").trim()
      }
    },
    preview_payload: mutationPayload
  };
}

function buildWordpressPhaseDDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      integration_evidence_preview_summary: {
        total_rows: 0,
        expected_draft_count: 0,
        safe_form_migration_count: 0,
        smtp_rebind_required_count: 0,
        webhook_review_count: 0,
        recaptcha_review_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_d_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressFormDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.integration_evidence_preview &&
        typeof row.integration_evidence_preview === "object"
          ? row.integration_evidence_preview
          : {};
      const integrations =
        preview?.integrations_preview &&
        typeof preview.integrations_preview === "object"
          ? preview.integrations_preview
          : {};

      acc.total_rows += 1;

      if (String(preview.expected_target_status || "").trim() === "draft") {
        acc.expected_draft_count += 1;
      }
      if (String(preview.mutation_mode || "").trim() === "safe_form_migration") {
        acc.safe_form_migration_count += 1;
      }
      if (String(integrations.smtp || "").trim() === "environment_rebind_required") {
        acc.smtp_rebind_required_count += 1;
      }
      if (String(integrations.webhook || "").trim() === "review_if_present") {
        acc.webhook_review_count += 1;
      }
      if (String(integrations.recaptcha || "").trim() === "review_if_present") {
        acc.recaptcha_review_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    integration_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseDDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_d_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    integration_evidence_preview_summary:
      simulator?.integration_evidence_preview_summary &&
      typeof simulator.integration_evidence_preview_summary === "object"
        ? simulator.integration_evidence_preview_summary
        : {
            total_rows: 0,
            expected_draft_count: 0,
            safe_form_migration_count: 0,
            smtp_rebind_required_count: 0,
            webhook_review_count: 0,
            recaptcha_review_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseBNormalizedAudit(args = {}) {
  const auditRows = Array.isArray(args.auditRows) ? args.auditRows : [];

  const normalizedAuditRows = auditRows.map(row => {
    const risk = classifyWordpressBuilderDependencyRisk(row);
    const familyAndBucket = classifyWordpressBuilderMigrationBucket({
      ...row,
      dependency_risk_class: risk.dependency_risk_class,
      audit_classification: row?.audit_classification
    });

    return {
      ...row,
      dependency_flags: risk.normalized_dependency_flags,
      dependency_risk_score: risk.dependency_risk_score,
      dependency_risk_class: risk.dependency_risk_class,
      dependency_risk_reasons: risk.dependency_risk_reasons,
      asset_family: familyAndBucket.asset_family,
      migration_bucket: familyAndBucket.migration_bucket,
      migration_bucket_reason: familyAndBucket.migration_bucket_reason,
      phase_b_migration_readiness:
        risk.dependency_risk_class === "low"
          ? "candidate_for_later_migration"
          : "dependency_audit_required"
    };
  });

  const dependencySummary = buildWordpressPhaseBDependencySummary(normalizedAuditRows);
  const familySummary = buildWordpressPhaseBFamilySummary(normalizedAuditRows);
  const migrationBuckets = buildWordpressPhaseBMigrationBuckets(normalizedAuditRows);
  const crossReferenceSummary = summarizeWordpressBuilderCrossReferences(normalizedAuditRows);
  const referenceIndex = buildWordpressBuilderReferenceIndex(normalizedAuditRows);
  const dependencyGraph = buildWordpressBuilderDependencyEdges(
    normalizedAuditRows,
    referenceIndex
  );
  const dependencyGraphSummary = summarizeWordpressBuilderDependencyGraph({
    edges: dependencyGraph.edges,
    unresolved: dependencyGraph.unresolved
  });

  const totals = normalizedAuditRows.reduce(
    (acc, row) => {
      const riskClass = String(row?.dependency_risk_class || "").trim();
      acc.total_count += 1;
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;
      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    }
  );

  return {
    normalized_audit_rows: normalizedAuditRows,
    dependency_summary: dependencySummary,
    dependency_totals: totals,
    family_summary: familySummary,
    migration_buckets: migrationBuckets,
    cross_reference_summary: crossReferenceSummary,
    dependency_reference_index: referenceIndex,
    dependency_graph_edges: dependencyGraph.edges,
    dependency_graph_unresolved: dependencyGraph.unresolved,
    dependency_graph_summary: dependencyGraphSummary
  };
}

function isTransientWordpressRetryableError(err = {}, retryPolicy = {}) {
  const status = Number(err?.status || err?.http_status || err?.statusCode);
  const code = String(err?.code || err?.error_code || "").trim();

  if (
    Number.isFinite(status) &&
    Array.isArray(retryPolicy.retry_on_statuses) &&
    retryPolicy.retry_on_statuses.includes(status)
  ) {
    return true;
  }

  if (
    code &&
    Array.isArray(retryPolicy.retry_on_codes) &&
    retryPolicy.retry_on_codes.includes(code)
  ) {
    return true;
  }

  return false;
}

function buildWordpressRetryDelayMs(attemptNumber = 1, retryPolicy = {}) {
  const base = Math.max(0, Number(retryPolicy.base_delay_ms || 0));
  if (attemptNumber <= 1) return 0;
  return base * Math.pow(2, attemptNumber - 2);
}

async function runWithWordpressSelectiveRetry(operation, retryPolicy = {}, meta = {}) {
  const attempts = [];
  const maxAttempts = Math.max(1, Number(retryPolicy.max_attempts || 1));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      attempts.push({
        attempt,
        ok: true
      });

      return {
        ok: true,
        result,
        attempts,
        final_attempt: attempt,
        retry_used: attempt > 1,
        retry_domain: meta.retry_domain || ""
      };
    } catch (err) {
      const retryable =
        !!retryPolicy.retry_enabled &&
        attempt < maxAttempts &&
        isTransientWordpressRetryableError(err, retryPolicy);

      attempts.push({
        attempt,
        ok: false,
        retryable,
        code: err?.code || err?.error_code || "",
        status: Number(err?.status || err?.http_status || err?.statusCode) || null,
        message: err?.message || ""
      });

      if (!retryable) {
        err.wordpress_retry_attempts = attempts;
        err.wordpress_retry_exhausted = attempt >= maxAttempts;
        throw err;
      }

      const delayMs = buildWordpressRetryDelayMs(attempt, retryPolicy);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  const err = new Error("WordPress selective retry exhausted.");
  err.code = "wordpress_retry_exhausted";
  err.wordpress_retry_attempts = attempts;
  err.wordpress_retry_exhausted = true;
  throw err;
}

function isWordpressHierarchicalType(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);
  return normalized === "page" || normalized === "category";
}

function extractWordpressSourceReferenceMap(item = {}, postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);

  return {
    source_id: item?.id ?? null,
    source_slug: String(item?.slug || "").trim(),
    source_post_type: normalized,
    source_parent_id:
      isWordpressHierarchicalType(normalized) && Number.isFinite(Number(item?.parent))
        ? Number(item.parent)
        : null,
    source_category_ids:
      normalized === "post" && Array.isArray(item?.categories)
        ? item.categories.map(x => Number(x)).filter(Number.isFinite)
        : [],
    source_tag_ids:
      normalized === "post" && Array.isArray(item?.tags)
        ? item.tags.map(x => Number(x)).filter(Number.isFinite)
        : [],
    source_featured_media_id:
      (normalized === "post" || normalized === "page") &&
      Number.isFinite(Number(item?.featured_media))
        ? Number(item.featured_media)
        : null
  };
}

function ensureWordpressPhaseAState(mutationPlan = {}) {
  if (!mutationPlan || typeof mutationPlan !== "object") {
    return {
      taxonomy_id_map: {
        category: {},
        tag: {}
      },
      hierarchical_id_map: {
        page: {},
        category: {}
      },
      deferred_parent_links: [],
      deferred_taxonomy_links: [],
      deferred_featured_media_links: [],
      processed_reference_maps: []
    };
  }

  if (
    !mutationPlan.wordpress_phase_a_state ||
    typeof mutationPlan.wordpress_phase_a_state !== "object" ||
    Array.isArray(mutationPlan.wordpress_phase_a_state)
  ) {
    mutationPlan.wordpress_phase_a_state = {};
  }

  const state = mutationPlan.wordpress_phase_a_state;

  if (!state.taxonomy_id_map || typeof state.taxonomy_id_map !== "object" || Array.isArray(state.taxonomy_id_map)) {
    state.taxonomy_id_map = {};
  }
  if (!state.taxonomy_id_map.category || typeof state.taxonomy_id_map.category !== "object" || Array.isArray(state.taxonomy_id_map.category)) {
    state.taxonomy_id_map.category = {};
  }
  if (!state.taxonomy_id_map.tag || typeof state.taxonomy_id_map.tag !== "object" || Array.isArray(state.taxonomy_id_map.tag)) {
    state.taxonomy_id_map.tag = {};
  }

  if (!state.hierarchical_id_map || typeof state.hierarchical_id_map !== "object" || Array.isArray(state.hierarchical_id_map)) {
    state.hierarchical_id_map = {};
  }
  if (!state.hierarchical_id_map.page || typeof state.hierarchical_id_map.page !== "object" || Array.isArray(state.hierarchical_id_map.page)) {
    state.hierarchical_id_map.page = {};
  }
  if (!state.hierarchical_id_map.category || typeof state.hierarchical_id_map.category !== "object" || Array.isArray(state.hierarchical_id_map.category)) {
    state.hierarchical_id_map.category = {};
  }

  if (!Array.isArray(state.deferred_parent_links)) {
    state.deferred_parent_links = [];
  }
  if (!Array.isArray(state.deferred_taxonomy_links)) {
    state.deferred_taxonomy_links = [];
  }
  if (!Array.isArray(state.deferred_featured_media_links)) {
    state.deferred_featured_media_links = [];
  }
  if (!Array.isArray(state.processed_reference_maps)) {
    state.processed_reference_maps = [];
  }

  return state;
}

function rememberWordpressDestinationReference(state, args = {}) {
  const postType = normalizeWordpressPhaseAType(args.postType);
  const sourceId = Number(args.sourceId);
  const destinationId = Number(args.destinationId);

  if (!Number.isFinite(sourceId) || !Number.isFinite(destinationId)) return;

  if (postType === "category" || postType === "tag") {
    state.taxonomy_id_map[postType][String(sourceId)] = destinationId;
  }

  if (postType === "page" || postType === "category") {
    state.hierarchical_id_map[postType][String(sourceId)] = destinationId;
  }
}

function buildDeferredWordpressReferencePlan(state, args = {}) {
  const postType = normalizeWordpressPhaseAType(args.postType);
  const item = args.item || {};
  const destinationId = Number(args.destinationId);
  const postTypeCollection = normalizeWordpressCollectionSlug(
    args.postTypeCollection || args.destinationCollectionSlug || args.postType
  );
  const destinationCollection = String(
    args.destinationCollectionSlug || args.postTypeCollection || postTypeCollection || ""
  ).trim();
  const refMap = extractWordpressSourceReferenceMap(item, postType);

  state.processed_reference_maps.push(refMap);

  if (Number.isFinite(destinationId) && Number.isFinite(refMap.source_id)) {
    rememberWordpressDestinationReference(state, {
      postType,
      sourceId: refMap.source_id,
      destinationId
    });
  }

  if (Number.isFinite(destinationId) && Number.isFinite(refMap.source_parent_id)) {
    state.deferred_parent_links.push({
      post_type: postType,
      post_type_collection: postTypeCollection,
      destination_id: destinationId,
      source_parent_id: refMap.source_parent_id
    });
  }

  if (postType === "post" && Number.isFinite(destinationId)) {
    state.deferred_taxonomy_links.push({
      post_type: postType,
      destination_collection: destinationCollection || postTypeCollection || "posts",
      post_type_collection: postTypeCollection || "posts",
      destination_id: destinationId,
      source_category_ids: refMap.source_category_ids,
      source_tag_ids: refMap.source_tag_ids
    });
  }

  if (
    (postType === "post" || postType === "page") &&
    Number.isFinite(destinationId) &&
    Number.isFinite(refMap.source_featured_media_id)
  ) {
    state.deferred_featured_media_links.push({
      post_type: postType,
      destination_collection:
        destinationCollection || postTypeCollection || normalizeWordpressCollectionSlug(postType),
      post_type_collection:
        postTypeCollection || normalizeWordpressCollectionSlug(postType),
      destination_id: destinationId,
      source_featured_media_id: refMap.source_featured_media_id
    });
  }
}

function resolveDeferredWordpressParentId(state, postType = "", sourceParentId = null) {
  const normalized = normalizeWordpressPhaseAType(postType);
  if (!Number.isFinite(Number(sourceParentId))) return null;
  return state.hierarchical_id_map?.[normalized]?.[String(sourceParentId)] || null;
}

function resolveDeferredWordpressTaxonomyIds(state, taxonomy = "", ids = []) {
  const normalized = normalizeWordpressPhaseAType(taxonomy);
  const map = state.taxonomy_id_map?.[normalized] || {};
  return ids
    .map(id => map[String(id)] || null)
    .filter(Number.isFinite);
}

async function applyDeferredWordpressParentLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;

  const repairs = [];

  for (const link of state.deferred_parent_links || []) {
    const resolvedParentId = resolveDeferredWordpressParentId(
      state,
      link.post_type,
      link.source_parent_id
    );

    if (!Number.isFinite(Number(resolvedParentId))) {
      repairs.push({
        destination_id: link.destination_id,
        post_type: link.post_type,
        post_type_collection:
          String(link.post_type_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || ""),
        repair_type: "parent_unresolved",
        source_parent_id: link.source_parent_id
      });
      continue;
    }

    await updateWordpressDestinationEntryById({
      destinationSiteRef,
      collectionSlug: link.post_type_collection || normalizeWordpressCollectionSlug(link.post_type),
      destinationId: link.destination_id,
      body: { parent: resolvedParentId },
      authRequired: true
    });

    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type,
      post_type_collection:
        String(link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || ""),
      repair_type: "parent_applied",
      source_parent_id: link.source_parent_id,
      resolved_parent_id: resolvedParentId
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.parent_repair_applied = true;
      statusRow.parent_resolved_id = resolvedParentId;
    }
  }

  return repairs;
}

async function applyDeferredWordpressTaxonomyLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;

  const repairs = [];

  for (const link of state.deferred_taxonomy_links || []) {
    const resolvedCategories = resolveDeferredWordpressTaxonomyIds(
      state,
      "category",
      link.source_category_ids || []
    );
    const resolvedTags = resolveDeferredWordpressTaxonomyIds(
      state,
      "tag",
      link.source_tag_ids || []
    );

    const sourceCategories = Array.isArray(link.source_category_ids)
      ? link.source_category_ids.filter(Number.isFinite)
      : [];
    const sourceTags = Array.isArray(link.source_tag_ids)
      ? link.source_tag_ids.filter(Number.isFinite)
      : [];

    const categoryUnresolved = sourceCategories.length > 0 && resolvedCategories.length === 0;
    const tagUnresolved = sourceTags.length > 0 && resolvedTags.length === 0;

    if (categoryUnresolved || tagUnresolved) {
      repairs.push({
        destination_id: link.destination_id,
        post_type: link.post_type || "post",
        destination_collection:
          String(link.destination_collection || link.post_type_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || "post"),
        post_type_collection:
          String(link.post_type_collection || link.destination_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || "post"),
        repair_type: "taxonomy_unresolved",
        source_category_ids: sourceCategories,
        source_tag_ids: sourceTags,
        resolved_categories: resolvedCategories,
        resolved_tags: resolvedTags
      });

      const blockedStatusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
      );
      if (blockedStatusRow) {
        blockedStatusRow.taxonomy_repair_applied = false;
        blockedStatusRow.taxonomy_repair_blocked = true;
        blockedStatusRow.taxonomy_repair_reason = "taxonomy_unresolved";
        blockedStatusRow.resolved_categories = resolvedCategories;
        blockedStatusRow.resolved_tags = resolvedTags;
      }
      continue;
    }

    await updateWordpressDestinationEntryById({
      destinationSiteRef,
      collectionSlug:
        String(link.destination_collection || link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      destinationId: link.destination_id,
      body: {
        categories: resolvedCategories,
        tags: resolvedTags
      },
      authRequired: true
    });

    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type || "post",
      destination_collection:
        String(link.destination_collection || link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      post_type_collection:
        String(link.post_type_collection || link.destination_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      repair_type: "taxonomy_links_applied",
      resolved_categories: resolvedCategories,
      resolved_tags: resolvedTags
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.taxonomy_repair_applied = true;
      statusRow.resolved_categories = resolvedCategories;
      statusRow.resolved_tags = resolvedTags;
    }
  }

  return repairs;
}

async function applyDeferredWordpressFeaturedMediaLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;
  void destinationSiteRef;

  const repairs = [];

  for (const link of state.deferred_featured_media_links || []) {
    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type,
      repair_type: "featured_media_deferred_phase_later",
      source_featured_media_id: link.source_featured_media_id
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.featured_media_repair_applied = false;
      statusRow.featured_media_deferred = true;
      statusRow.featured_media_repair_reason = "phase_a_media_not_enabled";
      statusRow.source_featured_media_id = link.source_featured_media_id;
    }
  }

  return repairs;
}

async function verifyDeferredWordpressParentRepairs(args = {}) {
  const {
    destinationSiteRef,
    repairs = [],
    destinationStatuses = []
  } = args;

  const checks = [];
  const failures = [];

  for (const repair of repairs) {
    if (String(repair.repair_type || "").trim() !== "parent_applied") {
      continue;
    }

    const collectionSlug =
      String(repair.post_type_collection || "").trim() ||
      normalizeWordpressCollectionSlug(repair.post_type || "");

    try {
      const readback = await getWordpressItemById({
        siteRef: destinationSiteRef,
        collectionSlug,
        id: repair.destination_id,
        authRequired: true
      });

      const actualParent = Number(readback?.parent);
      const expectedParent = Number(repair.resolved_parent_id);
      const verified =
        Number.isFinite(actualParent) &&
        Number.isFinite(expectedParent) &&
        actualParent === expectedParent;

      checks.push({
        destination_id: repair.destination_id,
        post_type: repair.post_type,
        repair_type: repair.repair_type,
        expected_parent_id: expectedParent,
        actual_parent_id: Number.isFinite(actualParent) ? actualParent : null,
        verified
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.parent_readback_verified = verified;
        statusRow.parent_readback_expected = expectedParent;
        statusRow.parent_readback_actual = Number.isFinite(actualParent)
          ? actualParent
          : null;
      }

      if (!verified) {
        failures.push({
          destination_id: repair.destination_id,
          repair_domain: "parent",
          failure_reason: "parent_readback_mismatch",
          expected_parent_id: expectedParent,
          actual_parent_id: Number.isFinite(actualParent) ? actualParent : null
        });
      }
    } catch (err) {
      checks.push({
        destination_id: repair.destination_id,
        post_type: repair.post_type,
        repair_type: repair.repair_type,
        expected_parent_id: Number(repair.resolved_parent_id),
        actual_parent_id: null,
        verified: false,
        readback_error_code: err?.code || "wordpress_parent_readback_failed"
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.parent_readback_verified = false;
        statusRow.parent_readback_error_code =
          err?.code || "wordpress_parent_readback_failed";
      }

      failures.push({
        destination_id: repair.destination_id,
        repair_domain: "parent",
        failure_reason: err?.code || "wordpress_parent_readback_failed",
        message: err?.message || "WordPress parent repair readback failed."
      });
    }
  }

  return { checks, failures };
}

async function verifyDeferredWordpressTaxonomyRepairs(args = {}) {
  const {
    destinationSiteRef,
    repairs = [],
    destinationStatuses = []
  } = args;

  const checks = [];
  const failures = [];

  for (const repair of repairs) {
    if (String(repair.repair_type || "").trim() !== "taxonomy_links_applied") {
      continue;
    }

    const collectionSlug =
      String(repair.destination_collection || repair.post_type_collection || "").trim() ||
      normalizeWordpressCollectionSlug(repair.post_type || "post");

    try {
      const readback = await getWordpressItemById({
        siteRef: destinationSiteRef,
        collectionSlug,
        id: repair.destination_id,
        authRequired: true
      });

      const actualCategories = Array.isArray(readback?.categories)
        ? readback.categories.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];
      const actualTags = Array.isArray(readback?.tags)
        ? readback.tags.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];

      const expectedCategories = Array.isArray(repair.resolved_categories)
        ? repair.resolved_categories.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];
      const expectedTags = Array.isArray(repair.resolved_tags)
        ? repair.resolved_tags.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];

      const verified =
        JSON.stringify(actualCategories) === JSON.stringify(expectedCategories) &&
        JSON.stringify(actualTags) === JSON.stringify(expectedTags);

      checks.push({
        destination_id: repair.destination_id,
        repair_type: repair.repair_type,
        expected_categories: expectedCategories,
        actual_categories: actualCategories,
        expected_tags: expectedTags,
        actual_tags: actualTags,
        verified
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.taxonomy_readback_verified = verified;
        statusRow.taxonomy_readback_expected_categories = expectedCategories;
        statusRow.taxonomy_readback_actual_categories = actualCategories;
        statusRow.taxonomy_readback_expected_tags = expectedTags;
        statusRow.taxonomy_readback_actual_tags = actualTags;
      }

      if (!verified) {
        failures.push({
          destination_id: repair.destination_id,
          repair_domain: "taxonomy",
          failure_reason: "taxonomy_readback_mismatch",
          expected_categories: expectedCategories,
          actual_categories: actualCategories,
          expected_tags: expectedTags,
          actual_tags: actualTags
        });
      }
    } catch (err) {
      checks.push({
        destination_id: repair.destination_id,
        repair_type: repair.repair_type,
        expected_categories: repair.resolved_categories || [],
        actual_categories: [],
        expected_tags: repair.resolved_tags || [],
        actual_tags: [],
        verified: false,
        readback_error_code: err?.code || "wordpress_taxonomy_readback_failed"
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.taxonomy_readback_verified = false;
        statusRow.taxonomy_readback_error_code =
          err?.code || "wordpress_taxonomy_readback_failed";
      }

      failures.push({
        destination_id: repair.destination_id,
        repair_domain: "taxonomy",
        failure_reason: err?.code || "wordpress_taxonomy_readback_failed",
        message: err?.message || "WordPress taxonomy repair readback failed."
      });
    }
  }

  return { checks, failures };
}

async function runWordpressConnectorMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  const apply = payload?.migration?.apply === true;
  const requestedPostTypes = (payload?.migration?.post_types || []).length
    ? payload.migration.post_types
    : ["post"];
  const phaseAScopeClassifications = assertWordpressPhaseAScope(payload);
  const postTypes = buildWordpressPhaseAExecutionOrder(requestedPostTypes);
  const batchPolicy = resolveWordpressPhaseABatchPolicy(payload);
  const retryPolicy = resolveWordpressPhaseARetryPolicy(payload);
  const resumePolicy = resolveWordpressPhaseAResumePolicy(payload);
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  const resultBase = {
    transport: "wordpress_connector",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "wordpress_connector"),
    runtime_delta: {
      source_supported_cpts: wpContext?.source?.runtime?.supported_cpts || [],
      destination_supported_cpts: wpContext?.destination?.runtime?.supported_cpts || []
    },
    settings_delta: {
      source_permalink_structure: wpContext?.source?.settings?.permalink_structure || "",
      destination_permalink_structure: wpContext?.destination?.settings?.permalink_structure || ""
    },
    plugin_delta: {
      source_plugins: wpContext?.source?.plugins?.active_plugins || [],
      destination_plugins: wpContext?.destination?.plugins?.active_plugins || []
    }
  };

  if (!apply) {
    return {
      ok: true,
      ...resultBase,
      execution_mode: "plan_only",
      apply: false,
      publish_status: publishStatus,
      message: "WordPress connector migration plan prepared (apply=false).",
      source_items_scanned: 0,
      created_count: 0,
      updated_count: 0,
      destination_ids: [],
      destination_statuses: [],
      readback_verified: false
    };
  }

  if (!WORDPRESS_MUTATION_PUBLISH_STATUSES.has(publishStatus)) {
    throw createHttpError(
      "invalid_publish_status",
      `Unsupported publish status: ${publishStatus}`,
      400
    );
  }

  if (!getWordpressSiteAuth(wpContext?.destination || {})) {
    throw createHttpError(
      "wordpress_destination_auth_missing",
      "Destination WordPress credentials are required for live mutation.",
      409
    );
  }

  const destinationStatuses = [];
  const postTypeResolution = [];
  const failures = [];
  const governedResolutionRecords = [];
  const generatedCandidateEvidence = [];
  const phaseAState = ensureWordpressPhaseAState(mutationPlan);
  let createdCount = 0;
  let updatedCount = 0;
  let sourceItemsScanned = 0;
  const phaseABatchTelemetry = [];
  const phaseARetryTelemetry = [];
  let phaseACheckpoint = buildWordpressPhaseACheckpoint({});

  for (const postTypeRaw of postTypes) {
    const postType = normalizeWordpressCollectionSlug(postTypeRaw);
    if (!postType) continue;

    if (shouldSkipWordpressPhaseAPostType(postType, resumePolicy)) {
      phaseABatchTelemetry.push({
        post_type: postType,
        skipped_by_resume: true,
        checkpoint: resumePolicy.checkpoint
      });
      continue;
    }

    const scopeClassification = classifyWordpressPhaseAScope(postType);
    let sourceCollectionSlug = "";
    let destinationCollectionSlug = "";

    try {
      sourceCollectionSlug = await resolveWordpressCollectionSlug({
        siteRef: wpContext?.source || {},
        postType,
        authRequired: false
      });
      destinationCollectionSlug = await resolveWordpressCollectionSlug({
        siteRef: wpContext?.destination || {},
        postType,
        authRequired: true
      });
      postTypeResolution.push({
        post_type: postType,
        phase_a_scope_family: scopeClassification.scope_family,
        source_collection: sourceCollectionSlug,
        destination_collection: destinationCollectionSlug
      });

      const generatedEvidence = buildWordpressGeneratedCandidateEvidence({
        slug: destinationCollectionSlug || sourceCollectionSlug || postType,
        kind: "post_type",
        method: apply ? "POST" : "GET",
        actionClass: apply ? "POST_COLLECTION" : "GET_COLLECTION",
        materializedRegistryRowExists: false
      });

      const governedRecord = buildGovernedResolutionRecord({
        normalized_query: `wordpress:${postType}`,
        candidate_count: generatedEvidence ? 1 : 0,
        selected_candidate_id: generatedEvidence
          ? generatedEvidence.generated_candidate_endpoint_key
          : "",
        selected_candidate_key: generatedEvidence
          ? generatedEvidence.generated_candidate_endpoint_key
          : "",
        selection_confidence: generatedEvidence ? "high" : "low",
        selection_basis: generatedEvidence
          ? "resolver_backed_template_generation"
          : "unresolved",
        rejected_candidate_summary: [],
        fallback_used: false,
        governance_gate_results: {
          source_collection_resolved: !!sourceCollectionSlug,
          destination_collection_resolved: !!destinationCollectionSlug,
          generated_candidate_present: !!generatedEvidence,
          materialized_registry_row_exists: false
        }
      });

      assertWordpressGovernedResolutionConfidence(governedRecord, apply);
      governedResolutionRecords.push(governedRecord);
      if (generatedEvidence) generatedCandidateEvidence.push(generatedEvidence);
    } catch (err) {
      failures.push({
        post_type: postType,
        stage: "post_type_resolution",
        source_id: null,
        code: String(err?.code || "wordpress_post_type_resolution_failed"),
        message: String(err?.message || "Unable to resolve source/destination post type collection.")
      });
      continue;
    }

    const phaseAReadiness = evaluateWordpressPhaseAStartReadiness({
      payload,
      wpContext,
      sourceCollectionSlug,
      destinationCollectionSlug,
      generatedCandidate: generatedCandidateEvidence[generatedCandidateEvidence.length - 1] || null,
      materializedRegistryRowExists: false
    });

    if (phaseAReadiness.phase_a_start_status !== "ready_for_phase_a" && apply) {
      failures.push({
        post_type: postType,
        code: "wordpress_phase_a_start_blocked",
        message: "WordPress Phase A start blocked by governed readiness gate.",
        phase_a_start_status: phaseAReadiness.phase_a_start_status,
        governance_gate_results: phaseAReadiness.governance_gate_results
      });
      continue;
    }

    let sourceEntriesRaw = [];
    try {
      const sourceEntriesRetry = await runWithWordpressSelectiveRetry(
        () =>
          listWordpressEntriesByType({
            siteRef: wpContext?.source || {},
            postType,
            collectionSlug: sourceCollectionSlug
          }),
        retryPolicy,
        { retry_domain: "source_list" }
      );

      sourceEntriesRaw = Array.isArray(sourceEntriesRetry.result)
        ? sourceEntriesRetry.result
        : [];

      phaseARetryTelemetry.push({
        post_type: postType,
        retry_domain: "source_list",
        retry_used: sourceEntriesRetry.retry_used,
        final_attempt: sourceEntriesRetry.final_attempt,
        attempts: sourceEntriesRetry.attempts
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        post_type_collection: sourceCollectionSlug,
        stage: "source_read",
        source_id: null,
        code: String(err?.code || "source_read_failed"),
        message: String(err?.message || "Unable to read source entries."),
        retry_attempts: err?.wordpress_retry_attempts || []
      });
      continue;
    }

    const sourceEntries = sourceEntriesRaw.slice(0, batchPolicy.max_items_per_type);
    const batches = chunkArray(sourceEntries, batchPolicy.batch_size);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const resumableBatch = trimBatchForResume(
        batch,
        batchIndex + 1,
        postType,
        resumePolicy
      );
      let batchCreated = 0;
      let batchUpdated = 0;
      let batchFailed = 0;

      for (const sourceEntry of resumableBatch) {
        sourceItemsScanned += 1;
        const sourceId = Number(sourceEntry?.id);
        const safeSourceId = Number.isFinite(sourceId) ? sourceId : null;
        const mutationPayload = mapWordpressSourceEntryToMutationPayload(
          sourceEntry,
          publishStatus
        );
        const slug = String(mutationPayload.slug || "").trim();

        try {
          let operation = "create";
          let targetId = null;
          let existingRetry = {
            retry_used: false,
            final_attempt: 0,
            attempts: []
          };

          if (slug) {
            existingRetry = await runWithWordpressSelectiveRetry(
              () =>
                findWordpressDestinationEntryBySlug({
                  siteRef: wpContext?.destination || {},
                  postType,
                  slug,
                  collectionSlug: destinationCollectionSlug
                }),
              retryPolicy,
              { retry_domain: "destination_lookup" }
            );

            const existing = existingRetry.result;
            const existingId = Number(existing?.id);
            if (Number.isFinite(existingId) && existingId > 0) {
              operation = "update";
              targetId = existingId;
            }

            phaseARetryTelemetry.push({
              post_type: postType,
              slug,
              retry_domain: "destination_lookup",
              retry_used: existingRetry.retry_used,
              final_attempt: existingRetry.final_attempt,
              attempts: existingRetry.attempts
            });
          }

          const upsertRetry = await runWithWordpressSelectiveRetry(
            async () => {
              const response = await executeWordpressRestJsonRequest({
                siteRef: wpContext?.destination || {},
                method: "POST",
                restPath: targetId
                  ? `/wp/v2/${encodeURIComponent(destinationCollectionSlug)}/${targetId}`
                  : `/wp/v2/${encodeURIComponent(destinationCollectionSlug)}`,
                body: mutationPayload,
                authRequired: true
              });

              if (!response.ok) {
                throw createHttpError(
                  String(response?.data?.code || "wordpress_destination_write_failed"),
                  String(
                    response?.data?.message ||
                      `Destination ${operation} failed with status ${response.status}.`
                  ),
                  Number(response.status || 502),
                  {
                    post_type: postType,
                    post_type_collection: destinationCollectionSlug,
                    batch_index: batchIndex + 1,
                    stage: operation,
                    source_id: safeSourceId,
                    response: response.data
                  }
                );
              }

              const destinationId = Number(response?.data?.id);
              if (!Number.isFinite(destinationId) || destinationId < 1) {
                throw createHttpError(
                  "wordpress_mutation_missing_id",
                  "Destination mutation succeeded without a valid destination id.",
                  400,
                  {
                    post_type: postType,
                    post_type_collection: destinationCollectionSlug,
                    batch_index: batchIndex + 1,
                    stage: operation,
                    source_id: safeSourceId
                  }
                );
              }

              return {
                id: destinationId,
                status: String(response?.data?.status || ""),
                link: String(
                  response?.data?.link ||
                    response?.data?.guid?.rendered ||
                    ""
                ),
                slug: String(response?.data?.slug || slug || "").trim()
              };
            },
            retryPolicy,
            { retry_domain: "destination_upsert" }
          );

          const upsertResult = upsertRetry.result;

          phaseARetryTelemetry.push({
            post_type: postType,
            slug: upsertResult.slug || slug,
            retry_domain: "destination_upsert",
            retry_used: upsertRetry.retry_used,
            final_attempt: upsertRetry.final_attempt,
            attempts: upsertRetry.attempts
          });

          if (operation === "create") {
            createdCount += 1;
            batchCreated += 1;
          } else {
            updatedCount += 1;
            batchUpdated += 1;
          }

          buildDeferredWordpressReferencePlan(phaseAState, {
            postType,
            postTypeCollection: destinationCollectionSlug,
            destinationCollectionSlug,
            item: sourceEntry,
            destinationId: upsertResult.id
          });

          destinationStatuses.push({
            id: upsertResult.id,
            source_id: safeSourceId,
            destination_id: upsertResult.id,
            post_type: postType,
            post_type_collection: destinationCollectionSlug,
            batch_index: batchIndex + 1,
            operation,
            status: upsertResult.status,
            link: upsertResult.link,
            slug: upsertResult.slug,
            retry_used: existingRetry.retry_used || upsertRetry.retry_used
          });

          phaseACheckpoint = buildWordpressPhaseACheckpoint({
            post_type: postType,
            batch_index: batchIndex + 1,
            last_completed_slug: String(
              sourceEntry?.slug || mutationPayload?.slug || upsertResult?.slug || ""
            ).trim()
          });
        } catch (err) {
          batchFailed += 1;
          failures.push({
            post_type: postType,
            slug: sourceEntry?.slug || "",
            post_type_collection: destinationCollectionSlug,
            batch_index: batchIndex + 1,
            stage: "mutation_exception",
            source_id: safeSourceId,
            code: String(err?.code || "wordpress_item_migration_failed"),
            message: String(err?.message || "WordPress item migration failed."),
            retry_attempts: err?.wordpress_retry_attempts || []
          });
          if (!batchPolicy.continue_on_item_error) {
            throw err;
          }
        }
      }

      phaseABatchTelemetry.push({
        post_type: postType,
        batch_index: batchIndex + 1,
        batch_size: batch.length,
        resumed_batch_size: resumableBatch.length,
        created_count: batchCreated,
        updated_count: batchUpdated,
        failed_count: batchFailed,
        checkpoint_after_batch: phaseACheckpoint,
        throttle_ms_applied:
          batchPolicy.throttle_ms > 0 && batchIndex < batches.length - 1
            ? batchPolicy.throttle_ms
            : 0
      });

      if (batchPolicy.throttle_ms > 0 && batchIndex < batches.length - 1) {
        await sleep(batchPolicy.throttle_ms);
      }
    }
  }

  let deferredParentRepairs = [];
  let deferredTaxonomyRepairs = [];
  let deferredFeaturedMediaRepairs = [];
  let deferredParentReadbackChecks = [];
  let deferredTaxonomyReadbackChecks = [];
  let deferredRepairFailures = [];
  let phaseAPerTypeSummary = [];
  let phaseAOutcome = {
    phase_a_outcome: "no_op",
    phase_a_outcome_message: "No WordPress Phase A operations were executed.",
    processed_count: 0,
    failure_count: 0
  };
  let phaseAOperatorArtifact = null;
  let phaseAPromotionGuard = {
    selective_publish_ready: false,
    promotion_status: "blocked_for_selective_publish",
    blocking_reasons: ["phase_a_not_evaluated"],
    successful_post_types: [],
    unresolved_taxonomy_count: 0,
    parent_readback_failed_count: 0,
    taxonomy_readback_failed_count: 0,
    item_readback_failed_count: 0,
    featured_media_deferred_count: 0
  };
  let selectivePublishCandidates = {
    candidate_count: 0,
    rejected_count: 0,
    candidates: [],
    rejected: []
  };
  let selectivePublishPlan = {
    enabled: false,
    apply_limit: 25,
    include_post_types: ["post", "page"],
    include_slugs: [],
    exclude_slugs: []
  };
  let selectivePublishExecution = {
    publish_attempted: false,
    publish_status: "disabled",
    selected_candidates: [],
    results: [],
    failures: []
  };
  let selectivePublishRollbackPlan = {
    rollback_ready: false,
    rollback_status: "rollback_not_available",
    candidate_count: 0,
    blocking_reasons: ["selective_publish_not_evaluated"],
    failures_present: false,
    rollback_candidates: []
  };
  let selectivePublishRollbackExecutionPlan = {
    enabled: false,
    apply_limit: 25,
    include_post_types: ["post", "page"],
    include_slugs: [],
    exclude_slugs: []
  };
  let selectivePublishRollbackExecution = {
    rollback_attempted: false,
    rollback_execution_status: "disabled",
    selected_candidates: [],
    results: [],
    failures: []
  };
  let phaseACutoverJournal = null;
  let phaseAFinalCutoverRecommendation = {
    final_cutover_recommendation: "hold",
    final_cutover_reason: "Cutover not yet evaluated.",
    successful_post_types: [],
    promotion_status: "",
    publish_status: "",
    rollback_status: "",
    publish_failure_count: 0,
    rollback_failure_count: 0
  };
  let phaseAFinalOperatorHandoffBundle = null;
  let phaseBPlan = {
    enabled: false,
    audit_only: true,
    apply: false,
    post_types: [],
    max_items_per_type: 250,
    dependency_scan_enabled: true,
    include_inactive: false
  };
  let phaseBPlanStatus = {
    phase_b_status: "disabled",
    phase_b_ready: false,
    blocking_reasons: ["phase_b_not_evaluated"]
  };
  let phaseBGate = {
    phase_b_gate_status: "blocked",
    phase_b_gate_ready: false,
    phase_b_audit_only: true,
    blocking_reasons: ["phase_b_gate_not_evaluated"]
  };
  let phaseBInventoryAudit = {
    phase_b_inventory_status: "disabled",
    audit_rows: [],
    inventory_counts: [],
    failures: []
  };
  let phaseBNormalizedAudit = {
    normalized_audit_rows: [],
    dependency_summary: [],
    dependency_totals: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    },
    family_summary: [],
    migration_buckets: {
      candidate_low_complexity: [],
      candidate_reviewed_low_risk: [],
      staged_dependency_review: [],
      blocked_high_dependency: [],
      manual_review: []
    },
    cross_reference_summary: {
      total_rows: 0,
      rows_with_template_refs: 0,
      rows_with_widget_refs: 0,
      rows_with_navigation_refs: 0,
      rows_with_popup_refs: 0,
      rows_with_shortcode_refs: 0
    },
    dependency_reference_index: {
      by_node_key: {},
      by_source_id: {}
    },
    dependency_graph_edges: [],
    dependency_graph_unresolved: [],
    dependency_graph_summary: {
      edge_count: 0,
      unresolved_count: 0,
      relation_counts: {},
      unresolved_relation_counts: {}
    }
  };
  let phaseBGraphStability = {
    phase_b_graph_stable: false,
    phase_b_readiness_status: "not_evaluated",
    blocking_reasons: ["phase_b_graph_not_evaluated"],
    unresolved_reference_count: 0,
    high_risk_asset_count: 0,
    blocked_bucket_count: 0,
    staged_dependency_review_count: 0
  };
  let phaseBReadinessArtifact = {
    artifact_type: "wordpress_phase_b_readiness_gate",
    artifact_version: "v1",
    phase_b_enabled: false,
    phase_b_audit_only: true,
    phase_b_gate_status: "blocked",
    phase_b_graph_stable: false,
    phase_b_readiness_status: "not_evaluated",
    blocking_reasons: ["phase_b_graph_not_evaluated"],
    unresolved_reference_count: 0,
    high_risk_asset_count: 0,
    blocked_bucket_count: 0,
    staged_dependency_review_count: 0,
    dependency_graph_edge_count: 0,
    dependency_graph_unresolved_count: 0,
    family_summary: []
  };
  let phaseBPlanningCandidates = {
    planning_status: "blocked",
    candidate_count: 0,
    blocked_count: 0,
    planning_candidates: [],
    blocked_candidates: [],
    blocking_reasons: ["phase_b_planning_not_evaluated"]
  };
  let phaseBPlanningArtifact = {
    artifact_type: "wordpress_phase_b_planning_candidates",
    artifact_version: "v1",
    planning_status: "blocked",
    phase_b_graph_stable: false,
    candidate_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_planning_not_evaluated"],
    planning_candidates: [],
    blocked_candidates: []
  };
  let phaseBSequencePlanner = {
    sequence_status: "blocked",
    total_sequence_count: 0,
    family_sequence_summary: [],
    migration_sequence: [],
    blocking_reasons: ["phase_b_sequence_not_evaluated"]
  };
  let phaseBSequenceArtifact = {
    artifact_type: "wordpress_phase_b_sequence_plan",
    artifact_version: "v1",
    sequence_status: "blocked",
    total_sequence_count: 0,
    family_sequence_summary: [],
    migration_sequence: [],
    blocking_reasons: ["phase_b_sequence_not_evaluated"]
  };
  let phaseBMappingPrerequisiteGate = {
    mapping_gate_status: "blocked",
    mapping_gate_ready: false,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_mapping_prerequisites_not_evaluated"],
    mapping_rows: []
  };
  let phaseBMappingPrerequisiteArtifact = {
    artifact_type: "wordpress_phase_b_mapping_prerequisite_gate",
    artifact_version: "v1",
    mapping_gate_status: "blocked",
    mapping_gate_ready: false,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_mapping_prerequisites_not_evaluated"],
    mapping_rows: []
  };
  let phaseBMappingPlanSkeleton = {
    mapping_plan_status: "blocked",
    family_mapping_plans: [],
    asset_mapping_rows: [],
    blocking_reasons: ["phase_b_mapping_plan_not_evaluated"]
  };
  let phaseBMappingPlanArtifact = {
    artifact_type: "wordpress_phase_b_mapping_plan_skeleton",
    artifact_version: "v1",
    mapping_plan_status: "blocked",
    family_mapping_plans: [],
    asset_mapping_rows: [],
    blocking_reasons: ["phase_b_mapping_plan_not_evaluated"]
  };
  let phaseBFieldMappingResolver = {
    field_mapping_status: "blocked",
    resolved_mapping_rows: [],
    family_mapping_summary: [],
    blocking_reasons: ["phase_b_field_mapping_not_evaluated"]
  };
  let phaseBFieldMappingArtifact = {
    artifact_type: "wordpress_phase_b_field_mapping_plan",
    artifact_version: "v1",
    field_mapping_status: "blocked",
    resolved_mapping_rows: [],
    family_mapping_summary: [],
    blocking_reasons: ["phase_b_field_mapping_not_evaluated"]
  };
  let phaseBDryRunPlanner = {
    dry_run_status: "blocked",
    payload_count: 0,
    dry_run_payload_rows: [],
    family_payload_summary: [],
    blocking_reasons: ["phase_b_dry_run_not_evaluated"]
  };
  let phaseBDryRunArtifact = {
    artifact_type: "wordpress_phase_b_dry_run_payload_plan",
    artifact_version: "v1",
    dry_run_status: "blocked",
    payload_count: 0,
    family_payload_summary: [],
    dry_run_payload_rows: [],
    blocking_reasons: ["phase_b_dry_run_not_evaluated"]
  };
  let phaseBExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 50,
    allow_review_required_rows: false
  };
  let phaseBExecutionGuard = {
    execution_guard_status: "blocked_before_builder_mutation_execution",
    execution_guard_ready: false,
    blocking_reasons: ["phase_b_execution_guard_not_evaluated"],
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 50
  };
  let phaseBExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_b_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_builder_mutation_execution",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 50,
    blocking_reasons: ["phase_b_execution_guard_not_evaluated"]
  };
  let phaseBMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_b_mutation_candidates_not_evaluated"]
  };
  let phaseBMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_b_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_b_mutation_candidates_not_evaluated"]
  };
  let phaseBMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_b_mutation_payloads_not_evaluated"]
  };
  let phaseBMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_b_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_b_mutation_payloads_not_evaluated"]
  };
  let phaseBDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    mutation_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    },
    blocking_reasons: ["phase_b_dry_run_execution_not_evaluated"]
  };
  let phaseBDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_b_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    mutation_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    },
    blocking_reasons: ["phase_b_dry_run_execution_not_evaluated"]
  };
  let phaseBFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_b_final_operator_handoff",
    artifact_version: "v1",
    phase_b_enabled: false,
    phase_b_audit_only: true,
    phase_b_apply_requested: false,
    requested_builder_post_types: [],
    phase_b_gate_status: "blocked",
    phase_b_readiness_status: "not_evaluated",
    phase_b_graph_stable: false,
    phase_b_planning_status: "blocked",
    phase_b_sequence_status: "blocked",
    phase_b_mapping_gate_status: "blocked",
    phase_b_mapping_plan_status: "blocked",
    phase_b_field_mapping_status: "blocked",
    phase_b_dry_run_status: "blocked",
    phase_b_execution_guard_status: "blocked_before_builder_mutation_execution",
    phase_b_mutation_selector_status: "blocked",
    phase_b_mutation_payload_status: "blocked",
    phase_b_dry_run_execution_status: "blocked",
    inventory_totals: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    },
    graph_summary: {
      edge_count: 0,
      unresolved_count: 0,
      relation_counts: {},
      unresolved_relation_counts: {}
    },
    family_summary: [],
    planning_candidate_count: 0,
    planning_blocked_count: 0,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_mapping_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_b_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_builder_graph_instability",
      "resolve_mapping_prerequisites",
      "hold_builder_mutation_execution",
      "no_dry_run_preview_available"
    ],
    readiness_artifact: {},
    planning_artifact: {},
    sequence_artifact: {},
    mapping_prerequisite_artifact: {},
    mapping_plan_artifact: {},
    field_mapping_artifact: {},
    dry_run_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseCPlan = {
    enabled: false,
    reconciliation_only: true,
    apply: false,
    include_keys: []
  };
  let phaseCPlanStatus = {
    phase_c_status: "blocked",
    phase_c_ready: false,
    blocking_reasons: ["phase_c_not_evaluated"]
  };
  let phaseCGate = {
    phase_c_gate_status: "blocked",
    phase_c_gate_ready: false,
    reconciliation_only: true,
    blocking_reasons: ["phase_c_gate_not_evaluated"]
  };
  let phaseCSettingsInventory = {
    phase_c_inventory_status: "blocked",
    inventory_rows: [],
    summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    failures: []
  };
  let phaseCInventoryArtifact = {
    artifact_type: "wordpress_phase_c_settings_inventory",
    artifact_version: "v1",
    phase_c_gate_status: "blocked",
    phase_c_inventory_status: "blocked",
    reconciliation_only: true,
    summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    inventory_rows: [],
    blocking_reasons: ["phase_c_not_evaluated"],
    failures: []
  };
  let phaseCNormalizedDiff = {
    normalized_diff_rows: [],
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    reconciliation_buckets: {
      already_aligned: [],
      safe_reconcile_candidate: [],
      environment_sensitive_review: [],
      structured_settings_review: [],
      review_required: []
    }
  };
  let phaseCDiffArtifact = {
    artifact_type: "wordpress_phase_c_settings_diff",
    artifact_version: "v1",
    phase_c_gate_status: "blocked",
    reconciliation_only: true,
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    normalized_diff_rows: [],
    reconciliation_buckets: {
      already_aligned: [],
      safe_reconcile_candidate: [],
      environment_sensitive_review: [],
      structured_settings_review: [],
      review_required: []
    },
    blocking_reasons: ["phase_c_diff_not_evaluated"]
  };
  let phaseCReconciliationReadiness = {
    reconciliation_readiness_status: "blocked_for_reconciliation",
    reconciliation_ready: false,
    safe_candidate_count: 0,
    environment_sensitive_count: 0,
    structured_review_count: 0,
    review_required_count: 0,
    total_diff_count: 0,
    blocking_reasons: ["phase_c_reconciliation_not_evaluated"]
  };
  let phaseCSafeApplyCandidates = {
    safe_apply_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_c_safe_apply_not_evaluated"]
  };
  let phaseCReadinessArtifact = {
    artifact_type: "wordpress_phase_c_reconciliation_readiness",
    artifact_version: "v1",
    reconciliation_readiness_status: "blocked_for_reconciliation",
    reconciliation_ready: false,
    safe_candidate_count: 0,
    environment_sensitive_count: 0,
    structured_review_count: 0,
    review_required_count: 0,
    total_diff_count: 0,
    safe_apply_status: "blocked",
    safe_apply_candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_c_reconciliation_not_evaluated"]
  };
  let phaseCReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_c_payload_planner_not_evaluated"]
  };
  let phaseCReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_c_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_c_payload_planner_not_evaluated"]
  };
  let phaseCExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 25
  };
  let phaseCExecutionGuard = {
    execution_guard_status: "blocked_before_settings_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_c_execution_guard_not_evaluated"]
  };
  let phaseCExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_c_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_settings_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_c_execution_guard_not_evaluated"]
  };
  let phaseCMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_c_mutation_candidates_not_evaluated"]
  };
  let phaseCMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_c_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_c_mutation_candidates_not_evaluated"]
  };
  let phaseCMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_c_mutation_payloads_not_evaluated"]
  };
  let phaseCMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_c_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_c_mutation_payloads_not_evaluated"]
  };
  let phaseCDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    reconciliation_evidence_preview_summary: {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    },
    blocking_reasons: ["phase_c_dry_run_execution_not_evaluated"]
  };
  let phaseCDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_c_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    reconciliation_evidence_preview_summary: {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    },
    blocking_reasons: ["phase_c_dry_run_execution_not_evaluated"]
  };
  let phaseCFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_c_final_operator_handoff",
    artifact_version: "v1",
    phase_c_enabled: false,
    phase_c_reconciliation_only: true,
    phase_c_apply_requested: false,
    requested_settings_keys: [],
    phase_c_gate_status: "blocked",
    phase_c_inventory_status: "blocked",
    phase_c_diff_status: "blocked",
    phase_c_reconciliation_readiness_status: "blocked_for_reconciliation",
    phase_c_safe_apply_status: "blocked",
    phase_c_payload_planner_status: "blocked",
    phase_c_execution_guard_status: "blocked_before_settings_mutation",
    phase_c_mutation_selector_status: "blocked",
    phase_c_mutation_payload_status: "blocked",
    phase_c_dry_run_execution_status: "blocked",
    inventory_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_c_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_settings_reconciliation_blockers",
      "hold_settings_mutation_execution",
      "no_settings_dry_run_preview_available"
    ],
    inventory_artifact: {},
    diff_artifact: {},
    readiness_artifact: {},
    payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseDPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    post_types: [],
    include_integrations: true,
    max_items_per_type: 250
  };
  let phaseDPlanStatus = {
    phase_d_status: "blocked",
    phase_d_ready: false,
    blocking_reasons: ["phase_d_not_evaluated"]
  };
  let phaseDGate = {
    phase_d_gate_status: "blocked",
    phase_d_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_d_gate_not_evaluated"]
  };
  let phaseDFormsInventory = {
    phase_d_inventory_status: "blocked",
    inventory_rows: [],
    inventory_counts: [],
    failures: []
  };
  let phaseDInventoryArtifact = {
    artifact_type: "wordpress_phase_d_forms_integrations_inventory",
    artifact_version: "v1",
    phase_d_gate_status: "blocked",
    phase_d_inventory_status: "blocked",
    inventory_only: true,
    inventory_counts: [],
    inventory_rows: [],
    blocking_reasons: ["phase_d_not_evaluated"],
    failures: []
  };
  let phaseDNormalizedInventory = {
    normalized_inventory_rows: [],
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    strategy_buckets: {
      simple_migrate_candidate: [],
      reviewed_migrate_or_rebuild: [],
      rebuild_required: []
    }
  };
  let phaseDNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_d_forms_integrations_strategy",
    artifact_version: "v1",
    phase_d_gate_status: "blocked",
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    normalized_inventory_rows: [],
    strategy_buckets: {
      simple_migrate_candidate: [],
      reviewed_migrate_or_rebuild: [],
      rebuild_required: []
    },
    blocking_reasons: ["phase_d_strategy_not_evaluated"]
  };
  let phaseDReadinessGate = {
    readiness_status: "blocked_for_forms_migration",
    readiness_ready: false,
    simple_migrate_candidate_count: 0,
    reviewed_migrate_or_rebuild_count: 0,
    rebuild_required_count: 0,
    safe_candidate_count: 0,
    blocking_reasons: ["phase_d_readiness_not_evaluated"]
  };
  let phaseDSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_d_safe_candidates_not_evaluated"]
  };
  let phaseDReadinessArtifact = {
    artifact_type: "wordpress_phase_d_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_forms_migration",
    readiness_ready: false,
    simple_migrate_candidate_count: 0,
    reviewed_migrate_or_rebuild_count: 0,
    rebuild_required_count: 0,
    safe_candidate_count: 0,
    safe_candidate_status: "blocked",
    candidates: [],
    blocking_reasons: ["phase_d_readiness_not_evaluated"]
  };
  let phaseDMigrationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_d_payload_planner_not_evaluated"]
  };
  let phaseDMigrationPayloadArtifact = {
    artifact_type: "wordpress_phase_d_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_d_payload_planner_not_evaluated"]
  };
  let phaseDExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 25
  };
  let phaseDExecutionGuard = {
    execution_guard_status: "blocked_before_forms_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_d_execution_guard_not_evaluated"]
  };
  let phaseDExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_d_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_forms_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_d_execution_guard_not_evaluated"]
  };
  let phaseDMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_d_mutation_candidates_not_evaluated"]
  };
  let phaseDMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_d_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_d_mutation_candidates_not_evaluated"]
  };
  let phaseDMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_d_mutation_payloads_not_evaluated"]
  };
  let phaseDMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_d_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_d_mutation_payloads_not_evaluated"]
  };
  let phaseDDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    integration_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    },
    blocking_reasons: ["phase_d_dry_run_execution_not_evaluated"]
  };
  let phaseDDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_d_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    integration_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    },
    blocking_reasons: ["phase_d_dry_run_execution_not_evaluated"]
  };
  let phaseDFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_d_final_operator_handoff",
    artifact_version: "v1",
    phase_d_enabled: false,
    phase_d_inventory_only: true,
    phase_d_apply_requested: false,
    requested_form_post_types: [],
    phase_d_gate_status: "blocked",
    phase_d_inventory_status: "blocked",
    phase_d_strategy_status: "blocked",
    phase_d_readiness_status: "blocked_for_forms_migration",
    phase_d_safe_candidate_status: "blocked",
    phase_d_payload_planner_status: "blocked",
    phase_d_execution_guard_status: "blocked_before_forms_mutation",
    phase_d_mutation_selector_status: "blocked",
    phase_d_mutation_payload_status: "blocked",
    phase_d_dry_run_execution_status: "blocked",
    inventory_counts: [],
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_d_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_forms_migration_blockers",
      "hold_forms_mutation_execution",
      "no_forms_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    migration_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseEPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_featured_media: true,
    include_inline_media: true,
    include_unattached: false,
    max_items: 1000
  };
  let phaseEPlanStatus = {
    phase_e_status: "blocked",
    phase_e_ready: false,
    blocking_reasons: ["phase_e_not_evaluated"]
  };
  let phaseEGate = {
    phase_e_gate_status: "blocked",
    phase_e_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_e_gate_not_evaluated"]
  };
  let phaseEMediaInventory = {
    phase_e_inventory_status: "blocked",
    inventory_rows: [],
    summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    failures: []
  };
  let phaseEInventoryArtifact = {
    artifact_type: "wordpress_phase_e_media_inventory",
    artifact_version: "v1",
    phase_e_gate_status: "blocked",
    phase_e_inventory_status: "blocked",
    inventory_only: true,
    summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    inventory_rows: [],
    blocking_reasons: ["phase_e_not_evaluated"],
    failures: []
  };
  let phaseENormalizedInventory = {
    normalized_inventory_rows: [],
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    strategy_buckets: {
      safe_attached_migrate_candidate: [],
      reviewed_media_migrate: [],
      rebuild_or_manual_rebind_required: [],
      excluded_unattached_media: []
    }
  };
  let phaseENormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_e_media_strategy",
    artifact_version: "v1",
    phase_e_gate_status: "blocked",
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    normalized_inventory_rows: [],
    strategy_buckets: {
      safe_attached_migrate_candidate: [],
      reviewed_media_migrate: [],
      rebuild_or_manual_rebind_required: [],
      excluded_unattached_media: []
    },
    blocking_reasons: ["phase_e_strategy_not_evaluated"]
  };
  let phaseEReadinessGate = {
    readiness_status: "blocked_for_media_migration",
    readiness_ready: false,
    safe_attached_migrate_candidate_count: 0,
    reviewed_media_migrate_count: 0,
    rebuild_or_manual_rebind_required_count: 0,
    safe_candidate_count: 0,
    blocking_reasons: ["phase_e_readiness_not_evaluated"]
  };
  let phaseESafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_e_safe_candidates_not_evaluated"]
  };
  let phaseEReadinessArtifact = {
    artifact_type: "wordpress_phase_e_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_media_migration",
    readiness_ready: false,
    safe_attached_migrate_candidate_count: 0,
    reviewed_media_migrate_count: 0,
    rebuild_or_manual_rebind_required_count: 0,
    safe_candidate_count: 0,
    safe_candidate_status: "blocked",
    candidates: [],
    blocking_reasons: ["phase_e_readiness_not_evaluated"]
  };
  let phaseEMigrationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_e_payload_planner_not_evaluated"]
  };
  let phaseEMigrationPayloadArtifact = {
    artifact_type: "wordpress_phase_e_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_e_payload_planner_not_evaluated"]
  };
  let phaseEExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 100
  };
  let phaseEExecutionGuard = {
    execution_guard_status: "blocked_before_media_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_e_execution_guard_not_evaluated"]
  };
  let phaseEExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_e_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_media_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_e_execution_guard_not_evaluated"]
  };
  let phaseEMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_e_mutation_candidates_not_evaluated"]
  };
  let phaseEMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_e_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_e_mutation_candidates_not_evaluated"]
  };
  let phaseEMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_e_mutation_payloads_not_evaluated"]
  };
  let phaseEMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_e_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_e_mutation_payloads_not_evaluated"]
  };
  let phaseEDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    attachment_evidence_preview_summary: {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    },
    blocking_reasons: ["phase_e_dry_run_execution_not_evaluated"]
  };
  let phaseEDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_e_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    attachment_evidence_preview_summary: {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    },
    blocking_reasons: ["phase_e_dry_run_execution_not_evaluated"]
  };
  let phaseEFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_e_final_operator_handoff",
    artifact_version: "v1",
    phase_e_enabled: false,
    phase_e_inventory_only: true,
    phase_e_apply_requested: false,
    requested_media_scope: {
      include_featured_media: true,
      include_inline_media: true,
      include_unattached: false,
      max_items: 0
    },
    requested_media_config: {},
    phase_e_gate_status: "blocked",
    phase_e_inventory_status: "blocked",
    phase_e_strategy_status: "blocked",
    phase_e_readiness_status: "blocked_for_media_migration",
    phase_e_safe_candidate_status: "blocked",
    phase_e_payload_planner_status: "blocked",
    phase_e_execution_guard_status: "blocked_before_media_mutation",
    phase_e_mutation_selector_status: "blocked",
    phase_e_mutation_payload_status: "blocked",
    phase_e_dry_run_execution_status: "blocked",
    inventory_summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_e_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_media_migration_blockers",
      "hold_media_mutation_execution",
      "no_media_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    migration_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseFPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_users: true,
    include_roles: true,
    include_auth_surface: true,
    max_users: 500
  };
  let phaseFPlanStatus = {
    phase_f_status: "blocked",
    phase_f_ready: false,
    blocking_reasons: ["phase_f_not_evaluated"]
  };
  let phaseFGate = {
    phase_f_gate_status: "blocked",
    phase_f_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_f_gate_not_evaluated"]
  };
  let phaseFUsersRolesAuthInventory = {
    phase_f_inventory_status: "blocked",
    user_rows: [],
    role_rows: [],
    auth_surface_rows: [],
    summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    failures: []
  };
  let phaseFInventoryArtifact = {
    artifact_type: "wordpress_phase_f_users_roles_auth_inventory",
    artifact_version: "v1",
    phase_f_gate_status: "blocked",
    phase_f_inventory_status: "blocked",
    inventory_only: true,
    summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    user_rows: [],
    role_rows: [],
    auth_surface_rows: [],
    blocking_reasons: ["phase_f_not_evaluated"],
    failures: []
  };
  let phaseFNormalizedInventory = {
    normalized_user_rows: [],
    normalized_role_rows: [],
    normalized_auth_surface_rows: [],
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    }
  };
  let phaseFNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_f_privilege_auth_strategy",
    artifact_version: "v1",
    phase_f_gate_status: "blocked",
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    },
    normalized_user_rows: [],
    normalized_role_rows: [],
    normalized_auth_surface_rows: [],
    blocking_reasons: ["phase_f_strategy_not_evaluated"]
  };
  let phaseFReadinessGate = {
    readiness_status: "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: false,
    user_high_risk_count: 0,
    role_high_risk_count: 0,
    auth_high_risk_count: 0,
    user_medium_risk_count: 0,
    role_medium_risk_count: 0,
    auth_medium_risk_count: 0,
    blocking_reasons: ["phase_f_readiness_not_evaluated"]
  };
  let phaseFSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    user_candidates: [],
    role_candidates: [],
    auth_surface_candidates: [],
    blocking_reasons: ["phase_f_safe_candidates_not_evaluated"]
  };
  let phaseFReadinessArtifact = {
    artifact_type: "wordpress_phase_f_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: false,
    user_high_risk_count: 0,
    role_high_risk_count: 0,
    auth_high_risk_count: 0,
    user_medium_risk_count: 0,
    role_medium_risk_count: 0,
    auth_medium_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    user_candidates: [],
    role_candidates: [],
    auth_surface_candidates: [],
    blocking_reasons: ["phase_f_readiness_not_evaluated"]
  };
  let phaseFReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    user_payload_rows: [],
    role_payload_rows: [],
    auth_surface_payload_rows: [],
    blocking_reasons: ["phase_f_payload_planner_not_evaluated"]
  };
  let phaseFReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_f_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    user_payload_rows: [],
    role_payload_rows: [],
    auth_surface_payload_rows: [],
    blocking_reasons: ["phase_f_payload_planner_not_evaluated"]
  };
  let phaseFExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 100
  };
  let phaseFExecutionGuard = {
    execution_guard_status: "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_f_execution_guard_not_evaluated"]
  };
  let phaseFExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_f_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_f_execution_guard_not_evaluated"]
  };
  let phaseFMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_user_candidates: [],
    selected_role_candidates: [],
    selected_auth_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_f_mutation_candidates_not_evaluated"]
  };
  let phaseFMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_f_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_user_candidates: [],
    selected_role_candidates: [],
    selected_auth_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_f_mutation_candidates_not_evaluated"]
  };
  let phaseFMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    user_composed_payloads: [],
    role_composed_payloads: [],
    auth_surface_composed_payloads: [],
    blocking_reasons: ["phase_f_mutation_payloads_not_evaluated"]
  };
  let phaseFMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_f_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    user_composed_payloads: [],
    role_composed_payloads: [],
    auth_surface_composed_payloads: [],
    blocking_reasons: ["phase_f_mutation_payloads_not_evaluated"]
  };
  let phaseFDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_user_rows: [],
    simulated_role_rows: [],
    simulated_auth_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    },
    blocking_reasons: ["phase_f_dry_run_execution_not_evaluated"]
  };
  let phaseFDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_f_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_user_rows: [],
    simulated_role_rows: [],
    simulated_auth_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    },
    blocking_reasons: ["phase_f_dry_run_execution_not_evaluated"]
  };
  let phaseFFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_f_final_operator_handoff",
    artifact_version: "v1",
    phase_f_enabled: false,
    phase_f_inventory_only: true,
    phase_f_apply_requested: false,
    requested_auth_scope: {
      include_users: true,
      include_roles: true,
      include_auth_surface: true,
      max_users: 0
    },
    requested_auth_config: {},
    phase_f_gate_status: "blocked",
    phase_f_inventory_status: "blocked",
    phase_f_strategy_status: "blocked",
    phase_f_readiness_status: "blocked_for_users_roles_auth_reconciliation",
    phase_f_safe_candidate_status: "blocked",
    phase_f_payload_planner_status: "blocked",
    phase_f_execution_guard_status: "blocked_before_users_roles_auth_mutation",
    phase_f_mutation_selector_status: "blocked",
    phase_f_mutation_payload_status: "blocked",
    phase_f_dry_run_execution_status: "blocked",
    inventory_summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_f_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_users_roles_auth_blockers",
      "hold_users_roles_auth_mutation_execution",
      "no_users_roles_auth_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseGPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_redirects: true,
    include_metadata: true,
    include_taxonomy_seo: true,
    include_post_type_seo: true,
    max_items: 1000
  };
  let phaseGPlanStatus = {
    phase_g_status: "blocked",
    phase_g_ready: false,
    blocking_reasons: ["phase_g_not_evaluated"]
  };
  let phaseGGate = {
    phase_g_gate_status: "blocked",
    phase_g_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_g_gate_not_evaluated"]
  };
  let phaseGSeoInventory = {
    phase_g_inventory_status: "blocked",
    plugin_signals: {},
    redirect_rows: [],
    metadata_rows: [],
    taxonomy_seo_rows: [],
    post_type_seo_rows: [],
    summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    failures: []
  };
  let phaseGInventoryArtifact = {
    artifact_type: "wordpress_phase_g_seo_inventory",
    artifact_version: "v1",
    phase_g_gate_status: "blocked",
    phase_g_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    redirect_rows: [],
    metadata_rows: [],
    taxonomy_seo_rows: [],
    post_type_seo_rows: [],
    blocking_reasons: ["phase_g_not_evaluated"],
    failures: []
  };
  let phaseGNormalizedInventory = {
    normalized_redirect_rows: [],
    normalized_metadata_rows: [],
    normalized_taxonomy_seo_rows: [],
    normalized_post_type_seo_rows: [],
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    }
  };
  let phaseGNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_g_seo_strategy",
    artifact_version: "v1",
    phase_g_gate_status: "blocked",
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    normalized_redirect_rows: [],
    normalized_metadata_rows: [],
    normalized_taxonomy_seo_rows: [],
    normalized_post_type_seo_rows: [],
    blocking_reasons: ["phase_g_strategy_not_evaluated"]
  };
  let phaseGReadinessGate = {
    readiness_status: "blocked_for_seo_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    blocking_reasons: ["phase_g_readiness_not_evaluated"]
  };
  let phaseGSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    redirect_candidates: [],
    metadata_candidates: [],
    taxonomy_seo_candidates: [],
    post_type_seo_candidates: [],
    blocking_reasons: ["phase_g_safe_candidates_not_evaluated"]
  };
  let phaseGReadinessArtifact = {
    artifact_type: "wordpress_phase_g_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_seo_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    redirect_candidates: [],
    metadata_candidates: [],
    taxonomy_seo_candidates: [],
    post_type_seo_candidates: [],
    blocking_reasons: ["phase_g_readiness_not_evaluated"]
  };
  let phaseGReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    redirect_payload_rows: [],
    metadata_payload_rows: [],
    taxonomy_seo_payload_rows: [],
    post_type_seo_payload_rows: [],
    blocking_reasons: ["phase_g_payload_planner_not_evaluated"]
  };
  let phaseGReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_g_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    redirect_payload_rows: [],
    metadata_payload_rows: [],
    taxonomy_seo_payload_rows: [],
    post_type_seo_payload_rows: [],
    blocking_reasons: ["phase_g_payload_planner_not_evaluated"]
  };
  let phaseGExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };
  let phaseGExecutionGuard = {
    execution_guard_status: "blocked_before_seo_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_g_execution_guard_not_evaluated"]
  };
  let phaseGExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_g_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_seo_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_g_execution_guard_not_evaluated"]
  };
  let phaseGMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_redirect_candidates: [],
    selected_metadata_candidates: [],
    selected_taxonomy_seo_candidates: [],
    selected_post_type_seo_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_g_mutation_candidates_not_evaluated"]
  };
  let phaseGMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_g_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_redirect_candidates: [],
    selected_metadata_candidates: [],
    selected_taxonomy_seo_candidates: [],
    selected_post_type_seo_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_g_mutation_candidates_not_evaluated"]
  };
  let phaseGMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    redirect_composed_payloads: [],
    metadata_composed_payloads: [],
    taxonomy_seo_composed_payloads: [],
    post_type_seo_composed_payloads: [],
    blocking_reasons: ["phase_g_mutation_payloads_not_evaluated"]
  };
  let phaseGMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_g_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    redirect_composed_payloads: [],
    metadata_composed_payloads: [],
    taxonomy_seo_composed_payloads: [],
    post_type_seo_composed_payloads: [],
    blocking_reasons: ["phase_g_mutation_payloads_not_evaluated"]
  };
  let phaseGDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_redirect_rows: [],
    simulated_metadata_rows: [],
    simulated_taxonomy_seo_rows: [],
    simulated_post_type_seo_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    },
    blocking_reasons: ["phase_g_dry_run_execution_not_evaluated"]
  };
  let phaseGDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_g_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_redirect_rows: [],
    simulated_metadata_rows: [],
    simulated_taxonomy_seo_rows: [],
    simulated_post_type_seo_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    },
    blocking_reasons: ["phase_g_dry_run_execution_not_evaluated"]
  };
  let phaseGFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_g_final_operator_handoff",
    artifact_version: "v1",
    phase_g_enabled: false,
    phase_g_inventory_only: true,
    phase_g_apply_requested: false,
    requested_seo_scope: {
      include_redirects: true,
      include_metadata: true,
      include_taxonomy_seo: true,
      include_post_type_seo: true,
      max_items: 0
    },
    requested_seo_config: {},
    phase_g_gate_status: "blocked",
    phase_g_inventory_status: "blocked",
    phase_g_strategy_status: "blocked",
    phase_g_readiness_status: "blocked_for_seo_reconciliation",
    phase_g_safe_candidate_status: "blocked",
    phase_g_payload_planner_status: "blocked",
    phase_g_execution_guard_status: "blocked_before_seo_mutation",
    phase_g_mutation_selector_status: "blocked",
    phase_g_mutation_payload_status: "blocked",
    phase_g_dry_run_execution_status: "blocked",
    inventory_summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    plugin_signals: {},
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_g_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_seo_reconciliation_blockers",
      "hold_seo_mutation_execution",
      "no_seo_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseHPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_google_analytics: true,
    include_gtm: true,
    include_meta_pixel: true,
    include_tiktok_pixel: false,
    include_custom_tracking: true,
    max_items: 500
  };
  let phaseHPlanStatus = {
    phase_h_status: "blocked",
    phase_h_ready: false,
    blocking_reasons: ["phase_h_not_evaluated"]
  };
  let phaseHGate = {
    phase_h_gate_status: "blocked",
    phase_h_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_h_gate_not_evaluated"]
  };
  let phaseHAnalyticsInventory = {
    phase_h_inventory_status: "blocked",
    plugin_signals: {},
    tracking_rows: [],
    consent_rows: [],
    summary: {
      tracking_count: 0,
      consent_count: 0
    },
    failures: []
  };
  let phaseHInventoryArtifact = {
    artifact_type: "wordpress_phase_h_analytics_tracking_inventory",
    artifact_version: "v1",
    phase_h_gate_status: "blocked",
    phase_h_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      tracking_count: 0,
      consent_count: 0
    },
    tracking_rows: [],
    consent_rows: [],
    blocking_reasons: ["phase_h_not_evaluated"],
    failures: []
  };
  let phaseHNormalizedInventory = {
    normalized_tracking_rows: [],
    normalized_consent_rows: [],
    risk_summary: {
      tracking_total_count: 0,
      tracking_high_risk_count: 0,
      tracking_medium_risk_count: 0,
      consent_total_count: 0,
      consent_high_risk_count: 0,
      consent_medium_risk_count: 0
    }
  };
  let phaseHNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_h_analytics_tracking_strategy",
    artifact_version: "v1",
    phase_h_gate_status: "blocked",
    risk_summary: {
      tracking_total_count: 0,
      tracking_high_risk_count: 0,
      tracking_medium_risk_count: 0,
      consent_total_count: 0,
      consent_high_risk_count: 0,
      consent_medium_risk_count: 0
    },
    normalized_tracking_rows: [],
    normalized_consent_rows: [],
    blocking_reasons: ["phase_h_strategy_not_evaluated"]
  };
  let phaseHReadinessGate = {
    readiness_status: "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: false,
    tracking_high_risk_count: 0,
    tracking_medium_risk_count: 0,
    consent_high_risk_count: 0,
    consent_medium_risk_count: 0,
    blocking_reasons: ["phase_h_readiness_not_evaluated"]
  };
  let phaseHSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    tracking_candidates: [],
    consent_candidates: [],
    blocking_reasons: ["phase_h_safe_candidates_not_evaluated"]
  };
  let phaseHReadinessArtifact = {
    artifact_type: "wordpress_phase_h_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: false,
    tracking_high_risk_count: 0,
    tracking_medium_risk_count: 0,
    consent_high_risk_count: 0,
    consent_medium_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    tracking_candidates: [],
    consent_candidates: [],
    blocking_reasons: ["phase_h_readiness_not_evaluated"]
  };
  let phaseHReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    tracking_payload_rows: [],
    consent_payload_rows: [],
    blocking_reasons: ["phase_h_payload_planner_not_evaluated"]
  };
  let phaseHReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_h_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    tracking_payload_rows: [],
    consent_payload_rows: [],
    blocking_reasons: ["phase_h_payload_planner_not_evaluated"]
  };
  let phaseHExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };
  let phaseHExecutionGuard = {
    execution_guard_status: "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_h_execution_guard_not_evaluated"]
  };
  let phaseHExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_h_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_h_execution_guard_not_evaluated"]
  };
  let phaseHMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_tracking_candidates: [],
    selected_consent_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_h_mutation_candidates_not_evaluated"]
  };
  let phaseHMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_h_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_tracking_candidates: [],
    selected_consent_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_h_mutation_candidates_not_evaluated"]
  };
  let phaseHMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    tracking_composed_payloads: [],
    consent_composed_payloads: [],
    blocking_reasons: ["phase_h_mutation_payloads_not_evaluated"]
  };
  let phaseHMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_h_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    tracking_composed_payloads: [],
    consent_composed_payloads: [],
    blocking_reasons: ["phase_h_mutation_payloads_not_evaluated"]
  };

  if (apply) {
    deferredParentRepairs = await applyDeferredWordpressParentLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    deferredTaxonomyRepairs = await applyDeferredWordpressTaxonomyLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    deferredFeaturedMediaRepairs = await applyDeferredWordpressFeaturedMediaLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    const parentRepairVerification = await verifyDeferredWordpressParentRepairs({
      destinationSiteRef: wpContext?.destination || {},
      repairs: deferredParentRepairs,
      destinationStatuses
    });

    const taxonomyRepairVerification = await verifyDeferredWordpressTaxonomyRepairs({
      destinationSiteRef: wpContext?.destination || {},
      repairs: deferredTaxonomyRepairs,
      destinationStatuses
    });

    deferredParentReadbackChecks = parentRepairVerification.checks;
    deferredTaxonomyReadbackChecks = taxonomyRepairVerification.checks;
    deferredRepairFailures = [
      ...parentRepairVerification.failures,
      ...taxonomyRepairVerification.failures
    ];
  }

  const readbackChecks = [];
  for (const row of destinationStatuses) {
    const destinationId = Number(row.destination_id);
    if (!Number.isFinite(destinationId) || destinationId < 1) {
      row.readback_verified = false;
      continue;
    }

    const readbackResponse = await executeWordpressRestJsonRequest({
      siteRef: wpContext?.destination || {},
      method: "GET",
      restPath: `/wp/v2/${encodeURIComponent(
        normalizeWordpressCollectionSlug(row.post_type_collection || row.post_type)
      )}/${destinationId}`,
      query: { context: "edit" },
      authRequired: true
    });

    const verified =
      readbackResponse.ok &&
      Number(readbackResponse?.data?.id) === destinationId;

    row.readback_verified = verified;
    const readbackCheck = {
      destination_id: destinationId,
      post_type: row.post_type,
      post_type_collection: row.post_type_collection || row.post_type,
      verified,
      status_code: readbackResponse.status
    };
    row.readback_check = readbackCheck;
    readbackChecks.push(readbackCheck);
  }

  const allFailures = [...failures, ...deferredRepairFailures];

  phaseAPerTypeSummary = buildWordpressPhaseAPerTypeSummary({
    postTypes,
    destinationStatuses,
    failures: allFailures
  });
  phaseAOutcome = classifyWordpressPhaseAOutcome({
    apply,
    perTypeSummary: phaseAPerTypeSummary,
    failures: allFailures
  });

  phaseAOperatorArtifact = buildWordpressPhaseAOperatorArtifact({
    payload,
    phaseAOutcome,
    phaseAPerTypeSummary,
    failures: allFailures,
    postTypeResolution,
    phaseABatchTelemetry,
    phaseARetryTelemetry,
    batchPolicy,
    retryPolicy,
    phaseACheckpoint
  });

  phaseAPromotionGuard = evaluateWordpressPhaseAPromotionReadiness({
    phaseAOutcome,
    phaseAPerTypeSummary,
    destinationStatuses,
    deferredRepairFailures
  });

  selectivePublishCandidates = buildWordpressSelectivePublishCandidates({
    destinationStatuses,
    promotionGuard: phaseAPromotionGuard,
    limit: payload?.migration?.selective_publish_candidate_limit
  });

  selectivePublishPlan = resolveWordpressSelectivePublishPlan(payload);
  selectivePublishExecution = await executeWordpressSelectivePublish({
    destinationSiteRef: wpContext.destination,
    promotionGuard: phaseAPromotionGuard,
    plan: selectivePublishPlan,
    candidateBundle: selectivePublishCandidates
  });
  selectivePublishRollbackPlan = buildWordpressSelectivePublishRollbackPlan({
    execution: selectivePublishExecution
  });
  selectivePublishRollbackExecutionPlan =
    resolveWordpressSelectivePublishRollbackPlan(payload);

  selectivePublishRollbackExecution =
    await executeWordpressSelectivePublishRollback({
      destinationSiteRef: wpContext.destination,
      rollbackPlan: selectivePublishRollbackExecutionPlan,
      executionPlan: selectivePublishRollbackPlan
    });

  phaseACutoverJournal = buildWordpressPhaseACutoverJournal({
    payload,
    phaseAOutcome,
    promotionGuard: phaseAPromotionGuard,
    selectivePublishExecution,
    selectivePublishRollbackExecution,
    phaseACheckpoint,
    phaseAPerTypeSummary
  });

  phaseAFinalCutoverRecommendation =
    classifyWordpressPhaseAFinalCutoverRecommendation({
      phaseAOutcome,
      promotionGuard: phaseAPromotionGuard,
      selectivePublishExecution,
      selectivePublishRollbackExecution,
      phaseAPerTypeSummary
    });

  phaseAFinalOperatorHandoffBundle =
    buildWordpressPhaseAFinalOperatorHandoffBundle({
      payload,
      phaseAOutcome,
      promotionGuard: phaseAPromotionGuard,
      finalCutoverRecommendation: phaseAFinalCutoverRecommendation,
      operatorArtifact: phaseAOperatorArtifact,
      cutoverJournal: phaseACutoverJournal,
      selectivePublishCandidates,
      selectivePublishExecution,
      selectivePublishRollbackPlan,
      selectivePublishRollbackExecution,
      phaseAPerTypeSummary,
      phaseACheckpoint
    });

  phaseBPlan = resolveWordpressPhaseBPlan(payload);
  phaseBPlanStatus = assertWordpressPhaseBPlan(phaseBPlan);
  phaseBGate = buildWordpressBuilderPhaseBGate({
    phaseAFinalCutoverRecommendation,
    phaseBPlan,
    phaseBPlanStatus
  });

  phaseBInventoryAudit = await runWordpressBuilderAssetsInventoryAudit({
    payload,
    wpContext,
    phaseBPlan,
    phaseBGate
  });

  phaseBNormalizedAudit = buildWordpressPhaseBNormalizedAudit({
    auditRows: phaseBInventoryAudit.audit_rows
  });

  phaseBGraphStability = evaluateWordpressPhaseBGraphStability({
    dependencyGraphSummary: phaseBNormalizedAudit.dependency_graph_summary,
    normalizedAuditRows: phaseBNormalizedAudit.normalized_audit_rows,
    migrationBuckets: phaseBNormalizedAudit.migration_buckets
  });

  phaseBReadinessArtifact = buildWordpressPhaseBReadinessArtifact({
    phaseBPlan,
    phaseBGate,
    graphStability: phaseBGraphStability,
    dependencyGraphSummary: phaseBNormalizedAudit.dependency_graph_summary,
    familySummary: phaseBNormalizedAudit.family_summary
  });

  phaseBPlanningCandidates = buildWordpressPhaseBMigrationPlanningCandidates({
    graphStability: phaseBGraphStability,
    migrationBuckets: phaseBNormalizedAudit.migration_buckets,
    limit: payload?.migration?.builder_assets?.planning_candidate_limit
  });

  phaseBPlanningArtifact = buildWordpressPhaseBPlanningArtifact({
    planningCandidates: phaseBPlanningCandidates,
    graphStability: phaseBGraphStability
  });

  phaseBSequencePlanner = buildWordpressPhaseBSequencePlanner({
    planningCandidates: phaseBPlanningCandidates,
    normalizedAuditRows: phaseBNormalizedAudit.normalized_audit_rows
  });

  phaseBSequenceArtifact = buildWordpressPhaseBSequenceArtifact({
    planner: phaseBSequencePlanner
  });

  phaseBMappingPrerequisiteGate = buildWordpressPhaseBMappingPrerequisiteGate({
    sequencePlanner: phaseBSequencePlanner
  });

  phaseBMappingPrerequisiteArtifact = buildWordpressPhaseBMappingPrerequisiteArtifact({
    gate: phaseBMappingPrerequisiteGate
  });

  phaseBMappingPlanSkeleton = buildWordpressPhaseBMappingPlanSkeleton({
    mappingGate: phaseBMappingPrerequisiteGate
  });

  phaseBMappingPlanArtifact = buildWordpressPhaseBMappingPlanArtifact({
    mappingPlan: phaseBMappingPlanSkeleton
  });

  phaseBFieldMappingResolver = buildWordpressPhaseBFieldMappingResolver({
    mappingPlan: phaseBMappingPlanSkeleton
  });

  phaseBFieldMappingArtifact = buildWordpressPhaseBFieldMappingArtifact({
    resolver: phaseBFieldMappingResolver
  });

  phaseBDryRunPlanner = buildWordpressPhaseBDryRunMigrationPayloadPlanner({
    resolver: phaseBFieldMappingResolver,
    limit: payload?.migration?.builder_assets?.dry_run_payload_limit
  });

  phaseBDryRunArtifact = buildWordpressPhaseBDryRunArtifact({
    planner: phaseBDryRunPlanner
  });

  phaseBExecutionPlan = resolveWordpressPhaseBExecutionPlan(payload);
  phaseBExecutionGuard = buildWordpressPhaseBExecutionGuard({
    phaseBPlan,
    graphStability: phaseBGraphStability,
    mappingGate: phaseBMappingPrerequisiteGate,
    dryRunPlanner: phaseBDryRunPlanner,
    executionPlan: phaseBExecutionPlan
  });

  phaseBExecutionGuardArtifact = buildWordpressPhaseBExecutionGuardArtifact({
    guard: phaseBExecutionGuard
  });

  phaseBMutationCandidateSelector = buildWordpressPhaseBMutationCandidateSelector({
    executionGuard: phaseBExecutionGuard,
    fieldMappingResolver: phaseBFieldMappingResolver,
    executionPlan: phaseBExecutionPlan
  });

  phaseBMutationCandidateArtifact = buildWordpressPhaseBMutationCandidateArtifact({
    selector: phaseBMutationCandidateSelector
  });

  phaseBMutationPayloadComposer = buildWordpressPhaseBMutationPayloadComposer({
    selector: phaseBMutationCandidateSelector,
    resolver: phaseBFieldMappingResolver
  });

  phaseBMutationPayloadArtifact = buildWordpressPhaseBMutationPayloadArtifact({
    composer: phaseBMutationPayloadComposer
  });

  phaseBDryRunExecutionSimulator = buildWordpressPhaseBDryRunExecutionSimulator({
    composer: phaseBMutationPayloadComposer
  });

  phaseBDryRunExecutionArtifact = buildWordpressPhaseBDryRunExecutionArtifact({
    simulator: phaseBDryRunExecutionSimulator
  });

  phaseBFinalOperatorHandoffBundle = buildWordpressPhaseBFinalOperatorHandoffBundle({
    payload,
    phaseBPlan,
    phaseBGate,
    readinessArtifact: phaseBReadinessArtifact,
    planningArtifact: phaseBPlanningArtifact,
    sequenceArtifact: phaseBSequenceArtifact,
    mappingPrerequisiteArtifact: phaseBMappingPrerequisiteArtifact,
    mappingPlanArtifact: phaseBMappingPlanArtifact,
    fieldMappingArtifact: phaseBFieldMappingArtifact,
    dryRunArtifact: phaseBDryRunArtifact,
    executionGuardArtifact: phaseBExecutionGuardArtifact,
    mutationCandidateArtifact: phaseBMutationCandidateArtifact,
    mutationPayloadArtifact: phaseBMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseBDryRunExecutionArtifact,
    normalizedAudit: phaseBNormalizedAudit
  });

  phaseCPlan = resolveWordpressPhaseCPlan(payload);
  phaseCPlanStatus = assertWordpressPhaseCPlan(phaseCPlan);
  phaseCGate = buildWordpressPhaseCGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCPlanStatus,
    phaseCPlan
  });

  phaseCSettingsInventory = await collectWordpressSiteSettingsInventory({
    wpContext,
    phaseCGate,
    phaseCPlan
  });

  phaseCInventoryArtifact = buildWordpressPhaseCInventoryArtifact({
    inventory: phaseCSettingsInventory,
    gate: phaseCGate
  });

  phaseCNormalizedDiff = buildWordpressPhaseCNormalizedDiff({
    inventory: phaseCSettingsInventory
  });

  phaseCDiffArtifact = buildWordpressPhaseCDiffArtifact({
    normalizedDiff: phaseCNormalizedDiff,
    gate: phaseCGate
  });

  phaseCReconciliationReadiness = buildWordpressPhaseCReconciliationReadiness({
    phaseCPlan,
    phaseCGate,
    normalizedDiff: phaseCNormalizedDiff
  });

  phaseCSafeApplyCandidates = buildWordpressPhaseCSafeApplyCandidates({
    readiness: phaseCReconciliationReadiness,
    normalizedDiff: phaseCNormalizedDiff,
    limit: payload?.migration?.site_settings?.safe_apply_limit
  });

  phaseCReadinessArtifact = buildWordpressPhaseCReadinessArtifact({
    readiness: phaseCReconciliationReadiness,
    safeApplyCandidates: phaseCSafeApplyCandidates
  });

  phaseCReconciliationPayloadPlanner = buildWordpressPhaseCReconciliationPayloadPlanner({
    safeApplyCandidates: phaseCSafeApplyCandidates
  });

  phaseCReconciliationPayloadArtifact = buildWordpressPhaseCReconciliationPayloadArtifact({
    planner: phaseCReconciliationPayloadPlanner
  });

  phaseCExecutionPlan = resolveWordpressPhaseCExecutionPlan(payload);
  phaseCExecutionGuard = buildWordpressPhaseCExecutionGuard({
    phaseCPlan,
    phaseCGate,
    readiness: phaseCReconciliationReadiness,
    payloadPlanner: phaseCReconciliationPayloadPlanner,
    executionPlan: phaseCExecutionPlan
  });

  phaseCExecutionGuardArtifact = buildWordpressPhaseCExecutionGuardArtifact({
    guard: phaseCExecutionGuard
  });

  phaseCMutationCandidateSelector = buildWordpressPhaseCMutationCandidateSelector({
    executionGuard: phaseCExecutionGuard,
    payloadPlanner: phaseCReconciliationPayloadPlanner,
    executionPlan: phaseCExecutionPlan
  });

  phaseCMutationCandidateArtifact = buildWordpressPhaseCMutationCandidateArtifact({
    selector: phaseCMutationCandidateSelector
  });

  phaseCMutationPayloadComposer = buildWordpressPhaseCMutationPayloadComposer({
    selector: phaseCMutationCandidateSelector
  });

  phaseCMutationPayloadArtifact = buildWordpressPhaseCMutationPayloadArtifact({
    composer: phaseCMutationPayloadComposer
  });

  phaseCDryRunExecutionSimulator = buildWordpressPhaseCDryRunExecutionSimulator({
    composer: phaseCMutationPayloadComposer
  });

  phaseCDryRunExecutionArtifact = buildWordpressPhaseCDryRunExecutionArtifact({
    simulator: phaseCDryRunExecutionSimulator
  });

  phaseCFinalOperatorHandoffBundle = buildWordpressPhaseCFinalOperatorHandoffBundle({
    payload,
    phaseCPlan,
    phaseCGate,
    inventoryArtifact: phaseCInventoryArtifact,
    diffArtifact: phaseCDiffArtifact,
    readinessArtifact: phaseCReadinessArtifact,
    payloadArtifact: phaseCReconciliationPayloadArtifact,
    executionGuardArtifact: phaseCExecutionGuardArtifact,
    mutationCandidateArtifact: phaseCMutationCandidateArtifact,
    mutationPayloadArtifact: phaseCMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseCDryRunExecutionArtifact,
    normalizedDiff: phaseCNormalizedDiff
  });

  phaseDPlan = resolveWordpressPhaseDPlan(payload);
  phaseDPlanStatus = assertWordpressPhaseDPlan(phaseDPlan);
  phaseDGate = buildWordpressPhaseDGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDPlan,
    phaseDPlanStatus
  });

  phaseDFormsInventory = await runWordpressFormsIntegrationsInventory({
    wpContext,
    phaseDPlan,
    phaseDGate
  });

  phaseDInventoryArtifact = buildWordpressPhaseDInventoryArtifact({
    inventory: phaseDFormsInventory,
    gate: phaseDGate
  });

  phaseDNormalizedInventory = buildWordpressPhaseDNormalizedInventory({
    inventory: phaseDFormsInventory
  });

  phaseDNormalizedInventoryArtifact = buildWordpressPhaseDNormalizedInventoryArtifact({
    normalizedInventory: phaseDNormalizedInventory,
    gate: phaseDGate
  });

  phaseDReadinessGate = buildWordpressPhaseDReadinessGate({
    phaseDPlan,
    phaseDGate,
    normalizedInventory: phaseDNormalizedInventory
  });

  phaseDSafeCandidates = buildWordpressPhaseDSafeCandidates({
    readiness: phaseDReadinessGate,
    normalizedInventory: phaseDNormalizedInventory,
    limit: payload?.migration?.forms_integrations?.safe_candidate_limit
  });

  phaseDReadinessArtifact = buildWordpressPhaseDReadinessArtifact({
    readiness: phaseDReadinessGate,
    safeCandidates: phaseDSafeCandidates
  });

  phaseDMigrationPayloadPlanner = buildWordpressPhaseDMigrationPayloadPlanner({
    safeCandidates: phaseDSafeCandidates
  });

  phaseDMigrationPayloadArtifact = buildWordpressPhaseDMigrationPayloadArtifact({
    planner: phaseDMigrationPayloadPlanner
  });

  phaseDExecutionPlan = resolveWordpressPhaseDExecutionPlan(payload);
  phaseDExecutionGuard = buildWordpressPhaseDExecutionGuard({
    phaseDPlan,
    phaseDGate,
    readiness: phaseDReadinessGate,
    payloadPlanner: phaseDMigrationPayloadPlanner,
    executionPlan: phaseDExecutionPlan
  });

  phaseDExecutionGuardArtifact = buildWordpressPhaseDExecutionGuardArtifact({
    guard: phaseDExecutionGuard
  });

  phaseDMutationCandidateSelector = buildWordpressPhaseDMutationCandidateSelector({
    executionGuard: phaseDExecutionGuard,
    payloadPlanner: phaseDMigrationPayloadPlanner,
    executionPlan: phaseDExecutionPlan
  });

  phaseDMutationCandidateArtifact = buildWordpressPhaseDMutationCandidateArtifact({
    selector: phaseDMutationCandidateSelector
  });

  phaseDMutationPayloadComposer = buildWordpressPhaseDMutationPayloadComposer({
    selector: phaseDMutationCandidateSelector
  });

  phaseDMutationPayloadArtifact = buildWordpressPhaseDMutationPayloadArtifact({
    composer: phaseDMutationPayloadComposer
  });

  phaseDDryRunExecutionSimulator = buildWordpressPhaseDDryRunExecutionSimulator({
    composer: phaseDMutationPayloadComposer
  });

  phaseDDryRunExecutionArtifact = buildWordpressPhaseDDryRunExecutionArtifact({
    simulator: phaseDDryRunExecutionSimulator
  });

  phaseDFinalOperatorHandoffBundle = buildWordpressPhaseDFinalOperatorHandoffBundle({
    payload,
    phaseDPlan,
    phaseDGate,
    inventoryArtifact: phaseDInventoryArtifact,
    normalizedInventoryArtifact: phaseDNormalizedInventoryArtifact,
    readinessArtifact: phaseDReadinessArtifact,
    migrationPayloadArtifact: phaseDMigrationPayloadArtifact,
    executionGuardArtifact: phaseDExecutionGuardArtifact,
    mutationCandidateArtifact: phaseDMutationCandidateArtifact,
    mutationPayloadArtifact: phaseDMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseDDryRunExecutionArtifact,
    normalizedInventory: phaseDNormalizedInventory
  });

  phaseEPlan = resolveWordpressPhaseEPlan(payload);
  phaseEPlanStatus = assertWordpressPhaseEPlan(phaseEPlan);
  phaseEGate = buildWordpressPhaseEGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEPlan,
    phaseEPlanStatus
  });

  phaseEMediaInventory = await runWordpressMediaInventory({
    wpContext,
    phaseEPlan,
    phaseEGate
  });

  phaseEInventoryArtifact = buildWordpressPhaseEInventoryArtifact({
    inventory: phaseEMediaInventory,
    gate: phaseEGate
  });

  phaseENormalizedInventory = buildWordpressPhaseENormalizedInventory({
    inventory: phaseEMediaInventory,
    phaseEPlan
  });

  phaseENormalizedInventoryArtifact = buildWordpressPhaseENormalizedInventoryArtifact({
    normalizedInventory: phaseENormalizedInventory,
    gate: phaseEGate
  });

  phaseEReadinessGate = buildWordpressPhaseEReadinessGate({
    phaseEPlan,
    phaseEGate,
    normalizedInventory: phaseENormalizedInventory
  });

  phaseESafeCandidates = buildWordpressPhaseESafeCandidates({
    readiness: phaseEReadinessGate,
    normalizedInventory: phaseENormalizedInventory,
    limit: payload?.migration?.media_assets?.safe_candidate_limit
  });

  phaseEReadinessArtifact = buildWordpressPhaseEReadinessArtifact({
    readiness: phaseEReadinessGate,
    safeCandidates: phaseESafeCandidates
  });

  phaseEMigrationPayloadPlanner = buildWordpressPhaseEMigrationPayloadPlanner({
    safeCandidates: phaseESafeCandidates
  });

  phaseEMigrationPayloadArtifact = buildWordpressPhaseEMigrationPayloadArtifact({
    planner: phaseEMigrationPayloadPlanner
  });

  phaseEExecutionPlan = resolveWordpressPhaseEExecutionPlan(payload);
  phaseEExecutionGuard = buildWordpressPhaseEExecutionGuard({
    phaseEPlan,
    phaseEGate,
    readiness: phaseEReadinessGate,
    payloadPlanner: phaseEMigrationPayloadPlanner,
    executionPlan: phaseEExecutionPlan
  });

  phaseEExecutionGuardArtifact = buildWordpressPhaseEExecutionGuardArtifact({
    guard: phaseEExecutionGuard
  });

  phaseEMutationCandidateSelector = buildWordpressPhaseEMutationCandidateSelector({
    executionGuard: phaseEExecutionGuard,
    payloadPlanner: phaseEMigrationPayloadPlanner,
    executionPlan: phaseEExecutionPlan
  });

  phaseEMutationCandidateArtifact = buildWordpressPhaseEMutationCandidateArtifact({
    selector: phaseEMutationCandidateSelector
  });

  phaseEMutationPayloadComposer = buildWordpressPhaseEMutationPayloadComposer({
    selector: phaseEMutationCandidateSelector
  });

  phaseEMutationPayloadArtifact = buildWordpressPhaseEMutationPayloadArtifact({
    composer: phaseEMutationPayloadComposer
  });

  phaseEDryRunExecutionSimulator = buildWordpressPhaseEDryRunExecutionSimulator({
    composer: phaseEMutationPayloadComposer
  });

  phaseEDryRunExecutionArtifact = buildWordpressPhaseEDryRunExecutionArtifact({
    simulator: phaseEDryRunExecutionSimulator
  });

  phaseEFinalOperatorHandoffBundle = buildWordpressPhaseEFinalOperatorHandoffBundle({
    payload,
    phaseEPlan,
    phaseEGate,
    inventoryArtifact: phaseEInventoryArtifact,
    normalizedInventoryArtifact: phaseENormalizedInventoryArtifact,
    readinessArtifact: phaseEReadinessArtifact,
    migrationPayloadArtifact: phaseEMigrationPayloadArtifact,
    executionGuardArtifact: phaseEExecutionGuardArtifact,
    mutationCandidateArtifact: phaseEMutationCandidateArtifact,
    mutationPayloadArtifact: phaseEMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseEDryRunExecutionArtifact,
    normalizedInventory: phaseENormalizedInventory
  });

  phaseFPlan = resolveWordpressPhaseFPlan(payload);
  phaseFPlanStatus = assertWordpressPhaseFPlan(phaseFPlan);
  phaseFGate = buildWordpressPhaseFGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFPlan,
    phaseFPlanStatus
  });

  phaseFUsersRolesAuthInventory = await runWordpressUsersRolesAuthInventory({
    wpContext,
    phaseFPlan,
    phaseFGate
  });

  phaseFInventoryArtifact = buildWordpressPhaseFInventoryArtifact({
    inventory: phaseFUsersRolesAuthInventory,
    gate: phaseFGate
  });

  phaseFNormalizedInventory = buildWordpressPhaseFNormalizedInventory({
    inventory: phaseFUsersRolesAuthInventory
  });

  phaseFNormalizedInventoryArtifact = buildWordpressPhaseFNormalizedInventoryArtifact({
    normalizedInventory: phaseFNormalizedInventory,
    gate: phaseFGate
  });

  phaseFReadinessGate = buildWordpressPhaseFReadinessGate({
    phaseFPlan,
    phaseFGate,
    normalizedInventory: phaseFNormalizedInventory
  });

  phaseFSafeCandidates = buildWordpressPhaseFSafeCandidates({
    readiness: phaseFReadinessGate,
    normalizedInventory: phaseFNormalizedInventory,
    limit: payload?.migration?.users_roles_auth?.safe_candidate_limit
  });

  phaseFReadinessArtifact = buildWordpressPhaseFReadinessArtifact({
    readiness: phaseFReadinessGate,
    safeCandidates: phaseFSafeCandidates
  });

  phaseFReconciliationPayloadPlanner = buildWordpressPhaseFReconciliationPayloadPlanner({
    safeCandidates: phaseFSafeCandidates
  });

  phaseFReconciliationPayloadArtifact = buildWordpressPhaseFReconciliationPayloadArtifact({
    planner: phaseFReconciliationPayloadPlanner
  });

  phaseFExecutionPlan = resolveWordpressPhaseFExecutionPlan(payload);
  phaseFExecutionGuard = buildWordpressPhaseFExecutionGuard({
    phaseFPlan,
    phaseFGate,
    readiness: phaseFReadinessGate,
    payloadPlanner: phaseFReconciliationPayloadPlanner,
    executionPlan: phaseFExecutionPlan
  });

  phaseFExecutionGuardArtifact = buildWordpressPhaseFExecutionGuardArtifact({
    guard: phaseFExecutionGuard
  });

  phaseFMutationCandidateSelector = buildWordpressPhaseFMutationCandidateSelector({
    executionGuard: phaseFExecutionGuard,
    payloadPlanner: phaseFReconciliationPayloadPlanner,
    executionPlan: phaseFExecutionPlan
  });

  phaseFMutationCandidateArtifact = buildWordpressPhaseFMutationCandidateArtifact({
    selector: phaseFMutationCandidateSelector
  });

  phaseFMutationPayloadComposer = buildWordpressPhaseFMutationPayloadComposer({
    selector: phaseFMutationCandidateSelector
  });

  phaseFMutationPayloadArtifact = buildWordpressPhaseFMutationPayloadArtifact({
    composer: phaseFMutationPayloadComposer
  });

  phaseFDryRunExecutionSimulator = buildWordpressPhaseFDryRunExecutionSimulator({
    composer: phaseFMutationPayloadComposer
  });

  phaseFDryRunExecutionArtifact = buildWordpressPhaseFDryRunExecutionArtifact({
    simulator: phaseFDryRunExecutionSimulator
  });

  phaseFFinalOperatorHandoffBundle = buildWordpressPhaseFFinalOperatorHandoffBundle({
    payload,
    phaseFPlan,
    phaseFGate,
    inventoryArtifact: phaseFInventoryArtifact,
    normalizedInventoryArtifact: phaseFNormalizedInventoryArtifact,
    readinessArtifact: phaseFReadinessArtifact,
    reconciliationPayloadArtifact: phaseFReconciliationPayloadArtifact,
    executionGuardArtifact: phaseFExecutionGuardArtifact,
    mutationCandidateArtifact: phaseFMutationCandidateArtifact,
    mutationPayloadArtifact: phaseFMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseFDryRunExecutionArtifact,
    normalizedInventory: phaseFNormalizedInventory
  });

  phaseGPlan = resolveWordpressPhaseGPlan(payload);
  phaseGPlanStatus = assertWordpressPhaseGPlan(phaseGPlan);
  phaseGGate = buildWordpressPhaseGGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGPlan,
    phaseGPlanStatus
  });

  phaseGSeoInventory = await runWordpressSeoInventory({
    wpContext,
    phaseGPlan,
    phaseGGate
  });

  phaseGInventoryArtifact = buildWordpressPhaseGInventoryArtifact({
    inventory: phaseGSeoInventory,
    gate: phaseGGate
  });

  phaseGNormalizedInventory = buildWordpressPhaseGNormalizedInventory({
    inventory: phaseGSeoInventory
  });

  phaseGNormalizedInventoryArtifact = buildWordpressPhaseGNormalizedInventoryArtifact({
    normalizedInventory: phaseGNormalizedInventory,
    gate: phaseGGate
  });

  phaseGReadinessGate = buildWordpressPhaseGReadinessGate({
    phaseGPlan,
    phaseGGate,
    normalizedInventory: phaseGNormalizedInventory
  });

  phaseGSafeCandidates = buildWordpressPhaseGSafeCandidates({
    readiness: phaseGReadinessGate,
    normalizedInventory: phaseGNormalizedInventory,
    limit: payload?.migration?.seo_surfaces?.safe_candidate_limit
  });

  phaseGReadinessArtifact = buildWordpressPhaseGReadinessArtifact({
    readiness: phaseGReadinessGate,
    safeCandidates: phaseGSafeCandidates
  });

  phaseGReconciliationPayloadPlanner = buildWordpressPhaseGReconciliationPayloadPlanner({
    safeCandidates: phaseGSafeCandidates
  });

  phaseGReconciliationPayloadArtifact = buildWordpressPhaseGReconciliationPayloadArtifact({
    planner: phaseGReconciliationPayloadPlanner
  });

  phaseGExecutionPlan = resolveWordpressPhaseGExecutionPlan(payload);
  phaseGExecutionGuard = buildWordpressPhaseGExecutionGuard({
    phaseGPlan,
    phaseGGate,
    readiness: phaseGReadinessGate,
    payloadPlanner: phaseGReconciliationPayloadPlanner,
    executionPlan: phaseGExecutionPlan
  });

  phaseGExecutionGuardArtifact = buildWordpressPhaseGExecutionGuardArtifact({
    guard: phaseGExecutionGuard
  });

  phaseGMutationCandidateSelector = buildWordpressPhaseGMutationCandidateSelector({
    executionGuard: phaseGExecutionGuard,
    payloadPlanner: phaseGReconciliationPayloadPlanner,
    executionPlan: phaseGExecutionPlan
  });

  phaseGMutationCandidateArtifact = buildWordpressPhaseGMutationCandidateArtifact({
    selector: phaseGMutationCandidateSelector
  });

  phaseGMutationPayloadComposer = buildWordpressPhaseGMutationPayloadComposer({
    selector: phaseGMutationCandidateSelector
  });

  phaseGMutationPayloadArtifact = buildWordpressPhaseGMutationPayloadArtifact({
    composer: phaseGMutationPayloadComposer
  });

  phaseGDryRunExecutionSimulator = buildWordpressPhaseGDryRunExecutionSimulator({
    composer: phaseGMutationPayloadComposer
  });

  phaseGDryRunExecutionArtifact = buildWordpressPhaseGDryRunExecutionArtifact({
    simulator: phaseGDryRunExecutionSimulator
  });

  phaseGFinalOperatorHandoffBundle = buildWordpressPhaseGFinalOperatorHandoffBundle({
    payload,
    phaseGPlan,
    phaseGGate,
    inventoryArtifact: phaseGInventoryArtifact,
    normalizedInventoryArtifact: phaseGNormalizedInventoryArtifact,
    readinessArtifact: phaseGReadinessArtifact,
    reconciliationPayloadArtifact: phaseGReconciliationPayloadArtifact,
    executionGuardArtifact: phaseGExecutionGuardArtifact,
    mutationCandidateArtifact: phaseGMutationCandidateArtifact,
    mutationPayloadArtifact: phaseGMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseGDryRunExecutionArtifact,
    normalizedInventory: phaseGNormalizedInventory
  });

  phaseHPlan = resolveWordpressPhaseHPlan(payload);
  phaseHPlanStatus = assertWordpressPhaseHPlan(phaseHPlan);
  phaseHGate = buildWordpressPhaseHGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGFinalOperatorHandoffBundle,
    phaseHPlan,
    phaseHPlanStatus
  });

  phaseHAnalyticsInventory = await runWordpressAnalyticsTrackingInventory({
    wpContext,
    phaseHPlan,
    phaseHGate
  });

  phaseHInventoryArtifact = buildWordpressPhaseHInventoryArtifact({
    inventory: phaseHAnalyticsInventory,
    gate: phaseHGate
  });

  phaseHNormalizedInventory = buildWordpressPhaseHNormalizedInventory({
    inventory: phaseHAnalyticsInventory
  });

  phaseHNormalizedInventoryArtifact = buildWordpressPhaseHNormalizedInventoryArtifact({
    normalizedInventory: phaseHNormalizedInventory,
    gate: phaseHGate
  });

  phaseHReadinessGate = buildWordpressPhaseHReadinessGate({
    phaseHPlan,
    phaseHGate,
    normalizedInventory: phaseHNormalizedInventory
  });

  phaseHSafeCandidates = buildWordpressPhaseHSafeCandidates({
    readiness: phaseHReadinessGate,
    normalizedInventory: phaseHNormalizedInventory,
    limit: payload?.migration?.analytics_tracking?.safe_candidate_limit
  });

  phaseHReadinessArtifact = buildWordpressPhaseHReadinessArtifact({
    readiness: phaseHReadinessGate,
    safeCandidates: phaseHSafeCandidates
  });

  phaseHReconciliationPayloadPlanner = buildWordpressPhaseHReconciliationPayloadPlanner({
    safeCandidates: phaseHSafeCandidates
  });

  phaseHReconciliationPayloadArtifact = buildWordpressPhaseHReconciliationPayloadArtifact({
    planner: phaseHReconciliationPayloadPlanner
  });

  phaseHExecutionPlan = resolveWordpressPhaseHExecutionPlan(payload);
  phaseHExecutionGuard = buildWordpressPhaseHExecutionGuard({
    phaseHPlan,
    phaseHGate,
    readiness: phaseHReadinessGate,
    payloadPlanner: phaseHReconciliationPayloadPlanner,
    executionPlan: phaseHExecutionPlan
  });

  phaseHExecutionGuardArtifact = buildWordpressPhaseHExecutionGuardArtifact({
    guard: phaseHExecutionGuard
  });

  const readbackVerified =
    destinationStatuses.length > 0 &&
    destinationStatuses.every(row => row.readback_verified === true) &&
    deferredRepairFailures.length === 0;

  const destinationIds = [
    ...new Set(
      destinationStatuses
        .map(row => Number(row.destination_id))
        .filter(id => Number.isFinite(id) && id > 0)
    )
  ];

  const mutationEvidence = {
    transport: "wordpress_connector",
    apply: true,
    parent_action_key: "wordpress_api",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_scope_classifications: phaseAScopeClassifications,
    phase_a_execution_order: postTypes,
    phase_a_batch_policy: batchPolicy,
    phase_a_batch_telemetry: phaseABatchTelemetry,
    phase_a_retry_policy: retryPolicy,
    phase_a_retry_telemetry: phaseARetryTelemetry,
    phase_a_resume_policy: resumePolicy,
    phase_a_checkpoint: phaseACheckpoint,
    phase_a_per_type_summary: phaseAPerTypeSummary,
    phase_a_outcome: phaseAOutcome.phase_a_outcome,
    phase_a_outcome_message: phaseAOutcome.phase_a_outcome_message,
    phase_a_operator_artifact: phaseAOperatorArtifact,
    phase_a_promotion_guard: phaseAPromotionGuard,
    selective_publish_candidates: selectivePublishCandidates,
    selective_publish_plan: selectivePublishPlan,
    selective_publish_execution: selectivePublishExecution,
    selective_publish_rollback_plan: selectivePublishRollbackPlan,
    selective_publish_rollback_execution_plan: selectivePublishRollbackExecutionPlan,
    selective_publish_rollback_execution: selectivePublishRollbackExecution,
    phase_a_cutover_journal: phaseACutoverJournal,
    phase_a_final_cutover_recommendation: phaseAFinalCutoverRecommendation,
    phase_a_final_operator_handoff_bundle: phaseAFinalOperatorHandoffBundle,
    phase_b_plan: phaseBPlan,
    phase_b_plan_status: phaseBPlanStatus,
    phase_b_gate: phaseBGate,
    phase_b_inventory_audit: phaseBInventoryAudit,
    phase_b_normalized_audit: phaseBNormalizedAudit,
    phase_b_graph_stability: phaseBGraphStability,
    phase_b_readiness_artifact: phaseBReadinessArtifact,
    phase_b_planning_candidates: phaseBPlanningCandidates,
    phase_b_planning_artifact: phaseBPlanningArtifact,
    phase_b_sequence_planner: phaseBSequencePlanner,
    phase_b_sequence_artifact: phaseBSequenceArtifact,
    phase_b_mapping_prerequisite_gate: phaseBMappingPrerequisiteGate,
    phase_b_mapping_prerequisite_artifact: phaseBMappingPrerequisiteArtifact,
    phase_b_mapping_plan_skeleton: phaseBMappingPlanSkeleton,
    phase_b_mapping_plan_artifact: phaseBMappingPlanArtifact,
    phase_b_field_mapping_resolver: phaseBFieldMappingResolver,
    phase_b_field_mapping_artifact: phaseBFieldMappingArtifact,
    phase_b_dry_run_planner: phaseBDryRunPlanner,
    phase_b_dry_run_artifact: phaseBDryRunArtifact,
    phase_b_execution_plan: phaseBExecutionPlan,
    phase_b_execution_guard: phaseBExecutionGuard,
    phase_b_execution_guard_artifact: phaseBExecutionGuardArtifact,
    phase_b_mutation_candidate_selector: phaseBMutationCandidateSelector,
    phase_b_mutation_candidate_artifact: phaseBMutationCandidateArtifact,
    phase_b_mutation_payload_composer: phaseBMutationPayloadComposer,
    phase_b_mutation_payload_artifact: phaseBMutationPayloadArtifact,
    phase_b_dry_run_execution_simulator: phaseBDryRunExecutionSimulator,
    phase_b_dry_run_execution_artifact: phaseBDryRunExecutionArtifact,
    phase_b_final_operator_handoff_bundle: phaseBFinalOperatorHandoffBundle,
    phase_c_plan: phaseCPlan,
    phase_c_plan_status: phaseCPlanStatus,
    phase_c_gate: phaseCGate,
    phase_c_settings_inventory: phaseCSettingsInventory,
    phase_c_inventory_artifact: phaseCInventoryArtifact,
    phase_c_normalized_diff: phaseCNormalizedDiff,
    phase_c_diff_artifact: phaseCDiffArtifact,
    phase_c_reconciliation_readiness: phaseCReconciliationReadiness,
    phase_c_safe_apply_candidates: phaseCSafeApplyCandidates,
    phase_c_readiness_artifact: phaseCReadinessArtifact,
    phase_c_reconciliation_payload_planner: phaseCReconciliationPayloadPlanner,
    phase_c_reconciliation_payload_artifact: phaseCReconciliationPayloadArtifact,
    phase_c_execution_plan: phaseCExecutionPlan,
    phase_c_execution_guard: phaseCExecutionGuard,
    phase_c_execution_guard_artifact: phaseCExecutionGuardArtifact,
    phase_c_mutation_candidate_selector: phaseCMutationCandidateSelector,
    phase_c_mutation_candidate_artifact: phaseCMutationCandidateArtifact,
    phase_c_mutation_payload_composer: phaseCMutationPayloadComposer,
    phase_c_mutation_payload_artifact: phaseCMutationPayloadArtifact,
    phase_c_dry_run_execution_simulator: phaseCDryRunExecutionSimulator,
    phase_c_dry_run_execution_artifact: phaseCDryRunExecutionArtifact,
    phase_c_final_operator_handoff_bundle: phaseCFinalOperatorHandoffBundle,
    phase_d_plan: phaseDPlan,
    phase_d_plan_status: phaseDPlanStatus,
    phase_d_gate: phaseDGate,
    phase_d_forms_inventory: phaseDFormsInventory,
    phase_d_inventory_artifact: phaseDInventoryArtifact,
    phase_d_normalized_inventory: phaseDNormalizedInventory,
    phase_d_normalized_inventory_artifact: phaseDNormalizedInventoryArtifact,
    phase_d_readiness_gate: phaseDReadinessGate,
    phase_d_safe_candidates: phaseDSafeCandidates,
    phase_d_readiness_artifact: phaseDReadinessArtifact,
    phase_d_migration_payload_planner: phaseDMigrationPayloadPlanner,
    phase_d_migration_payload_artifact: phaseDMigrationPayloadArtifact,
    phase_d_execution_plan: phaseDExecutionPlan,
    phase_d_execution_guard: phaseDExecutionGuard,
    phase_d_execution_guard_artifact: phaseDExecutionGuardArtifact,
    phase_d_mutation_candidate_selector: phaseDMutationCandidateSelector,
    phase_d_mutation_candidate_artifact: phaseDMutationCandidateArtifact,
    phase_d_mutation_payload_composer: phaseDMutationPayloadComposer,
    phase_d_mutation_payload_artifact: phaseDMutationPayloadArtifact,
    phase_d_dry_run_execution_simulator: phaseDDryRunExecutionSimulator,
    phase_d_dry_run_execution_artifact: phaseDDryRunExecutionArtifact,
    phase_d_final_operator_handoff_bundle: phaseDFinalOperatorHandoffBundle,
    phase_e_plan: phaseEPlan,
    phase_e_plan_status: phaseEPlanStatus,
    phase_e_gate: phaseEGate,
    phase_e_media_inventory: phaseEMediaInventory,
    phase_e_inventory_artifact: phaseEInventoryArtifact,
    phase_e_normalized_inventory: phaseENormalizedInventory,
    phase_e_normalized_inventory_artifact: phaseENormalizedInventoryArtifact,
    phase_e_readiness_gate: phaseEReadinessGate,
    phase_e_safe_candidates: phaseESafeCandidates,
    phase_e_readiness_artifact: phaseEReadinessArtifact,
    phase_e_migration_payload_planner: phaseEMigrationPayloadPlanner,
    phase_e_migration_payload_artifact: phaseEMigrationPayloadArtifact,
    phase_e_execution_plan: phaseEExecutionPlan,
    phase_e_execution_guard: phaseEExecutionGuard,
    phase_e_execution_guard_artifact: phaseEExecutionGuardArtifact,
    phase_e_mutation_candidate_selector: phaseEMutationCandidateSelector,
    phase_e_mutation_candidate_artifact: phaseEMutationCandidateArtifact,
    phase_e_mutation_payload_composer: phaseEMutationPayloadComposer,
    phase_e_mutation_payload_artifact: phaseEMutationPayloadArtifact,
    phase_e_dry_run_execution_simulator: phaseEDryRunExecutionSimulator,
    phase_e_dry_run_execution_artifact: phaseEDryRunExecutionArtifact,
    phase_e_final_operator_handoff_bundle: phaseEFinalOperatorHandoffBundle,
    phase_f_plan: phaseFPlan,
    phase_f_plan_status: phaseFPlanStatus,
    phase_f_gate: phaseFGate,
    phase_f_users_roles_auth_inventory: phaseFUsersRolesAuthInventory,
    phase_f_inventory_artifact: phaseFInventoryArtifact,
    phase_f_normalized_inventory: phaseFNormalizedInventory,
    phase_f_normalized_inventory_artifact: phaseFNormalizedInventoryArtifact,
    phase_f_readiness_gate: phaseFReadinessGate,
    phase_f_safe_candidates: phaseFSafeCandidates,
    phase_f_readiness_artifact: phaseFReadinessArtifact,
    phase_f_reconciliation_payload_planner: phaseFReconciliationPayloadPlanner,
    phase_f_reconciliation_payload_artifact: phaseFReconciliationPayloadArtifact,
    phase_f_execution_plan: phaseFExecutionPlan,
    phase_f_execution_guard: phaseFExecutionGuard,
    phase_f_execution_guard_artifact: phaseFExecutionGuardArtifact,
    phase_f_mutation_candidate_selector: phaseFMutationCandidateSelector,
    phase_f_mutation_candidate_artifact: phaseFMutationCandidateArtifact,
    phase_f_mutation_payload_composer: phaseFMutationPayloadComposer,
    phase_f_mutation_payload_artifact: phaseFMutationPayloadArtifact,
    phase_f_dry_run_execution_simulator: phaseFDryRunExecutionSimulator,
    phase_f_dry_run_execution_artifact: phaseFDryRunExecutionArtifact,
    phase_f_final_operator_handoff_bundle: phaseFFinalOperatorHandoffBundle,
    phase_g_plan: phaseGPlan,
    phase_g_plan_status: phaseGPlanStatus,
    phase_g_gate: phaseGGate,
    phase_g_seo_inventory: phaseGSeoInventory,
    phase_g_inventory_artifact: phaseGInventoryArtifact,
    phase_g_normalized_inventory: phaseGNormalizedInventory,
    phase_g_normalized_inventory_artifact: phaseGNormalizedInventoryArtifact,
    phase_g_readiness_gate: phaseGReadinessGate,
    phase_g_safe_candidates: phaseGSafeCandidates,
    phase_g_readiness_artifact: phaseGReadinessArtifact,
    phase_g_reconciliation_payload_planner: phaseGReconciliationPayloadPlanner,
    phase_g_reconciliation_payload_artifact: phaseGReconciliationPayloadArtifact,
    phase_g_execution_plan: phaseGExecutionPlan,
    phase_g_execution_guard: phaseGExecutionGuard,
    phase_g_execution_guard_artifact: phaseGExecutionGuardArtifact,
    phase_g_mutation_candidate_selector: phaseGMutationCandidateSelector,
    phase_g_mutation_candidate_artifact: phaseGMutationCandidateArtifact,
    phase_g_mutation_payload_composer: phaseGMutationPayloadComposer,
    phase_g_mutation_payload_artifact: phaseGMutationPayloadArtifact,
    phase_g_dry_run_execution_simulator: phaseGDryRunExecutionSimulator,
    phase_g_dry_run_execution_artifact: phaseGDryRunExecutionArtifact,
    phase_g_final_operator_handoff_bundle: phaseGFinalOperatorHandoffBundle,
    phase_h_plan: phaseHPlan,
    phase_h_plan_status: phaseHPlanStatus,
    phase_h_gate: phaseHGate,
    phase_h_analytics_inventory: phaseHAnalyticsInventory,
    phase_h_inventory_artifact: phaseHInventoryArtifact,
    phase_h_normalized_inventory: phaseHNormalizedInventory,
    phase_h_normalized_inventory_artifact: phaseHNormalizedInventoryArtifact,
    phase_h_readiness_gate: phaseHReadinessGate,
    phase_h_safe_candidates: phaseHSafeCandidates,
    phase_h_readiness_artifact: phaseHReadinessArtifact,
    phase_h_reconciliation_payload_planner: phaseHReconciliationPayloadPlanner,
    phase_h_reconciliation_payload_artifact: phaseHReconciliationPayloadArtifact,
    phase_h_execution_plan: phaseHExecutionPlan,
    phase_h_execution_guard: phaseHExecutionGuard,
    phase_h_execution_guard_artifact: phaseHExecutionGuardArtifact,
    phase_h_mutation_candidate_selector: phaseHMutationCandidateSelector,
    phase_h_mutation_candidate_artifact: phaseHMutationCandidateArtifact,
    phase_h_mutation_payload_composer: phaseHMutationPayloadComposer,
    phase_h_mutation_payload_artifact: phaseHMutationPayloadArtifact,
    governed_resolution_domain: "endpoint_registry_adapter",
    governed_resolution_query: governedResolutionRecords.map(x => x.normalized_query),
    governed_resolution_selected_candidate: governedResolutionRecords.map(
      x => x.selected_candidate_key
    ),
    governed_resolution_confidence: governedResolutionRecords.map(
      x => x.selection_confidence
    ),
    governed_resolution_basis: governedResolutionRecords.map(
      x => x.selection_basis
    ),
    governed_resolution_rejected_candidates: governedResolutionRecords.map(
      x => x.rejected_candidate_summary
    ),
    generated_candidate: generatedCandidateEvidence.length > 0,
    generated_candidate_family: generatedCandidateEvidence,
    taxonomy_id_map: phaseAState.taxonomy_id_map,
    hierarchical_id_map: phaseAState.hierarchical_id_map,
    deferred_parent_repairs: deferredParentRepairs,
    deferred_taxonomy_repairs: deferredTaxonomyRepairs,
    deferred_featured_media_repairs: deferredFeaturedMediaRepairs,
    post_types: postTypes,
    post_type_resolution: postTypeResolution,
    publish_status: publishStatus,
    source_items_scanned: sourceItemsScanned,
    created_count: createdCount,
    updated_count: updatedCount,
    failed_count: allFailures.length,
    destination_ids: destinationIds,
    destination_statuses: destinationStatuses,
    readback_verified: readbackVerified,
    readback_checks: readbackChecks,
    deferred_parent_readback_checks: deferredParentReadbackChecks,
    deferred_taxonomy_readback_checks: deferredTaxonomyReadbackChecks,
    deferred_repair_failures: deferredRepairFailures,
    failures: allFailures
  };

  recordWordpressMutationWritebackEvidence(writebackPlan, mutationEvidence);

  wpContext.capability_state = wpContext.capability_state || {};
  wpContext.capability_state.writeback_required = true;
  wpContext.capability_state.writeback_surfaces = [
    ...new Set([
      ...(wpContext.capability_state.writeback_surfaces || []),
      "wordpress_connector_mutation_evidence"
    ])
  ];

  const executionStatus =
    allFailures.length === 0
      ? "success"
      : (createdCount + updatedCount > 0 ? "partial_success" : "failed");

  return {
    ok: phaseAOutcome.phase_a_outcome !== "failed",
    ...resultBase,
    execution_mode: "applied_mutation",
    execution_status: executionStatus,
    apply: true,
    publish_status: publishStatus,
    post_type_resolution: postTypeResolution,
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_scope_classifications: phaseAScopeClassifications,
    phase_a_execution_order: postTypes,
    phase_a_batch_policy: batchPolicy,
    phase_a_batch_telemetry: phaseABatchTelemetry,
    phase_a_retry_policy: retryPolicy,
    phase_a_retry_telemetry: phaseARetryTelemetry,
    phase_a_resume_policy: resumePolicy,
    phase_a_checkpoint: phaseACheckpoint,
    phase_a_per_type_summary: phaseAPerTypeSummary,
    phase_a_outcome: phaseAOutcome.phase_a_outcome,
    phase_a_outcome_message: phaseAOutcome.phase_a_outcome_message,
    phase_a_operator_artifact: phaseAOperatorArtifact,
    phase_a_promotion_guard: phaseAPromotionGuard,
    selective_publish_candidates: selectivePublishCandidates,
    selective_publish_plan: selectivePublishPlan,
    selective_publish_execution: selectivePublishExecution,
    selective_publish_rollback_plan: selectivePublishRollbackPlan,
    selective_publish_rollback_execution_plan: selectivePublishRollbackExecutionPlan,
    selective_publish_rollback_execution: selectivePublishRollbackExecution,
    phase_a_cutover_journal: phaseACutoverJournal,
    phase_a_final_cutover_recommendation: phaseAFinalCutoverRecommendation,
    phase_a_final_operator_handoff_bundle: phaseAFinalOperatorHandoffBundle,
    phase_b_plan: phaseBPlan,
    phase_b_plan_status: phaseBPlanStatus,
    phase_b_gate: phaseBGate,
    phase_b_inventory_audit: phaseBInventoryAudit,
    phase_b_normalized_audit: phaseBNormalizedAudit,
    phase_b_graph_stability: phaseBGraphStability,
    phase_b_readiness_artifact: phaseBReadinessArtifact,
    phase_b_planning_candidates: phaseBPlanningCandidates,
    phase_b_planning_artifact: phaseBPlanningArtifact,
    phase_b_sequence_planner: phaseBSequencePlanner,
    phase_b_sequence_artifact: phaseBSequenceArtifact,
    phase_b_mapping_prerequisite_gate: phaseBMappingPrerequisiteGate,
    phase_b_mapping_prerequisite_artifact: phaseBMappingPrerequisiteArtifact,
    phase_b_mapping_plan_skeleton: phaseBMappingPlanSkeleton,
    phase_b_mapping_plan_artifact: phaseBMappingPlanArtifact,
    phase_b_field_mapping_resolver: phaseBFieldMappingResolver,
    phase_b_field_mapping_artifact: phaseBFieldMappingArtifact,
    phase_b_dry_run_planner: phaseBDryRunPlanner,
    phase_b_dry_run_artifact: phaseBDryRunArtifact,
    phase_b_execution_plan: phaseBExecutionPlan,
    phase_b_execution_guard: phaseBExecutionGuard,
    phase_b_execution_guard_artifact: phaseBExecutionGuardArtifact,
    phase_b_mutation_candidate_selector: phaseBMutationCandidateSelector,
    phase_b_mutation_candidate_artifact: phaseBMutationCandidateArtifact,
    phase_b_mutation_payload_composer: phaseBMutationPayloadComposer,
    phase_b_mutation_payload_artifact: phaseBMutationPayloadArtifact,
    phase_b_dry_run_execution_simulator: phaseBDryRunExecutionSimulator,
    phase_b_dry_run_execution_artifact: phaseBDryRunExecutionArtifact,
    phase_b_final_operator_handoff_bundle: phaseBFinalOperatorHandoffBundle,
      phase_c_plan: phaseCPlan,
      phase_c_plan_status: phaseCPlanStatus,
      phase_c_gate: phaseCGate,
      phase_c_settings_inventory: phaseCSettingsInventory,
      phase_c_inventory_artifact: phaseCInventoryArtifact,
      phase_c_normalized_diff: phaseCNormalizedDiff,
      phase_c_diff_artifact: phaseCDiffArtifact,
      phase_c_reconciliation_readiness: phaseCReconciliationReadiness,
      phase_c_safe_apply_candidates: phaseCSafeApplyCandidates,
      phase_c_readiness_artifact: phaseCReadinessArtifact,
      phase_c_reconciliation_payload_planner: phaseCReconciliationPayloadPlanner,
      phase_c_reconciliation_payload_artifact: phaseCReconciliationPayloadArtifact,
      phase_c_execution_plan: phaseCExecutionPlan,
      phase_c_execution_guard: phaseCExecutionGuard,
      phase_c_execution_guard_artifact: phaseCExecutionGuardArtifact,
      phase_c_mutation_candidate_selector: phaseCMutationCandidateSelector,
      phase_c_mutation_candidate_artifact: phaseCMutationCandidateArtifact,
      phase_c_mutation_payload_composer: phaseCMutationPayloadComposer,
      phase_c_mutation_payload_artifact: phaseCMutationPayloadArtifact,
      phase_c_dry_run_execution_simulator: phaseCDryRunExecutionSimulator,
      phase_c_dry_run_execution_artifact: phaseCDryRunExecutionArtifact,
      phase_c_final_operator_handoff_bundle: phaseCFinalOperatorHandoffBundle,
      phase_d_plan: phaseDPlan,
      phase_d_plan_status: phaseDPlanStatus,
      phase_d_gate: phaseDGate,
      phase_d_forms_inventory: phaseDFormsInventory,
      phase_d_inventory_artifact: phaseDInventoryArtifact,
      phase_d_normalized_inventory: phaseDNormalizedInventory,
      phase_d_normalized_inventory_artifact: phaseDNormalizedInventoryArtifact,
      phase_d_readiness_gate: phaseDReadinessGate,
      phase_d_safe_candidates: phaseDSafeCandidates,
      phase_d_readiness_artifact: phaseDReadinessArtifact,
      phase_d_migration_payload_planner: phaseDMigrationPayloadPlanner,
      phase_d_migration_payload_artifact: phaseDMigrationPayloadArtifact,
      phase_d_execution_plan: phaseDExecutionPlan,
      phase_d_execution_guard: phaseDExecutionGuard,
      phase_d_execution_guard_artifact: phaseDExecutionGuardArtifact,
      phase_d_mutation_candidate_selector: phaseDMutationCandidateSelector,
      phase_d_mutation_candidate_artifact: phaseDMutationCandidateArtifact,
      phase_d_mutation_payload_composer: phaseDMutationPayloadComposer,
      phase_d_mutation_payload_artifact: phaseDMutationPayloadArtifact,
      phase_d_dry_run_execution_simulator: phaseDDryRunExecutionSimulator,
      phase_d_dry_run_execution_artifact: phaseDDryRunExecutionArtifact,
      phase_d_final_operator_handoff_bundle: phaseDFinalOperatorHandoffBundle,
      phase_e_plan: phaseEPlan,
      phase_e_plan_status: phaseEPlanStatus,
      phase_e_gate: phaseEGate,
      phase_e_media_inventory: phaseEMediaInventory,
      phase_e_inventory_artifact: phaseEInventoryArtifact,
      phase_e_normalized_inventory: phaseENormalizedInventory,
      phase_e_normalized_inventory_artifact: phaseENormalizedInventoryArtifact,
      phase_e_readiness_gate: phaseEReadinessGate,
      phase_e_safe_candidates: phaseESafeCandidates,
      phase_e_readiness_artifact: phaseEReadinessArtifact,
      phase_e_migration_payload_planner: phaseEMigrationPayloadPlanner,
      phase_e_migration_payload_artifact: phaseEMigrationPayloadArtifact,
      phase_e_execution_plan: phaseEExecutionPlan,
      phase_e_execution_guard: phaseEExecutionGuard,
      phase_e_execution_guard_artifact: phaseEExecutionGuardArtifact,
      phase_e_mutation_candidate_selector: phaseEMutationCandidateSelector,
      phase_e_mutation_candidate_artifact: phaseEMutationCandidateArtifact,
      phase_e_mutation_payload_composer: phaseEMutationPayloadComposer,
      phase_e_mutation_payload_artifact: phaseEMutationPayloadArtifact,
      phase_e_dry_run_execution_simulator: phaseEDryRunExecutionSimulator,
      phase_e_dry_run_execution_artifact: phaseEDryRunExecutionArtifact,
      phase_e_final_operator_handoff_bundle: phaseEFinalOperatorHandoffBundle,
      phase_f_plan: phaseFPlan,
      phase_f_plan_status: phaseFPlanStatus,
      phase_f_gate: phaseFGate,
      phase_f_users_roles_auth_inventory: phaseFUsersRolesAuthInventory,
      phase_f_inventory_artifact: phaseFInventoryArtifact,
      phase_f_normalized_inventory: phaseFNormalizedInventory,
      phase_f_normalized_inventory_artifact: phaseFNormalizedInventoryArtifact,
      phase_f_readiness_gate: phaseFReadinessGate,
      phase_f_safe_candidates: phaseFSafeCandidates,
      phase_f_readiness_artifact: phaseFReadinessArtifact,
      phase_f_reconciliation_payload_planner: phaseFReconciliationPayloadPlanner,
      phase_f_reconciliation_payload_artifact: phaseFReconciliationPayloadArtifact,
      phase_f_execution_plan: phaseFExecutionPlan,
      phase_f_execution_guard: phaseFExecutionGuard,
      phase_f_execution_guard_artifact: phaseFExecutionGuardArtifact,
      phase_f_mutation_candidate_selector: phaseFMutationCandidateSelector,
      phase_f_mutation_candidate_artifact: phaseFMutationCandidateArtifact,
      phase_f_mutation_payload_composer: phaseFMutationPayloadComposer,
      phase_f_mutation_payload_artifact: phaseFMutationPayloadArtifact,
      phase_f_dry_run_execution_simulator: phaseFDryRunExecutionSimulator,
      phase_f_dry_run_execution_artifact: phaseFDryRunExecutionArtifact,
      phase_f_final_operator_handoff_bundle: phaseFFinalOperatorHandoffBundle,
      phase_g_plan: phaseGPlan,
      phase_g_plan_status: phaseGPlanStatus,
      phase_g_gate: phaseGGate,
      phase_g_seo_inventory: phaseGSeoInventory,
      phase_g_inventory_artifact: phaseGInventoryArtifact,
      phase_g_normalized_inventory: phaseGNormalizedInventory,
      phase_g_normalized_inventory_artifact: phaseGNormalizedInventoryArtifact,
      phase_g_readiness_gate: phaseGReadinessGate,
      phase_g_safe_candidates: phaseGSafeCandidates,
      phase_g_readiness_artifact: phaseGReadinessArtifact,
      phase_g_reconciliation_payload_planner: phaseGReconciliationPayloadPlanner,
      phase_g_reconciliation_payload_artifact: phaseGReconciliationPayloadArtifact,
      phase_g_execution_plan: phaseGExecutionPlan,
      phase_g_execution_guard: phaseGExecutionGuard,
      phase_g_execution_guard_artifact: phaseGExecutionGuardArtifact,
      phase_g_mutation_candidate_selector: phaseGMutationCandidateSelector,
      phase_g_mutation_candidate_artifact: phaseGMutationCandidateArtifact,
      phase_g_mutation_payload_composer: phaseGMutationPayloadComposer,
      phase_g_mutation_payload_artifact: phaseGMutationPayloadArtifact,
      phase_g_dry_run_execution_simulator: phaseGDryRunExecutionSimulator,
      phase_g_dry_run_execution_artifact: phaseGDryRunExecutionArtifact,
      phase_g_final_operator_handoff_bundle: phaseGFinalOperatorHandoffBundle,
      phase_h_plan: phaseHPlan,
      phase_h_plan_status: phaseHPlanStatus,
      phase_h_gate: phaseHGate,
      phase_h_analytics_inventory: phaseHAnalyticsInventory,
      phase_h_inventory_artifact: phaseHInventoryArtifact,
      phase_h_normalized_inventory: phaseHNormalizedInventory,
      phase_h_normalized_inventory_artifact: phaseHNormalizedInventoryArtifact,
      phase_h_readiness_gate: phaseHReadinessGate,
      phase_h_safe_candidates: phaseHSafeCandidates,
      phase_h_readiness_artifact: phaseHReadinessArtifact,
      phase_h_reconciliation_payload_planner: phaseHReconciliationPayloadPlanner,
      phase_h_reconciliation_payload_artifact: phaseHReconciliationPayloadArtifact,
      phase_h_execution_plan: phaseHExecutionPlan,
      phase_h_execution_guard: phaseHExecutionGuard,
      phase_h_execution_guard_artifact: phaseHExecutionGuardArtifact,
      phase_h_mutation_candidate_selector: phaseHMutationCandidateSelector,
      phase_h_mutation_candidate_artifact: phaseHMutationCandidateArtifact,
      phase_h_mutation_payload_composer: phaseHMutationPayloadComposer,
      phase_h_mutation_payload_artifact: phaseHMutationPayloadArtifact,
    governed_resolution_records: governedResolutionRecords,
    generated_candidate_family: generatedCandidateEvidence,
    taxonomy_id_map: phaseAState.taxonomy_id_map,
    hierarchical_id_map: phaseAState.hierarchical_id_map,
    deferred_parent_repairs: deferredParentRepairs,
    deferred_taxonomy_repairs: deferredTaxonomyRepairs,
    deferred_featured_media_repairs: deferredFeaturedMediaRepairs,
    deferred_parent_readback_checks: deferredParentReadbackChecks,
    deferred_taxonomy_readback_checks: deferredTaxonomyReadbackChecks,
    deferred_repair_failures: deferredRepairFailures,
    selective_publish_results: selectivePublishExecution.results,
    selective_publish_failures: selectivePublishExecution.failures,
    selective_publish_rollback_plan: selectivePublishRollbackPlan,
    selective_publish_rollback_results: selectivePublishRollbackExecution.results,
    selective_publish_rollback_failures: selectivePublishRollbackExecution.failures,
    phase_a_cutover_journal: phaseACutoverJournal,
    phase_a_final_cutover_recommendation: phaseAFinalCutoverRecommendation,
    phase_a_final_operator_handoff_bundle: phaseAFinalOperatorHandoffBundle,
    phase_b_plan: phaseBPlan,
    phase_b_plan_status: phaseBPlanStatus,
    phase_b_gate: phaseBGate,
    phase_b_inventory_status: phaseBInventoryAudit.phase_b_inventory_status,
    phase_b_inventory_counts: phaseBInventoryAudit.inventory_counts,
    phase_b_audit_rows: phaseBInventoryAudit.audit_rows,
    phase_b_normalized_audit_rows: phaseBNormalizedAudit.normalized_audit_rows,
    phase_b_dependency_summary: phaseBNormalizedAudit.dependency_summary,
    phase_b_dependency_totals: phaseBNormalizedAudit.dependency_totals,
    phase_b_family_summary: phaseBNormalizedAudit.family_summary,
    phase_b_migration_buckets: phaseBNormalizedAudit.migration_buckets,
    phase_b_cross_reference_summary: phaseBNormalizedAudit.cross_reference_summary,
    phase_b_dependency_graph_edges: phaseBNormalizedAudit.dependency_graph_edges,
    phase_b_dependency_graph_unresolved: phaseBNormalizedAudit.dependency_graph_unresolved,
    phase_b_dependency_graph_summary: phaseBNormalizedAudit.dependency_graph_summary,
    phase_b_graph_stability: phaseBGraphStability,
    phase_b_readiness_artifact: phaseBReadinessArtifact,
    phase_b_planning_candidates: phaseBPlanningCandidates,
    phase_b_planning_artifact: phaseBPlanningArtifact,
    phase_b_sequence_planner: phaseBSequencePlanner,
    phase_b_sequence_artifact: phaseBSequenceArtifact,
    phase_b_mapping_prerequisite_gate: phaseBMappingPrerequisiteGate,
    phase_b_mapping_prerequisite_artifact: phaseBMappingPrerequisiteArtifact,
    phase_b_mapping_plan_skeleton: phaseBMappingPlanSkeleton,
    phase_b_mapping_plan_artifact: phaseBMappingPlanArtifact,
    phase_b_field_mapping_resolver: phaseBFieldMappingResolver,
    phase_b_field_mapping_artifact: phaseBFieldMappingArtifact,
    phase_b_dry_run_planner: phaseBDryRunPlanner,
    phase_b_dry_run_artifact: phaseBDryRunArtifact,
    phase_b_execution_plan: phaseBExecutionPlan,
    phase_b_execution_guard: phaseBExecutionGuard,
    phase_b_execution_guard_artifact: phaseBExecutionGuardArtifact,
    phase_b_mutation_candidate_selector: phaseBMutationCandidateSelector,
    phase_b_mutation_candidate_artifact: phaseBMutationCandidateArtifact,
    phase_b_mutation_payload_composer: phaseBMutationPayloadComposer,
    phase_b_mutation_payload_artifact: phaseBMutationPayloadArtifact,
    phase_b_dry_run_execution_simulator: phaseBDryRunExecutionSimulator,
    phase_b_dry_run_execution_artifact: phaseBDryRunExecutionArtifact,
    phase_b_final_operator_handoff_bundle: phaseBFinalOperatorHandoffBundle,
    phase_c_plan: phaseCPlan,
    phase_c_plan_status: phaseCPlanStatus,
    phase_c_gate: phaseCGate,
    phase_c_inventory_status: phaseCSettingsInventory.phase_c_inventory_status,
    phase_c_settings_summary: phaseCSettingsInventory.summary,
    phase_c_settings_inventory_rows: phaseCSettingsInventory.inventory_rows,
    phase_c_inventory_artifact: phaseCInventoryArtifact,
    phase_c_normalized_diff_rows: phaseCNormalizedDiff.normalized_diff_rows,
    phase_c_diff_summary: phaseCNormalizedDiff.diff_summary,
    phase_c_reconciliation_buckets: phaseCNormalizedDiff.reconciliation_buckets,
    phase_c_diff_artifact: phaseCDiffArtifact,
    phase_c_reconciliation_readiness: phaseCReconciliationReadiness,
    phase_c_safe_apply_status: phaseCSafeApplyCandidates.safe_apply_status,
    phase_c_safe_apply_candidates: phaseCSafeApplyCandidates.candidates,
    phase_c_readiness_artifact: phaseCReadinessArtifact,
    phase_c_reconciliation_payload_planner: phaseCReconciliationPayloadPlanner,
    phase_c_reconciliation_payload_artifact: phaseCReconciliationPayloadArtifact,
    phase_c_execution_plan: phaseCExecutionPlan,
    phase_c_execution_guard: phaseCExecutionGuard,
    phase_c_execution_guard_artifact: phaseCExecutionGuardArtifact,
    phase_c_mutation_candidate_selector: phaseCMutationCandidateSelector,
    phase_c_mutation_candidate_artifact: phaseCMutationCandidateArtifact,
    phase_c_mutation_payload_composer: phaseCMutationPayloadComposer,
    phase_c_mutation_payload_artifact: phaseCMutationPayloadArtifact,
    phase_c_dry_run_execution_simulator: phaseCDryRunExecutionSimulator,
    phase_c_dry_run_execution_artifact: phaseCDryRunExecutionArtifact,
    phase_c_final_operator_handoff_bundle: phaseCFinalOperatorHandoffBundle,
    phase_d_plan: phaseDPlan,
    phase_d_plan_status: phaseDPlanStatus,
    phase_d_gate: phaseDGate,
    phase_d_inventory_status: phaseDFormsInventory.phase_d_inventory_status,
    phase_d_inventory_counts: phaseDFormsInventory.inventory_counts,
    phase_d_inventory_rows: phaseDFormsInventory.inventory_rows,
    phase_d_inventory_artifact: phaseDInventoryArtifact,
    phase_d_strategy_summary: phaseDNormalizedInventory.strategy_summary,
    phase_d_normalized_inventory_rows: phaseDNormalizedInventory.normalized_inventory_rows,
    phase_d_strategy_buckets: phaseDNormalizedInventory.strategy_buckets,
    phase_d_normalized_inventory_artifact: phaseDNormalizedInventoryArtifact,
    phase_d_readiness_gate: phaseDReadinessGate,
    phase_d_safe_candidate_status: phaseDSafeCandidates.safe_candidate_status,
    phase_d_safe_candidates: phaseDSafeCandidates.candidates,
    phase_d_readiness_artifact: phaseDReadinessArtifact,
    phase_d_migration_payload_planner: phaseDMigrationPayloadPlanner,
    phase_d_migration_payload_artifact: phaseDMigrationPayloadArtifact,
    phase_d_execution_plan: phaseDExecutionPlan,
    phase_d_execution_guard: phaseDExecutionGuard,
    phase_d_execution_guard_artifact: phaseDExecutionGuardArtifact,
    phase_d_mutation_candidate_selector: phaseDMutationCandidateSelector,
    phase_d_mutation_candidate_artifact: phaseDMutationCandidateArtifact,
    phase_d_mutation_payload_composer: phaseDMutationPayloadComposer,
    phase_d_mutation_payload_artifact: phaseDMutationPayloadArtifact,
    phase_d_dry_run_execution_simulator: phaseDDryRunExecutionSimulator,
    phase_d_dry_run_execution_artifact: phaseDDryRunExecutionArtifact,
    phase_e_plan: phaseEPlan,
    phase_e_plan_status: phaseEPlanStatus,
    phase_e_gate: phaseEGate,
    phase_e_inventory_status: phaseEMediaInventory.phase_e_inventory_status,
    phase_e_media_summary: phaseEMediaInventory.summary,
    phase_e_media_inventory_rows: phaseEMediaInventory.inventory_rows,
    phase_e_inventory_artifact: phaseEInventoryArtifact,
    phase_e_strategy_summary: phaseENormalizedInventory.strategy_summary,
    phase_e_normalized_inventory_rows: phaseENormalizedInventory.normalized_inventory_rows,
    phase_e_strategy_buckets: phaseENormalizedInventory.strategy_buckets,
    phase_e_normalized_inventory_artifact: phaseENormalizedInventoryArtifact,
    phase_e_readiness_gate: phaseEReadinessGate,
    phase_e_safe_candidate_status: phaseESafeCandidates.safe_candidate_status,
    phase_e_safe_candidates: phaseESafeCandidates.candidates,
    phase_e_readiness_artifact: phaseEReadinessArtifact,
    phase_e_migration_payload_planner: phaseEMigrationPayloadPlanner,
    phase_e_migration_payload_artifact: phaseEMigrationPayloadArtifact,
    phase_e_execution_plan: phaseEExecutionPlan,
    phase_e_execution_guard: phaseEExecutionGuard,
    phase_e_execution_guard_artifact: phaseEExecutionGuardArtifact,
    phase_e_mutation_candidate_selector: phaseEMutationCandidateSelector,
    phase_e_mutation_candidate_artifact: phaseEMutationCandidateArtifact,
    phase_e_mutation_payload_composer: phaseEMutationPayloadComposer,
    phase_e_mutation_payload_artifact: phaseEMutationPayloadArtifact,
    phase_e_dry_run_execution_simulator: phaseEDryRunExecutionSimulator,
    phase_e_dry_run_execution_artifact: phaseEDryRunExecutionArtifact,
    phase_e_final_operator_handoff_bundle: phaseEFinalOperatorHandoffBundle,
    phase_f_plan: phaseFPlan,
    phase_f_plan_status: phaseFPlanStatus,
    phase_f_gate: phaseFGate,
    phase_f_inventory_status: phaseFUsersRolesAuthInventory.phase_f_inventory_status,
    phase_f_users_roles_auth_summary: phaseFUsersRolesAuthInventory.summary,
    phase_f_user_rows: phaseFUsersRolesAuthInventory.user_rows,
    phase_f_role_rows: phaseFUsersRolesAuthInventory.role_rows,
    phase_f_auth_surface_rows: phaseFUsersRolesAuthInventory.auth_surface_rows,
    phase_f_inventory_artifact: phaseFInventoryArtifact,
      phase_f_risk_summary: phaseFNormalizedInventory.risk_summary,
      phase_f_normalized_user_rows: phaseFNormalizedInventory.normalized_user_rows,
      phase_f_normalized_role_rows: phaseFNormalizedInventory.normalized_role_rows,
      phase_f_normalized_auth_surface_rows: phaseFNormalizedInventory.normalized_auth_surface_rows,
      phase_f_normalized_inventory_artifact: phaseFNormalizedInventoryArtifact,
      phase_f_readiness_gate: phaseFReadinessGate,
      phase_f_safe_candidate_status: phaseFSafeCandidates.safe_candidate_status,
      phase_f_safe_user_candidates: phaseFSafeCandidates.user_candidates,
      phase_f_safe_role_candidates: phaseFSafeCandidates.role_candidates,
      phase_f_safe_auth_surface_candidates: phaseFSafeCandidates.auth_surface_candidates,
      phase_f_readiness_artifact: phaseFReadinessArtifact,
      phase_f_reconciliation_payload_planner: phaseFReconciliationPayloadPlanner,
      phase_f_reconciliation_payload_artifact: phaseFReconciliationPayloadArtifact,
      phase_f_execution_plan: phaseFExecutionPlan,
      phase_f_execution_guard: phaseFExecutionGuard,
      phase_f_execution_guard_artifact: phaseFExecutionGuardArtifact,
      phase_f_mutation_candidate_selector: phaseFMutationCandidateSelector,
      phase_f_mutation_candidate_artifact: phaseFMutationCandidateArtifact,
      phase_f_mutation_payload_composer: phaseFMutationPayloadComposer,
      phase_f_mutation_payload_artifact: phaseFMutationPayloadArtifact,
      phase_f_dry_run_execution_simulator: phaseFDryRunExecutionSimulator,
      phase_f_dry_run_execution_artifact: phaseFDryRunExecutionArtifact,
      phase_f_final_operator_handoff_bundle: phaseFFinalOperatorHandoffBundle,
      phase_g_plan: phaseGPlan,
      phase_g_plan_status: phaseGPlanStatus,
      phase_g_gate: phaseGGate,
      phase_g_inventory_status: phaseGSeoInventory.phase_g_inventory_status,
      phase_g_plugin_signals: phaseGSeoInventory.plugin_signals,
      phase_g_seo_summary: phaseGSeoInventory.summary,
      phase_g_redirect_rows: phaseGSeoInventory.redirect_rows,
      phase_g_metadata_rows: phaseGSeoInventory.metadata_rows,
      phase_g_taxonomy_seo_rows: phaseGSeoInventory.taxonomy_seo_rows,
      phase_g_post_type_seo_rows: phaseGSeoInventory.post_type_seo_rows,
      phase_g_inventory_artifact: phaseGInventoryArtifact,
      phase_g_risk_summary: phaseGNormalizedInventory.risk_summary,
      phase_g_normalized_redirect_rows: phaseGNormalizedInventory.normalized_redirect_rows,
      phase_g_normalized_metadata_rows: phaseGNormalizedInventory.normalized_metadata_rows,
      phase_g_normalized_taxonomy_seo_rows:
        phaseGNormalizedInventory.normalized_taxonomy_seo_rows,
      phase_g_normalized_post_type_seo_rows:
        phaseGNormalizedInventory.normalized_post_type_seo_rows,
      phase_g_normalized_inventory_artifact: phaseGNormalizedInventoryArtifact,
      phase_g_readiness_gate: phaseGReadinessGate,
      phase_g_safe_candidate_status: phaseGSafeCandidates.safe_candidate_status,
      phase_g_safe_redirect_candidates: phaseGSafeCandidates.redirect_candidates,
      phase_g_safe_metadata_candidates: phaseGSafeCandidates.metadata_candidates,
      phase_g_safe_taxonomy_seo_candidates: phaseGSafeCandidates.taxonomy_seo_candidates,
      phase_g_safe_post_type_seo_candidates: phaseGSafeCandidates.post_type_seo_candidates,
      phase_g_readiness_artifact: phaseGReadinessArtifact,
      phase_g_reconciliation_payload_planner: phaseGReconciliationPayloadPlanner,
      phase_g_reconciliation_payload_artifact: phaseGReconciliationPayloadArtifact,
      phase_g_execution_plan: phaseGExecutionPlan,
      phase_g_execution_guard: phaseGExecutionGuard,
      phase_g_execution_guard_artifact: phaseGExecutionGuardArtifact,
      phase_g_mutation_candidate_selector: phaseGMutationCandidateSelector,
      phase_g_mutation_candidate_artifact: phaseGMutationCandidateArtifact,
      phase_g_mutation_payload_composer: phaseGMutationPayloadComposer,
      phase_g_mutation_payload_artifact: phaseGMutationPayloadArtifact,
      phase_g_dry_run_execution_simulator: phaseGDryRunExecutionSimulator,
      phase_g_dry_run_execution_artifact: phaseGDryRunExecutionArtifact,
      phase_g_final_operator_handoff_bundle: phaseGFinalOperatorHandoffBundle,
      phase_h_plan: phaseHPlan,
      phase_h_plan_status: phaseHPlanStatus,
      phase_h_gate: phaseHGate,
      phase_h_inventory_status: phaseHAnalyticsInventory.phase_h_inventory_status,
      phase_h_plugin_signals: phaseHAnalyticsInventory.plugin_signals,
      phase_h_tracking_summary: phaseHAnalyticsInventory.summary,
      phase_h_tracking_rows: phaseHAnalyticsInventory.tracking_rows,
      phase_h_consent_rows: phaseHAnalyticsInventory.consent_rows,
      phase_h_inventory_artifact: phaseHInventoryArtifact,
      phase_h_risk_summary: phaseHNormalizedInventory.risk_summary,
      phase_h_normalized_tracking_rows: phaseHNormalizedInventory.normalized_tracking_rows,
      phase_h_normalized_consent_rows: phaseHNormalizedInventory.normalized_consent_rows,
      phase_h_normalized_inventory_artifact: phaseHNormalizedInventoryArtifact,
      phase_h_readiness_gate: phaseHReadinessGate,
      phase_h_safe_candidate_status: phaseHSafeCandidates.safe_candidate_status,
      phase_h_safe_tracking_candidates: phaseHSafeCandidates.tracking_candidates,
      phase_h_safe_consent_candidates: phaseHSafeCandidates.consent_candidates,
      phase_h_readiness_artifact: phaseHReadinessArtifact,
      phase_h_reconciliation_payload_planner: phaseHReconciliationPayloadPlanner,
      phase_h_reconciliation_payload_artifact: phaseHReconciliationPayloadArtifact,
      phase_h_execution_plan: phaseHExecutionPlan,
      phase_h_execution_guard: phaseHExecutionGuard,
      phase_h_execution_guard_artifact: phaseHExecutionGuardArtifact,
      phase_h_mutation_candidate_selector: phaseHMutationCandidateSelector,
      phase_h_mutation_candidate_artifact: phaseHMutationCandidateArtifact,
      phase_h_mutation_payload_composer: phaseHMutationPayloadComposer,
      phase_h_mutation_payload_artifact: phaseHMutationPayloadArtifact,
    phase_b_failures: phaseBInventoryAudit.failures,
    message: phaseAOutcome.phase_a_outcome_message,
    source_items_scanned: sourceItemsScanned,
    created_count: createdCount,
    updated_count: updatedCount,
    destination_ids: destinationIds,
    destination_statuses: destinationStatuses,
    readback_verified: readbackVerified,
    readback_checks: readbackChecks,
    failures: [
      ...allFailures,
      ...(selectivePublishExecution.failures || []),
      ...(selectivePublishRollbackExecution.failures || []),
      ...(phaseBInventoryAudit.failures || [])
    ]
  };
}

async function runSshWpCliMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  return {
    ok: true,
    transport: "ssh_wpcli",
    message: "SSH/WP-CLI migration plan prepared.",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "ssh_wpcli"),
    runtime_delta: {},
    settings_delta: {},
    plugin_delta: {}
  };
}

function buildWordpressPhaseDFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const normalizedInventoryArtifact =
    args.normalizedInventoryArtifact &&
    typeof args.normalizedInventoryArtifact === "object"
      ? args.normalizedInventoryArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const migrationPayloadArtifact =
    args.migrationPayloadArtifact &&
    typeof args.migrationPayloadArtifact === "object"
      ? args.migrationPayloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_d_final_operator_handoff",
    artifact_version: "v1",
    phase_d_enabled: phaseDPlan.enabled === true,
    phase_d_inventory_only: phaseDPlan.inventory_only === true,
    phase_d_apply_requested: phaseDPlan.apply === true,
    requested_form_post_types: Array.isArray(phaseDPlan.post_types)
      ? phaseDPlan.post_types
      : (
          Array.isArray(migration?.forms_integrations?.post_types)
            ? migration.forms_integrations.post_types
            : []
        ),
    phase_d_gate_status: String(phaseDGate.phase_d_gate_status || "").trim(),
    phase_d_inventory_status: String(inventoryArtifact.phase_d_inventory_status || "").trim(),
    phase_d_strategy_status: String(
      normalizedInventoryArtifact.phase_d_gate_status || ""
    ).trim(),
    phase_d_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_d_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_d_payload_planner_status: String(
      migrationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_d_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_d_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_d_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_d_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_counts: Array.isArray(inventoryArtifact.inventory_counts)
      ? inventoryArtifact.inventory_counts
      : [],
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            simple_migrate_candidate_count: 0,
            reviewed_migrate_or_rebuild_count: 0,
            rebuild_required_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseDGate.blocking_reasons) ? phaseDGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(migrationPayloadArtifact.blocking_reasons)
        ? migrationPayloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_forms_candidates"
        : "resolve_forms_migration_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_forms_migration_execution"
        ? "approve_forms_mutation_trial"
        : "hold_forms_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_forms_dry_run_preview"
        : "no_forms_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    migration_payload_artifact: migrationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

function resolveWordpressPhaseEPlan(payload = {}) {
  const migration = payload?.migration || {};
  const media = migration.media_assets && typeof migration.media_assets === "object"
    ? migration.media_assets
    : {};

  return {
    enabled: media.enabled === true,
    inventory_only:
      media.inventory_only === undefined ? true : media.inventory_only === true,
    apply: media.apply === true,
    include_featured_media:
      media.include_featured_media === undefined
        ? true
        : media.include_featured_media === true,
    include_inline_media:
      media.include_inline_media === undefined
        ? true
        : media.include_inline_media === true,
    include_unattached:
      media.include_unattached === true,
    max_items: Math.max(1, toPositiveInt(media.max_items, 1000))
  };
}

function assertWordpressPhaseEPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_e_apply_conflicts_with_inventory_only");
  }

  return {
    phase_e_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_e_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseEGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDFinalOperatorHandoffBundle =
    args.phaseDFinalOperatorHandoffBundle &&
    typeof args.phaseDFinalOperatorHandoffBundle === "object"
      ? args.phaseDFinalOperatorHandoffBundle
      : {};
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEPlanStatus =
    args.phaseEPlanStatus && typeof args.phaseEPlanStatus === "object"
      ? args.phaseEPlanStatus
      : {};

  const blockingReasons = [...(phaseEPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_e");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  return {
    phase_e_gate_status:
      blockingReasons.length === 0 ? "ready_for_media_inventory" : "blocked",
    phase_e_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseEPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

function extractWordpressInlineMediaRefs(item = {}) {
  const content = String(
    item?.content?.rendered ||
    item?.content ||
    ""
  );

  const refs = {
    attachment_ids: [],
    urls: []
  };

  const attachmentIdMatches = new Set();
  const urlMatches = new Set();

  const patterns = [
    /wp-image-(\d+)/gi,
    /attachment[_-]?id["':=\s]+(\d+)/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const v = Number(match[1]);
      if (Number.isFinite(v)) attachmentIdMatches.add(v);
    }
  }

  const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|pdf)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(content)) !== null) {
    const v = String(urlMatch[0] || "").trim();
    if (v) urlMatches.add(v);
  }

  refs.attachment_ids = [...attachmentIdMatches];
  refs.urls = [...urlMatches];
  return refs;
}

function classifyWordpressMediaInventoryRow(item = {}, attachmentContext = {}) {
  const inlineRefs = extractWordpressInlineMediaRefs(item);
  const featuredMediaId = Number(item?.featured_media);
  const parentId = Number(item?.post || item?.parent);
  const mimeType = String(item?.mime_type || item?.mime || "").trim().toLowerCase();

  return {
    source_id: Number.isFinite(Number(item?.id)) ? Number(item.id) : null,
    slug: String(item?.slug || "").trim(),
    title: String(
      item?.title?.rendered ||
      item?.title ||
      item?.name ||
      item?.slug ||
      ""
    ).trim(),
    status: String(item?.status || "").trim(),
    media_type: String(item?.media_type || "").trim(),
    mime_type: mimeType,
    source_url: String(item?.source_url || item?.guid?.rendered || "").trim(),
    alt_text: String(item?.alt_text || "").trim(),
    parent_post_id: Number.isFinite(parentId) ? parentId : null,
    featured_media_self_reference:
      Number.isFinite(featuredMediaId) &&
      Number.isFinite(Number(item?.id)) &&
      Number(item.id) === featuredMediaId,
    inline_attachment_refs: inlineRefs.attachment_ids,
    inline_url_refs: inlineRefs.urls,
    dependency_count:
      (Number.isFinite(parentId) ? 1 : 0) +
      inlineRefs.attachment_ids.length +
      inlineRefs.urls.length,
    attachment_classification:
      Number.isFinite(parentId) ? "attached_media" : "unattached_media",
    migration_candidate:
      attachmentContext.include_unattached === true
        ? true
        : Number.isFinite(parentId)
  };
}

async function runWordpressMediaInventory(args = {}) {
  const {
    wpContext = {},
    phaseEPlan = {},
    phaseEGate = {}
  } = args;

  if (phaseEGate.phase_e_gate_ready !== true) {
    return {
      phase_e_inventory_status: "blocked",
      inventory_rows: [],
      summary: {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      },
      failures: [
        {
          code: "phase_e_media_inventory_blocked",
          message: "Phase E media inventory blocked by phase_e_gate.",
          blocking_reasons: phaseEGate.blocking_reasons || []
        }
      ]
    };
  }

  try {
    const itemsRaw = await listWordpressEntriesByType({
      siteRef: wpContext.source,
      postType: "attachment",
      authRequired: false
    });

    const limitedItems = itemsRaw.slice(0, phaseEPlan.max_items);
    const inventoryRows = limitedItems
      .map(item => classifyWordpressMediaInventoryRow(item, phaseEPlan))
      .filter(row => phaseEPlan.include_unattached === true || row.migration_candidate === true);

    const summary = inventoryRows.reduce(
      (acc, row) => {
        acc.total_count += 1;
        if (String(row?.attachment_classification || "").trim() === "attached_media") {
          acc.attached_count += 1;
        } else {
          acc.unattached_count += 1;
        }
        acc.inline_ref_count += Array.isArray(row?.inline_attachment_refs)
          ? row.inline_attachment_refs.length
          : 0;
        return acc;
      },
      {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      }
    );

    return {
      phase_e_inventory_status: "completed",
      inventory_rows: inventoryRows,
      summary,
      failures: []
    };
  } catch (err) {
    return {
      phase_e_inventory_status: "completed_with_failures",
      inventory_rows: [],
      summary: {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      },
      failures: [
        {
          code: err?.code || "wordpress_media_inventory_failed",
          message: err?.message || "WordPress media inventory failed."
        }
      ]
    };
  }
}

function buildWordpressPhaseEInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_e_media_inventory",
    artifact_version: "v1",
    phase_e_gate_status: String(gate.phase_e_gate_status || "").trim(),
    phase_e_inventory_status: String(inventory.phase_e_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            total_count: 0,
            attached_count: 0,
            unattached_count: 0,
            inline_ref_count: 0
          },
    inventory_rows: Array.isArray(inventory.inventory_rows)
      ? inventory.inventory_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressMediaMimeClass(mimeType = "") {
  const value = String(mimeType || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (value === "application/pdf") return "document";
  if (value.startsWith("application/")) return "application";
  return "other";
}

function classifyWordpressMediaMigrationStrategy(row = {}, phaseEPlan = {}) {
  const mimeClass = normalizeWordpressMediaMimeClass(row?.mime_type || "");
  const attached = String(row?.attachment_classification || "").trim() === "attached_media";
  const inlineAttachmentRefs = Array.isArray(row?.inline_attachment_refs)
    ? row.inline_attachment_refs
    : [];
  const inlineUrlRefs = Array.isArray(row?.inline_url_refs) ? row.inline_url_refs : [];

  let strategyScore = 0;
  const reasons = [];

  if (attached) {
    strategyScore += 1;
    reasons.push("attached_media");
  } else {
    strategyScore += 3;
    reasons.push("unattached_media");
  }

  if (inlineAttachmentRefs.length > 0) {
    strategyScore += 2;
    reasons.push("inline_attachment_refs_present");
  }

  if (inlineUrlRefs.length > 0) {
    strategyScore += 2;
    reasons.push("inline_url_refs_present");
  }

  if (row?.featured_media_self_reference === true) {
    strategyScore += 1;
    reasons.push("featured_media_self_reference");
  }

  if (mimeClass === "video" || mimeClass === "audio") {
    strategyScore += 3;
    reasons.push("heavy_media_type");
  } else if (mimeClass === "document" || mimeClass === "application") {
    strategyScore += 2;
    reasons.push("document_like_media_type");
  } else if (mimeClass === "image") {
    strategyScore += 1;
    reasons.push("image_media_type");
  }

  let migration_strategy = "safe_attached_migrate_candidate";
  let migration_strategy_reason = "attached_media_with_low_dependency_complexity";

  if (!attached && phaseEPlan.include_unattached !== true) {
    migration_strategy = "excluded_unattached_media";
    migration_strategy_reason = "unattached_media_not_included";
  } else if (strategyScore >= 7) {
    migration_strategy = "rebuild_or_manual_rebind_required";
    migration_strategy_reason = "high_media_dependency_complexity";
  } else if (strategyScore >= 4) {
    migration_strategy = "reviewed_media_migrate";
    migration_strategy_reason = "medium_media_dependency_complexity";
  }

  return {
    mime_class: mimeClass,
    media_strategy_score: strategyScore,
    media_strategy_reasons: reasons,
    migration_strategy,
    migration_strategy_reason
  };
}

function buildWordpressPhaseENormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(row => {
    const strategy = classifyWordpressMediaMigrationStrategy(row, phaseEPlan);
    return {
      ...row,
      mime_class: strategy.mime_class,
      media_strategy_score: strategy.media_strategy_score,
      media_strategy_reasons: strategy.media_strategy_reasons,
      migration_strategy: strategy.migration_strategy,
      migration_strategy_reason: strategy.migration_strategy_reason
    };
  });

  const strategySummary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const strategy = String(row?.migration_strategy || "").trim();
      if (strategy === "safe_attached_migrate_candidate") {
        acc.safe_attached_migrate_candidate_count += 1;
      } else if (strategy === "reviewed_media_migrate") {
        acc.reviewed_media_migrate_count += 1;
      } else if (strategy === "rebuild_or_manual_rebind_required") {
        acc.rebuild_or_manual_rebind_required_count += 1;
      } else if (strategy === "excluded_unattached_media") {
        acc.excluded_unattached_media_count += 1;
      }

      const mimeClass = String(row?.mime_class || "").trim();
      if (mimeClass === "image") acc.image_count += 1;
      else if (mimeClass === "video") acc.video_count += 1;
      else if (mimeClass === "audio") acc.audio_count += 1;
      else if (mimeClass === "document") acc.document_count += 1;
      else acc.other_count += 1;

      return acc;
    },
    {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    }
  );

  const strategyBuckets = {
    safe_attached_migrate_candidate: normalizedRows.filter(
      row =>
        String(row?.migration_strategy || "").trim() ===
        "safe_attached_migrate_candidate"
    ),
    reviewed_media_migrate: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "reviewed_media_migrate"
    ),
    rebuild_or_manual_rebind_required: normalizedRows.filter(
      row =>
        String(row?.migration_strategy || "").trim() ===
        "rebuild_or_manual_rebind_required"
    ),
    excluded_unattached_media: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "excluded_unattached_media"
    )
  };

  return {
    normalized_inventory_rows: normalizedRows,
    strategy_summary: strategySummary,
    strategy_buckets: strategyBuckets
  };
}

function buildWordpressPhaseENormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_e_media_strategy",
    artifact_version: "v1",
    phase_e_gate_status: String(gate.phase_e_gate_status || "").trim(),
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            safe_attached_migrate_candidate_count: 0,
            reviewed_media_migrate_count: 0,
            rebuild_or_manual_rebind_required_count: 0,
            excluded_unattached_media_count: 0,
            image_count: 0,
            video_count: 0,
            audio_count: 0,
            document_count: 0,
            other_count: 0
          },
    normalized_inventory_rows: Array.isArray(normalizedInventory.normalized_inventory_rows)
      ? normalizedInventory.normalized_inventory_rows
      : [],
    strategy_buckets:
      normalizedInventory?.strategy_buckets &&
      typeof normalizedInventory.strategy_buckets === "object"
        ? normalizedInventory.strategy_buckets
        : {
            safe_attached_migrate_candidate: [],
            reviewed_media_migrate: [],
            rebuild_or_manual_rebind_required: [],
            excluded_unattached_media: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseEReadinessGate(args = {}) {
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const strategySummary =
    normalizedInventory?.strategy_summary &&
    typeof normalizedInventory.strategy_summary === "object"
      ? normalizedInventory.strategy_summary
      : {};
  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  const blockingReasons = [...(phaseEGate.blocking_reasons || [])];

  if (phaseEPlan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }

  const rebuildRequiredCount = Number(
    strategySummary.rebuild_or_manual_rebind_required_count || 0
  );
  const reviewedCount = Number(
    strategySummary.reviewed_media_migrate_count || 0
  );
  const safeCount = Number(
    strategySummary.safe_attached_migrate_candidate_count || 0
  );

  if (rebuildRequiredCount > 0) {
    blockingReasons.push("media_manual_rebind_required_present");
  }

  if (phaseEPlan.include_unattached !== true) {
    const excludedUnattachedCount = Number(
      strategySummary.excluded_unattached_media_count || 0
    );
    if (excludedUnattachedCount > 0) {
      blockingReasons.push("unattached_media_excluded_from_scope");
    }
  }

  const readiness = blockingReasons.length === 0;

  const safeCandidates = Array.isArray(strategyBuckets.safe_attached_migrate_candidate)
    ? strategyBuckets.safe_attached_migrate_candidate
    : [];

  return {
    readiness_status: readiness
      ? "ready_for_safe_media_migration"
      : "blocked_for_media_migration",
    readiness_ready: readiness,
    safe_attached_migrate_candidate_count: safeCount,
    reviewed_media_migrate_count: reviewedCount,
    rebuild_or_manual_rebind_required_count: rebuildRequiredCount,
    safe_candidate_count: safeCandidates.length,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseESafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 100));

  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_e_readiness_not_ready"]
    };
  }

  const candidates = (
    Array.isArray(strategyBuckets.safe_attached_migrate_candidate)
      ? strategyBuckets.safe_attached_migrate_candidate
      : []
  )
    .slice(0, limit)
    .map(row => ({
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      mime_type: String(row?.mime_type || "").trim(),
      mime_class: String(row?.mime_class || "").trim(),
      source_url: String(row?.source_url || "").trim(),
      parent_post_id: Number.isFinite(Number(row?.parent_post_id))
        ? Number(row.parent_post_id)
        : null,
      attachment_classification: String(row?.attachment_classification || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      candidate_reason: "safe_attached_migrate_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseEReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_e_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    safe_attached_migrate_candidate_count: Number(
      readiness.safe_attached_migrate_candidate_count || 0
    ),
    reviewed_media_migrate_count: Number(
      readiness.reviewed_media_migrate_count || 0
    ),
    rebuild_or_manual_rebind_required_count: Number(
      readiness.rebuild_or_manual_rebind_required_count || 0
    ),
    safe_candidate_count: Number(readiness.safe_candidate_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidates: Array.isArray(safeCandidates.candidates)
      ? safeCandidates.candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressMediaSafeMigrationPayloadRow(row = {}) {
  return {
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_mode: "safe_media_migration_candidate",
    payload_shape: {
      title: "preserve_from_source",
      slug: "preserve_from_source",
      status: "inherit",
      source_url: "download_and_reupload_from_source",
      alt_text: "preserve_if_present",
      mime_type: String(row?.mime_type || "").trim(),
      parent_binding: Number.isFinite(Number(row?.parent_post_id))
        ? "rebind_to_destination_parent_if_resolved"
        : "leave_unbound",
      inline_reference_strategy:
        Array.isArray(row?.inline_attachment_refs) && row.inline_attachment_refs.length > 0
          ? "rebind_inline_attachment_refs_if_resolved"
          : "no_inline_attachment_rebind_required"
    }
  };
}

function buildWordpressPhaseEMigrationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_e_safe_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeCandidates.candidates)
    ? safeCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressMediaSafeMigrationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseEMigrationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_e_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    payload_rows: Array.isArray(planner.payload_rows)
      ? planner.payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseEExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const media = migration.media_assets && typeof migration.media_assets === "object"
    ? migration.media_assets
    : {};
  const execution = media.execution && typeof media.execution === "object"
    ? media.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 100))
  };
}

function buildWordpressPhaseEExecutionGuard(args = {}) {
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseEPlan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }
  if (phaseEGate.phase_e_gate_ready !== true) {
    blockingReasons.push("phase_e_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_e_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_e_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_e_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_e_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseEPlan.inventory_only === true && phaseEPlan.apply === true) {
    blockingReasons.push("phase_e_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_media_migration_execution"
      : "blocked_before_media_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseEExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_e_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseEMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_e_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_e_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      mime_type: String(row?.mime_type || "").trim(),
      mime_class: String(row?.mime_class || "").trim(),
      source_url: String(row?.source_url || "").trim(),
      parent_post_id: Number.isFinite(Number(row?.parent_post_id))
        ? Number(row.parent_post_id)
        : null,
      attachment_classification: String(row?.attachment_classification || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      payload_mode: String(row?.payload_mode || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (
      String(baseRecord.migration_strategy || "").trim() !==
      "safe_attached_migrate_candidate"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_safe_attached_migrate_strategy"
      });
      continue;
    }

    if (
      String(baseRecord.attachment_classification || "").trim() !==
      "attached_media"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_attached_media"
      });
      continue;
    }

    if (
      String(baseRecord.payload_mode || "").trim() !==
      "safe_media_migration_candidate"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_payload_mode"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_attached_media_candidate_ready_for_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 100))
  );

  return {
    selector_status: "ready",
    selected_count: limitedSelected.length,
    rejected_count: rejected.length,
    selected_candidates: limitedSelected,
    rejected_candidates: rejected,
    blocking_reasons: []
  };
}

function buildWordpressPhaseEMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_e_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_candidates: Array.isArray(selector.selected_candidates)
      ? selector.selected_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressMediaMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_media_migration",
    target_scope: "destination_media_attachment",
    payload: {
      title: Object.prototype.hasOwnProperty.call(payloadShape, "title")
        ? payloadShape.title
        : "preserve_from_source",
      slug: Object.prototype.hasOwnProperty.call(payloadShape, "slug")
        ? payloadShape.slug
        : "preserve_from_source",
      status: Object.prototype.hasOwnProperty.call(payloadShape, "status")
        ? payloadShape.status
        : "inherit",
      source_url: Object.prototype.hasOwnProperty.call(payloadShape, "source_url")
        ? payloadShape.source_url
        : "download_and_reupload_from_source",
      alt_text: Object.prototype.hasOwnProperty.call(payloadShape, "alt_text")
        ? payloadShape.alt_text
        : "preserve_if_present",
      mime_type: String(payloadShape.mime_type || "").trim(),
      parent_binding: String(payloadShape.parent_binding || "").trim(),
      inline_reference_strategy: String(
        payloadShape.inline_reference_strategy || ""
      ).trim()
    }
  };
}

function buildWordpressPhaseEMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_e_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_reason: "composed_from_safe_attached_media_candidate",
    mutation_payload: buildWordpressMediaMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseEMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_e_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    composed_payloads: Array.isArray(composer.composed_payloads)
      ? composer.composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressMediaDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  return {
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    dry_run_result: "simulated_ready",
    attachment_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_status: String(payload.status || "").trim(),
      expected_title_mode: String(payload.title || "").trim(),
      expected_slug_mode: String(payload.slug || "").trim(),
      expected_source_transfer_mode: String(payload.source_url || "").trim(),
      expected_alt_text_mode: String(payload.alt_text || "").trim(),
      expected_parent_binding: String(payload.parent_binding || "").trim(),
      expected_inline_reference_strategy: String(
        payload.inline_reference_strategy || ""
      ).trim(),
      mime_type: String(payload.mime_type || "").trim()
    },
    preview_payload: mutationPayload
  };
}

function buildWordpressPhaseEDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      attachment_evidence_preview_summary: {
        total_rows: 0,
        expected_inherit_count: 0,
        safe_media_migration_count: 0,
        source_transfer_count: 0,
        parent_rebind_count: 0,
        inline_rebind_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_e_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressMediaDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.attachment_evidence_preview &&
        typeof row.attachment_evidence_preview === "object"
          ? row.attachment_evidence_preview
          : {};

      acc.total_rows += 1;

      if (String(preview.expected_status || "").trim() === "inherit") {
        acc.expected_inherit_count += 1;
      }
      if (String(preview.mutation_mode || "").trim() === "safe_media_migration") {
        acc.safe_media_migration_count += 1;
      }
      if (
        String(preview.expected_source_transfer_mode || "").trim() ===
        "download_and_reupload_from_source"
      ) {
        acc.source_transfer_count += 1;
      }
      if (
        String(preview.expected_parent_binding || "").trim() ===
        "rebind_to_destination_parent_if_resolved"
      ) {
        acc.parent_rebind_count += 1;
      }
      if (
        String(preview.expected_inline_reference_strategy || "").trim() ===
        "rebind_inline_attachment_refs_if_resolved"
      ) {
        acc.inline_rebind_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    attachment_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseEDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_e_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    attachment_evidence_preview_summary:
      simulator?.attachment_evidence_preview_summary &&
      typeof simulator.attachment_evidence_preview_summary === "object"
        ? simulator.attachment_evidence_preview_summary
        : {
            total_rows: 0,
            expected_inherit_count: 0,
            safe_media_migration_count: 0,
            source_transfer_count: 0,
            parent_rebind_count: 0,
            inline_rebind_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseEFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const normalizedInventoryArtifact =
    args.normalizedInventoryArtifact &&
    typeof args.normalizedInventoryArtifact === "object"
      ? args.normalizedInventoryArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const migrationPayloadArtifact =
    args.migrationPayloadArtifact &&
    typeof args.migrationPayloadArtifact === "object"
      ? args.migrationPayloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_e_final_operator_handoff",
    artifact_version: "v1",
    phase_e_enabled: phaseEPlan.enabled === true,
    phase_e_inventory_only: phaseEPlan.inventory_only === true,
    phase_e_apply_requested: phaseEPlan.apply === true,
    requested_media_scope: {
      include_featured_media: phaseEPlan.include_featured_media === true,
      include_inline_media: phaseEPlan.include_inline_media === true,
      include_unattached: phaseEPlan.include_unattached === true,
      max_items: Number(phaseEPlan.max_items || 0)
    },
    requested_media_config:
      migration?.media_assets && typeof migration.media_assets === "object"
        ? migration.media_assets
        : {},
    phase_e_gate_status: String(phaseEGate.phase_e_gate_status || "").trim(),
    phase_e_inventory_status: String(inventoryArtifact.phase_e_inventory_status || "").trim(),
    phase_e_strategy_status: String(
      normalizedInventoryArtifact.phase_e_gate_status || ""
    ).trim(),
    phase_e_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_e_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_e_payload_planner_status: String(
      migrationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_e_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_e_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_e_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_e_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            total_count: 0,
            attached_count: 0,
            unattached_count: 0,
            inline_ref_count: 0
          },
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            safe_attached_migrate_candidate_count: 0,
            reviewed_media_migrate_count: 0,
            rebuild_or_manual_rebind_required_count: 0,
            excluded_unattached_media_count: 0,
            image_count: 0,
            video_count: 0,
            audio_count: 0,
            document_count: 0,
            other_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseEGate.blocking_reasons) ? phaseEGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(migrationPayloadArtifact.blocking_reasons)
        ? migrationPayloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_media_candidates"
        : "resolve_media_migration_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_media_migration_execution"
        ? "approve_media_mutation_trial"
        : "hold_media_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_media_dry_run_preview"
        : "no_media_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    migration_payload_artifact: migrationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

function resolveWordpressPhaseFPlan(payload = {}) {
  const migration = payload?.migration || {};
  const usersRolesAuth =
    migration.users_roles_auth && typeof migration.users_roles_auth === "object"
      ? migration.users_roles_auth
      : {};

  return {
    enabled: usersRolesAuth.enabled === true,
    inventory_only:
      usersRolesAuth.inventory_only === undefined
        ? true
        : usersRolesAuth.inventory_only === true,
    apply: usersRolesAuth.apply === true,
    include_users:
      usersRolesAuth.include_users === undefined ? true : usersRolesAuth.include_users === true,
    include_roles:
      usersRolesAuth.include_roles === undefined ? true : usersRolesAuth.include_roles === true,
    include_auth_surface:
      usersRolesAuth.include_auth_surface === undefined
        ? true
        : usersRolesAuth.include_auth_surface === true,
    max_users: Math.max(1, toPositiveInt(usersRolesAuth.max_users, 500))
  };
}

function assertWordpressPhaseFPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_f_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_users !== true &&
    plan.include_roles !== true &&
    plan.include_auth_surface !== true
  ) {
    blockingReasons.push("phase_f_no_inventory_scope_selected");
  }

  return {
    phase_f_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_f_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseFGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDFinalOperatorHandoffBundle =
    args.phaseDFinalOperatorHandoffBundle &&
    typeof args.phaseDFinalOperatorHandoffBundle === "object"
      ? args.phaseDFinalOperatorHandoffBundle
      : {};
  const phaseEFinalOperatorHandoffBundle =
    args.phaseEFinalOperatorHandoffBundle &&
    typeof args.phaseEFinalOperatorHandoffBundle === "object"
      ? args.phaseEFinalOperatorHandoffBundle
      : {};
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFPlanStatus =
    args.phaseFPlanStatus && typeof args.phaseFPlanStatus === "object"
      ? args.phaseFPlanStatus
      : {};

  const blockingReasons = [...(phaseFPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_f");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  return {
    phase_f_gate_status:
      blockingReasons.length === 0 ? "ready_for_users_roles_auth_inventory" : "blocked",
    phase_f_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseFPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

function normalizeWordpressUserInventoryRow(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];

  return {
    entity_type: "user",
    source_id: Number.isFinite(Number(user?.id)) ? Number(user.id) : null,
    slug: String(user?.slug || user?.username || "").trim(),
    username: String(user?.username || "").trim(),
    display_name: String(user?.name || user?.display_name || "").trim(),
    email: String(user?.email || "").trim(),
    roles: roles.map(x => String(x || "").trim()).filter(Boolean),
    role_count: roles.length,
    has_admin_role: roles.some(x => String(x || "").trim() === "administrator"),
    inventory_classification:
      roles.some(x => String(x || "").trim() === "administrator")
        ? "privileged_user"
        : roles.length > 0
        ? "role_bound_user"
        : "unclassified_user"
  };
}

function buildWordpressRoleInventoryRows(siteProfile = {}) {
  const roleMap =
    siteProfile?.roles && typeof siteProfile.roles === "object" && !Array.isArray(siteProfile.roles)
      ? siteProfile.roles
      : {};

  return Object.entries(roleMap).map(([roleKey, roleValue]) => ({
    entity_type: "role",
    role_key: String(roleKey || "").trim(),
    role_label:
      roleValue && typeof roleValue === "object"
        ? String(roleValue.label || roleValue.name || roleKey || "").trim()
        : String(roleValue || roleKey || "").trim(),
    capabilities:
      roleValue && typeof roleValue === "object" && roleValue.capabilities
        ? roleValue.capabilities
        : {},
    capability_count:
      roleValue &&
      typeof roleValue === "object" &&
      roleValue.capabilities &&
      typeof roleValue.capabilities === "object"
        ? Object.keys(roleValue.capabilities).length
        : 0,
    inventory_classification:
      String(roleKey || "").trim() === "administrator"
        ? "privileged_role"
        : "standard_role"
  }));
}

function buildWordpressAuthSurfaceRows(siteProfile = {}) {
  const authSurface =
    siteProfile?.auth_surface &&
    typeof siteProfile.auth_surface === "object" &&
    !Array.isArray(siteProfile.auth_surface)
      ? siteProfile.auth_surface
      : {};

  const rows = [];
  const knownKeys = [
    "login_url",
    "xmlrpc_enabled",
    "rest_api_enabled",
    "application_passwords_enabled",
    "two_factor_enabled",
    "sso_enabled",
    "password_policy",
    "registration_enabled"
  ];

  for (const key of knownKeys) {
    if (!Object.prototype.hasOwnProperty.call(authSurface, key)) continue;

    const value = authSurface[key];
    rows.push({
      entity_type: "auth_surface",
      auth_key: String(key || "").trim(),
      auth_value: value,
      auth_value_type: Array.isArray(value) ? "array" : typeof value,
      inventory_classification:
        key === "login_url" || key === "password_policy"
          ? "auth_configuration"
          : key === "xmlrpc_enabled" || key === "rest_api_enabled"
          ? "auth_endpoint_surface"
          : "auth_control_surface"
    });
  }

  return rows;
}

async function runWordpressUsersRolesAuthInventory(args = {}) {
  const {
    wpContext = {},
    phaseFPlan = {},
    phaseFGate = {}
  } = args;

  if (phaseFGate.phase_f_gate_ready !== true) {
    return {
      phase_f_inventory_status: "blocked",
      user_rows: [],
      role_rows: [],
      auth_surface_rows: [],
      summary: {
        user_count: 0,
        privileged_user_count: 0,
        role_count: 0,
        privileged_role_count: 0,
        auth_surface_count: 0
      },
      failures: [
        {
          code: "phase_f_users_roles_auth_inventory_blocked",
          message: "Phase F users/roles/auth inventory blocked by phase_f_gate.",
          blocking_reasons: phaseFGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];
  let userRows = [];
  let roleRows = [];
  let authSurfaceRows = [];

  try {
    if (phaseFPlan.include_users === true) {
      const usersRaw = Array.isArray(sourceProfile?.users) ? sourceProfile.users : [];
      userRows = usersRaw
        .slice(0, phaseFPlan.max_users)
        .map(normalizeWordpressUserInventoryRow);
    }

    if (phaseFPlan.include_roles === true) {
      roleRows = buildWordpressRoleInventoryRows(sourceProfile);
    }

    if (phaseFPlan.include_auth_surface === true) {
      authSurfaceRows = buildWordpressAuthSurfaceRows(sourceProfile);
    }
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_users_roles_auth_inventory_failed",
      message: err?.message || "WordPress users/roles/auth inventory failed."
    });
  }

  const summary = {
    user_count: userRows.length,
    privileged_user_count: userRows.filter(x => x?.has_admin_role === true).length,
    role_count: roleRows.length,
    privileged_role_count: roleRows.filter(
      x => String(x?.inventory_classification || "").trim() === "privileged_role"
    ).length,
    auth_surface_count: authSurfaceRows.length
  };

  return {
    phase_f_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    user_rows: userRows,
    role_rows: roleRows,
    auth_surface_rows: authSurfaceRows,
    summary,
    failures
  };
}

function buildWordpressPhaseFInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_f_users_roles_auth_inventory",
    artifact_version: "v1",
    phase_f_gate_status: String(gate.phase_f_gate_status || "").trim(),
    phase_f_inventory_status: String(inventory.phase_f_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            user_count: 0,
            privileged_user_count: 0,
            role_count: 0,
            privileged_role_count: 0,
            auth_surface_count: 0
          },
    user_rows: Array.isArray(inventory.user_rows) ? inventory.user_rows : [],
    role_rows: Array.isArray(inventory.role_rows) ? inventory.role_rows : [],
    auth_surface_rows: Array.isArray(inventory.auth_surface_rows)
      ? inventory.auth_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressAuthValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(x => String(x ?? "").trim()));
  }

  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = value[key];
    }
    return JSON.stringify(sorted);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value ?? "").trim();
}

function classifyWordpressUserPrivilegeRisk(row = {}) {
  const roles = Array.isArray(row?.roles) ? row.roles : [];
  const normalizedRoles = roles.map(x => String(x || "").trim()).filter(Boolean);

  let riskScore = 0;
  const reasons = [];

  if (normalizedRoles.includes("administrator")) {
    riskScore += 5;
    reasons.push("administrator_role_present");
  }
  if (normalizedRoles.includes("editor")) {
    riskScore += 2;
    reasons.push("editor_role_present");
  }
  if (normalizedRoles.includes("shop_manager")) {
    riskScore += 3;
    reasons.push("shop_manager_role_present");
  }
  if (normalizedRoles.length === 0) {
    riskScore += 1;
    reasons.push("no_roles_assigned");
  }
  if (String(row?.email || "").trim()) {
    reasons.push("email_present");
  }

  let privilege_risk_class = "low";
  if (riskScore >= 5) privilege_risk_class = "high";
  else if (riskScore >= 2) privilege_risk_class = "medium";

  return {
    normalized_roles: normalizedRoles,
    privilege_risk_score: riskScore,
    privilege_risk_class,
    privilege_risk_reasons: reasons
  };
}

function classifyWordpressRolePrivilegeRisk(row = {}) {
  const roleKey = String(row?.role_key || "").trim();
  const capabilities =
    row?.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
      ? row.capabilities
      : {};

  const enabledCapabilities = Object.entries(capabilities)
    .filter(([, value]) => value === true || String(value || "").trim().toLowerCase() === "true")
    .map(([key]) => String(key || "").trim())
    .filter(Boolean);

  let riskScore = 0;
  const reasons = [];

  if (roleKey === "administrator") {
    riskScore += 5;
    reasons.push("administrator_role_key");
  }
  if (enabledCapabilities.includes("manage_options")) {
    riskScore += 3;
    reasons.push("manage_options_capability");
  }
  if (enabledCapabilities.includes("edit_users")) {
    riskScore += 3;
    reasons.push("edit_users_capability");
  }
  if (enabledCapabilities.includes("promote_users")) {
    riskScore += 2;
    reasons.push("promote_users_capability");
  }
  if (enabledCapabilities.includes("delete_users")) {
    riskScore += 2;
    reasons.push("delete_users_capability");
  }
  if (enabledCapabilities.includes("install_plugins")) {
    riskScore += 2;
    reasons.push("install_plugins_capability");
  }

  let privilege_risk_class = "low";
  if (riskScore >= 5) privilege_risk_class = "high";
  else if (riskScore >= 2) privilege_risk_class = "medium";

  return {
    enabled_capabilities: enabledCapabilities,
    privilege_risk_score: riskScore,
    privilege_risk_class,
    privilege_risk_reasons: reasons
  };
}

function classifyWordpressAuthSurfaceRisk(row = {}) {
  const authKey = String(row?.auth_key || "").trim();
  const normalizedValue = normalizeWordpressAuthValue(row?.auth_value);

  let riskScore = 0;
  const reasons = [];

  if (authKey === "xmlrpc_enabled" && normalizedValue === "true") {
    riskScore += 4;
    reasons.push("xmlrpc_enabled");
  }
  if (authKey === "application_passwords_enabled" && normalizedValue === "true") {
    riskScore += 3;
    reasons.push("application_passwords_enabled");
  }
  if (authKey === "registration_enabled" && normalizedValue === "true") {
    riskScore += 3;
    reasons.push("registration_enabled");
  }
  if (authKey === "rest_api_enabled" && normalizedValue === "true") {
    riskScore += 1;
    reasons.push("rest_api_enabled");
  }
  if (authKey === "two_factor_enabled" && normalizedValue === "false") {
    riskScore += 2;
    reasons.push("two_factor_disabled");
  }
  if (authKey === "login_url" && normalizedValue) {
    reasons.push("login_url_present");
  }

  let auth_risk_class = "low";
  if (riskScore >= 4) auth_risk_class = "high";
  else if (riskScore >= 2) auth_risk_class = "medium";

  return {
    auth_value_normalized: normalizedValue,
    auth_risk_score: riskScore,
    auth_risk_class,
    auth_risk_reasons: reasons
  };
}

function buildWordpressPhaseFNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const userRows = Array.isArray(inventory.user_rows) ? inventory.user_rows : [];
  const roleRows = Array.isArray(inventory.role_rows) ? inventory.role_rows : [];
  const authSurfaceRows = Array.isArray(inventory.auth_surface_rows)
    ? inventory.auth_surface_rows
    : [];

  const normalizedUserRows = userRows.map(row => {
    const risk = classifyWordpressUserPrivilegeRisk(row);
    return {
      ...row,
      roles: risk.normalized_roles,
      privilege_risk_score: risk.privilege_risk_score,
      privilege_risk_class: risk.privilege_risk_class,
      privilege_risk_reasons: risk.privilege_risk_reasons
    };
  });

  const normalizedRoleRows = roleRows.map(row => {
    const risk = classifyWordpressRolePrivilegeRisk(row);
    return {
      ...row,
      enabled_capabilities: risk.enabled_capabilities,
      privilege_risk_score: risk.privilege_risk_score,
      privilege_risk_class: risk.privilege_risk_class,
      privilege_risk_reasons: risk.privilege_risk_reasons
    };
  });

  const normalizedAuthSurfaceRows = authSurfaceRows.map(row => {
    const risk = classifyWordpressAuthSurfaceRisk(row);
    return {
      ...row,
      auth_value_normalized: risk.auth_value_normalized,
      auth_risk_score: risk.auth_risk_score,
      auth_risk_class: risk.auth_risk_class,
      auth_risk_reasons: risk.auth_risk_reasons
    };
  });

  const summary = {
    user_total_count: normalizedUserRows.length,
    user_high_risk_count: normalizedUserRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "high"
    ).length,
    user_medium_risk_count: normalizedUserRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "medium"
    ).length,
    role_total_count: normalizedRoleRows.length,
    role_high_risk_count: normalizedRoleRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "high"
    ).length,
    role_medium_risk_count: normalizedRoleRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "medium"
    ).length,
    auth_surface_total_count: normalizedAuthSurfaceRows.length,
    auth_surface_high_risk_count: normalizedAuthSurfaceRows.filter(
      x => String(x?.auth_risk_class || "").trim() === "high"
    ).length,
    auth_surface_medium_risk_count: normalizedAuthSurfaceRows.filter(
      x => String(x?.auth_risk_class || "").trim() === "medium"
    ).length
  };

  return {
    normalized_user_rows: normalizedUserRows,
    normalized_role_rows: normalizedRoleRows,
    normalized_auth_surface_rows: normalizedAuthSurfaceRows,
    risk_summary: summary
  };
}

function buildWordpressPhaseFNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_f_privilege_auth_strategy",
    artifact_version: "v1",
    phase_f_gate_status: String(gate.phase_f_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            user_total_count: 0,
            user_high_risk_count: 0,
            user_medium_risk_count: 0,
            role_total_count: 0,
            role_high_risk_count: 0,
            role_medium_risk_count: 0,
            auth_surface_total_count: 0,
            auth_surface_high_risk_count: 0,
            auth_surface_medium_risk_count: 0
          },
    normalized_user_rows: Array.isArray(normalizedInventory.normalized_user_rows)
      ? normalizedInventory.normalized_user_rows
      : [],
    normalized_role_rows: Array.isArray(normalizedInventory.normalized_role_rows)
      ? normalizedInventory.normalized_role_rows
      : [],
    normalized_auth_surface_rows: Array.isArray(
      normalizedInventory.normalized_auth_surface_rows
    )
      ? normalizedInventory.normalized_auth_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseFReadinessGate(args = {}) {
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseFGate.blocking_reasons || [])];

  if (phaseFPlan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }

  const userHighRiskCount = Number(riskSummary.user_high_risk_count || 0);
  const roleHighRiskCount = Number(riskSummary.role_high_risk_count || 0);
  const authHighRiskCount = Number(riskSummary.auth_surface_high_risk_count || 0);

  if (userHighRiskCount > 0) {
    blockingReasons.push("high_risk_users_present");
  }
  if (roleHighRiskCount > 0) {
    blockingReasons.push("high_risk_roles_present");
  }
  if (authHighRiskCount > 0) {
    blockingReasons.push("high_risk_auth_surface_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_users_roles_auth_reconciliation"
      : "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: readiness,
    user_high_risk_count: userHighRiskCount,
    role_high_risk_count: roleHighRiskCount,
    auth_high_risk_count: authHighRiskCount,
    user_medium_risk_count: Number(riskSummary.user_medium_risk_count || 0),
    role_medium_risk_count: Number(riskSummary.role_medium_risk_count || 0),
    auth_medium_risk_count: Number(riskSummary.auth_surface_medium_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseFSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 100));

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      user_candidates: [],
      role_candidates: [],
      auth_surface_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_f_readiness_not_ready"]
    };
  }

  const normalizedUserRows = Array.isArray(normalizedInventory.normalized_user_rows)
    ? normalizedInventory.normalized_user_rows
    : [];
  const normalizedRoleRows = Array.isArray(normalizedInventory.normalized_role_rows)
    ? normalizedInventory.normalized_role_rows
    : [];
  const normalizedAuthRows = Array.isArray(normalizedInventory.normalized_auth_surface_rows)
    ? normalizedInventory.normalized_auth_surface_rows
    : [];

  const userCandidates = normalizedUserRows
    .filter(row => String(row?.privilege_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "user",
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      username: String(row?.username || "").trim(),
      display_name: String(row?.display_name || "").trim(),
      roles: Array.isArray(row?.roles) ? row.roles : [],
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      candidate_reason: "non_high_risk_user_candidate"
    }));

  const roleCandidates = normalizedRoleRows
    .filter(row => String(row?.privilege_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "role",
      role_key: String(row?.role_key || "").trim(),
      role_label: String(row?.role_label || "").trim(),
      enabled_capabilities: Array.isArray(row?.enabled_capabilities)
        ? row.enabled_capabilities
        : [],
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      candidate_reason: "non_high_risk_role_candidate"
    }));

  const authSurfaceCandidates = normalizedAuthRows
    .filter(row => String(row?.auth_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "auth_surface",
      auth_key: String(row?.auth_key || "").trim(),
      auth_value_normalized: String(row?.auth_value_normalized || "").trim(),
      auth_risk_class: String(row?.auth_risk_class || "").trim(),
      candidate_reason: "non_high_risk_auth_surface_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      userCandidates.length + roleCandidates.length + authSurfaceCandidates.length,
    user_candidates: userCandidates,
    role_candidates: roleCandidates,
    auth_surface_candidates: authSurfaceCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseFReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_f_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    user_high_risk_count: Number(readiness.user_high_risk_count || 0),
    role_high_risk_count: Number(readiness.role_high_risk_count || 0),
    auth_high_risk_count: Number(readiness.auth_high_risk_count || 0),
    user_medium_risk_count: Number(readiness.user_medium_risk_count || 0),
    role_medium_risk_count: Number(readiness.role_medium_risk_count || 0),
    auth_medium_risk_count: Number(readiness.auth_medium_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    user_candidates: Array.isArray(safeCandidates.user_candidates)
      ? safeCandidates.user_candidates
      : [],
    role_candidates: Array.isArray(safeCandidates.role_candidates)
      ? safeCandidates.role_candidates
      : [],
    auth_surface_candidates: Array.isArray(safeCandidates.auth_surface_candidates)
      ? safeCandidates.auth_surface_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressUserReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "user",
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    username: String(row?.username || "").trim(),
    display_name: String(row?.display_name || "").trim(),
    roles: Array.isArray(row?.roles) ? row.roles : [],
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_mode: "safe_user_reconciliation_candidate",
    payload_shape: {
      username: "preserve_from_source",
      display_name: "preserve_from_source",
      roles: Array.isArray(row?.roles) ? row.roles : [],
      email: "review_before_apply"
    }
  };
}

function buildWordpressRoleReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "role",
    role_key: String(row?.role_key || "").trim(),
    role_label: String(row?.role_label || "").trim(),
    enabled_capabilities: Array.isArray(row?.enabled_capabilities)
      ? row.enabled_capabilities
      : [],
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_mode: "safe_role_reconciliation_candidate",
    payload_shape: {
      role_key: String(row?.role_key || "").trim(),
      role_label: "preserve_from_source",
      enabled_capabilities: Array.isArray(row?.enabled_capabilities)
        ? row.enabled_capabilities
        : [],
      capability_merge_mode: "review_before_apply"
    }
  };
}

function buildWordpressAuthSurfaceReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_value_normalized: String(row?.auth_value_normalized || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    payload_mode: "safe_auth_surface_reconciliation_candidate",
    payload_shape: {
      auth_key: String(row?.auth_key || "").trim(),
      auth_value: String(row?.auth_value_normalized || "").trim(),
      apply_mode: "review_before_apply"
    }
  };
}

function buildWordpressPhaseFReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      user_payload_rows: [],
      role_payload_rows: [],
      auth_surface_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_f_safe_candidates_not_ready"]
    };
  }

  const userCandidates = Array.isArray(safeCandidates.user_candidates)
    ? safeCandidates.user_candidates
    : [];
  const roleCandidates = Array.isArray(safeCandidates.role_candidates)
    ? safeCandidates.role_candidates
    : [];
  const authSurfaceCandidates = Array.isArray(safeCandidates.auth_surface_candidates)
    ? safeCandidates.auth_surface_candidates
    : [];

  const userPayloadRows = userCandidates.map(buildWordpressUserReconciliationPayloadRow);
  const rolePayloadRows = roleCandidates.map(buildWordpressRoleReconciliationPayloadRow);
  const authSurfacePayloadRows = authSurfaceCandidates.map(
    buildWordpressAuthSurfaceReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      userPayloadRows.length + rolePayloadRows.length + authSurfacePayloadRows.length,
    user_payload_rows: userPayloadRows,
    role_payload_rows: rolePayloadRows,
    auth_surface_payload_rows: authSurfacePayloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseFReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_f_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    user_payload_rows: Array.isArray(planner.user_payload_rows)
      ? planner.user_payload_rows
      : [],
    role_payload_rows: Array.isArray(planner.role_payload_rows)
      ? planner.role_payload_rows
      : [],
    auth_surface_payload_rows: Array.isArray(planner.auth_surface_payload_rows)
      ? planner.auth_surface_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseFExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const usersRolesAuth =
    migration.users_roles_auth && typeof migration.users_roles_auth === "object"
      ? migration.users_roles_auth
      : {};
  const execution =
    usersRolesAuth.execution && typeof usersRolesAuth.execution === "object"
      ? usersRolesAuth.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 100))
  };
}

function buildWordpressPhaseFExecutionGuard(args = {}) {
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseFPlan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }
  if (phaseFGate.phase_f_gate_ready !== true) {
    blockingReasons.push("phase_f_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_f_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_f_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_f_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_f_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseFPlan.inventory_only === true && phaseFPlan.apply === true) {
    blockingReasons.push("phase_f_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_users_roles_auth_reconciliation_execution"
      : "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseFExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_f_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseFMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_user_candidates: [],
      selected_role_candidates: [],
      selected_auth_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_f_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_user_candidates: [],
      selected_role_candidates: [],
      selected_auth_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_f_payload_planner_not_ready"]
    };
  }

  const userPayloadRows = Array.isArray(payloadPlanner.user_payload_rows)
    ? payloadPlanner.user_payload_rows
    : [];
  const rolePayloadRows = Array.isArray(payloadPlanner.role_payload_rows)
    ? payloadPlanner.role_payload_rows
    : [];
  const authSurfacePayloadRows = Array.isArray(payloadPlanner.auth_surface_payload_rows)
    ? payloadPlanner.auth_surface_payload_rows
    : [];

  const selectedUserCandidates = [];
  const selectedRoleCandidates = [];
  const selectedAuthSurfaceCandidates = [];
  const rejectedCandidates = [];

  for (const row of userPayloadRows) {
    const privilegeRiskClass = String(row?.privilege_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (privilegeRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "user",
        source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
        username: String(row?.username || "").trim(),
        rejection_reason: "high_risk_user_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_user_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "user",
        source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
        username: String(row?.username || "").trim(),
        rejection_reason: "unsupported_user_payload_mode"
      });
      continue;
    }

    selectedUserCandidates.push({
      ...row,
      candidate_reason: "safe_user_candidate_ready_for_mutation"
    });
  }

  for (const row of rolePayloadRows) {
    const privilegeRiskClass = String(row?.privilege_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (privilegeRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "role",
        role_key: String(row?.role_key || "").trim(),
        rejection_reason: "high_risk_role_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_role_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "role",
        role_key: String(row?.role_key || "").trim(),
        rejection_reason: "unsupported_role_payload_mode"
      });
      continue;
    }

    selectedRoleCandidates.push({
      ...row,
      candidate_reason: "safe_role_candidate_ready_for_mutation"
    });
  }

  for (const row of authSurfacePayloadRows) {
    const authRiskClass = String(row?.auth_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (authRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "auth_surface",
        auth_key: String(row?.auth_key || "").trim(),
        rejection_reason: "high_risk_auth_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_auth_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "auth_surface",
        auth_key: String(row?.auth_key || "").trim(),
        rejection_reason: "unsupported_auth_surface_payload_mode"
      });
      continue;
    }

    selectedAuthSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_auth_surface_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 100));
  const limitedSelectedUserCandidates = selectedUserCandidates.slice(0, candidateLimit);
  const limitedSelectedRoleCandidates = selectedRoleCandidates.slice(0, candidateLimit);
  const limitedSelectedAuthSurfaceCandidates =
    selectedAuthSurfaceCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedUserCandidates.length +
      limitedSelectedRoleCandidates.length +
      limitedSelectedAuthSurfaceCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_user_candidates: limitedSelectedUserCandidates,
    selected_role_candidates: limitedSelectedRoleCandidates,
    selected_auth_surface_candidates: limitedSelectedAuthSurfaceCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseFMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_f_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_user_candidates: Array.isArray(selector.selected_user_candidates)
      ? selector.selected_user_candidates
      : [],
    selected_role_candidates: Array.isArray(selector.selected_role_candidates)
      ? selector.selected_role_candidates
      : [],
    selected_auth_surface_candidates: Array.isArray(
      selector.selected_auth_surface_candidates
    )
      ? selector.selected_auth_surface_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressUserMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_user_reconciliation",
    target_scope: "destination_wordpress_user",
    payload: {
      username: Object.prototype.hasOwnProperty.call(payloadShape, "username")
        ? payloadShape.username
        : "preserve_from_source",
      display_name: Object.prototype.hasOwnProperty.call(payloadShape, "display_name")
        ? payloadShape.display_name
        : "preserve_from_source",
      roles: Array.isArray(payloadShape.roles) ? payloadShape.roles : [],
      email: Object.prototype.hasOwnProperty.call(payloadShape, "email")
        ? payloadShape.email
        : "review_before_apply"
    }
  };
}

function buildWordpressRoleMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_role_reconciliation",
    target_scope: "destination_wordpress_role",
    payload: {
      role_key: Object.prototype.hasOwnProperty.call(payloadShape, "role_key")
        ? payloadShape.role_key
        : String(row?.role_key || "").trim(),
      role_label: Object.prototype.hasOwnProperty.call(payloadShape, "role_label")
        ? payloadShape.role_label
        : "preserve_from_source",
      enabled_capabilities: Array.isArray(payloadShape.enabled_capabilities)
        ? payloadShape.enabled_capabilities
        : [],
      capability_merge_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "capability_merge_mode"
      )
        ? payloadShape.capability_merge_mode
        : "review_before_apply"
    }
  };
}

function buildWordpressAuthSurfaceMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_auth_surface_reconciliation",
    target_scope: "destination_wordpress_auth_surface",
    payload: {
      auth_key: Object.prototype.hasOwnProperty.call(payloadShape, "auth_key")
        ? payloadShape.auth_key
        : String(row?.auth_key || "").trim(),
      auth_value: Object.prototype.hasOwnProperty.call(payloadShape, "auth_value")
        ? payloadShape.auth_value
        : String(row?.auth_value_normalized || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "review_before_apply"
    }
  };
}

function buildWordpressPhaseFMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      user_composed_payloads: [],
      role_composed_payloads: [],
      auth_surface_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_f_mutation_candidates_not_ready"]
    };
  }

  const selectedUserCandidates = Array.isArray(selector.selected_user_candidates)
    ? selector.selected_user_candidates
    : [];
  const selectedRoleCandidates = Array.isArray(selector.selected_role_candidates)
    ? selector.selected_role_candidates
    : [];
  const selectedAuthSurfaceCandidates = Array.isArray(
    selector.selected_auth_surface_candidates
  )
    ? selector.selected_auth_surface_candidates
    : [];

  const userComposedPayloads = selectedUserCandidates.map(row => ({
    entity_type: "user",
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    username: String(row?.username || "").trim(),
    display_name: String(row?.display_name || "").trim(),
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_reason: "composed_from_safe_user_candidate",
    mutation_payload: buildWordpressUserMutationPayloadFromCandidate(row)
  }));

  const roleComposedPayloads = selectedRoleCandidates.map(row => ({
    entity_type: "role",
    role_key: String(row?.role_key || "").trim(),
    role_label: String(row?.role_label || "").trim(),
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_reason: "composed_from_safe_role_candidate",
    mutation_payload: buildWordpressRoleMutationPayloadFromCandidate(row)
  }));

  const authSurfaceComposedPayloads = selectedAuthSurfaceCandidates.map(row => ({
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    payload_reason: "composed_from_safe_auth_surface_candidate",
    mutation_payload: buildWordpressAuthSurfaceMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      userComposedPayloads.length +
      roleComposedPayloads.length +
      authSurfaceComposedPayloads.length,
    user_composed_payloads: userComposedPayloads,
    role_composed_payloads: roleComposedPayloads,
    auth_surface_composed_payloads: authSurfaceComposedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseFMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_f_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    user_composed_payloads: Array.isArray(composer.user_composed_payloads)
      ? composer.user_composed_payloads
      : [],
    role_composed_payloads: Array.isArray(composer.role_composed_payloads)
      ? composer.role_composed_payloads
      : [],
    auth_surface_composed_payloads: Array.isArray(
      composer.auth_surface_composed_payloads
    )
      ? composer.auth_surface_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressUsersRolesAuthDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "user") {
    return {
      entity_type: "user",
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      username: String(row?.username || "").trim(),
      display_name: String(row?.display_name || "").trim(),
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_username_mode: String(payload.username || "").trim(),
        expected_display_name_mode: String(payload.display_name || "").trim(),
        expected_roles_count: Array.isArray(payload.roles) ? payload.roles.length : 0,
        expected_email_mode: String(payload.email || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "role") {
    return {
      entity_type: "role",
      role_key: String(row?.role_key || "").trim(),
      role_label: String(row?.role_label || "").trim(),
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_role_key: String(payload.role_key || "").trim(),
        expected_role_label_mode: String(payload.role_label || "").trim(),
        expected_capabilities_count: Array.isArray(payload.enabled_capabilities)
          ? payload.enabled_capabilities.length
          : 0,
        expected_capability_merge_mode: String(payload.capability_merge_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_auth_key: String(payload.auth_key || "").trim(),
      expected_auth_value: String(payload.auth_value || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

function buildWordpressPhaseFDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_user_rows: [],
      simulated_role_rows: [],
      simulated_auth_surface_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        user_rows: 0,
        role_rows: 0,
        auth_surface_rows: 0,
        review_before_apply_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_f_mutation_payloads_not_ready"]
    };
  }

  const userRows = Array.isArray(composer.user_composed_payloads)
    ? composer.user_composed_payloads
    : [];
  const roleRows = Array.isArray(composer.role_composed_payloads)
    ? composer.role_composed_payloads
    : [];
  const authSurfaceRows = Array.isArray(composer.auth_surface_composed_payloads)
    ? composer.auth_surface_composed_payloads
    : [];

  const simulatedUserRows = userRows.map(simulateWordpressUsersRolesAuthDryRunRow);
  const simulatedRoleRows = roleRows.map(simulateWordpressUsersRolesAuthDryRunRow);
  const simulatedAuthSurfaceRows = authSurfaceRows.map(
    simulateWordpressUsersRolesAuthDryRunRow
  );

  const allRows = [
    ...simulatedUserRows,
    ...simulatedRoleRows,
    ...simulatedAuthSurfaceRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "user") acc.user_rows += 1;
      else if (entityType === "role") acc.role_rows += 1;
      else if (entityType === "auth_surface") acc.auth_surface_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (
        String(preview.expected_email_mode || "").trim() === "review_before_apply" ||
        String(preview.expected_capability_merge_mode || "").trim() ===
          "review_before_apply" ||
        String(preview.expected_apply_mode || "").trim() === "review_before_apply"
      ) {
        acc.review_before_apply_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_user_rows: simulatedUserRows,
    simulated_role_rows: simulatedRoleRows,
    simulated_auth_surface_rows: simulatedAuthSurfaceRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseFDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_f_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_user_rows: Array.isArray(simulator.simulated_user_rows)
      ? simulator.simulated_user_rows
      : [],
    simulated_role_rows: Array.isArray(simulator.simulated_role_rows)
      ? simulator.simulated_role_rows
      : [],
    simulated_auth_surface_rows: Array.isArray(simulator.simulated_auth_surface_rows)
      ? simulator.simulated_auth_surface_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            user_rows: 0,
            role_rows: 0,
            auth_surface_rows: 0,
            review_before_apply_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseFFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const normalizedInventoryArtifact =
    args.normalizedInventoryArtifact &&
    typeof args.normalizedInventoryArtifact === "object"
      ? args.normalizedInventoryArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const reconciliationPayloadArtifact =
    args.reconciliationPayloadArtifact &&
    typeof args.reconciliationPayloadArtifact === "object"
      ? args.reconciliationPayloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_f_final_operator_handoff",
    artifact_version: "v1",
    phase_f_enabled: phaseFPlan.enabled === true,
    phase_f_inventory_only: phaseFPlan.inventory_only === true,
    phase_f_apply_requested: phaseFPlan.apply === true,
    requested_auth_scope: {
      include_users: phaseFPlan.include_users === true,
      include_roles: phaseFPlan.include_roles === true,
      include_auth_surface: phaseFPlan.include_auth_surface === true,
      max_users: Number(phaseFPlan.max_users || 0)
    },
    requested_auth_config:
      migration?.users_roles_auth && typeof migration.users_roles_auth === "object"
        ? migration.users_roles_auth
        : {},
    phase_f_gate_status: String(phaseFGate.phase_f_gate_status || "").trim(),
    phase_f_inventory_status: String(inventoryArtifact.phase_f_inventory_status || "").trim(),
    phase_f_strategy_status: String(
      normalizedInventoryArtifact.phase_f_gate_status || ""
    ).trim(),
    phase_f_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_f_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_f_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_f_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_f_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_f_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_f_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            user_count: 0,
            privileged_user_count: 0,
            role_count: 0,
            privileged_role_count: 0,
            auth_surface_count: 0
          },
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            user_total_count: 0,
            user_high_risk_count: 0,
            user_medium_risk_count: 0,
            role_total_count: 0,
            role_high_risk_count: 0,
            role_medium_risk_count: 0,
            auth_surface_total_count: 0,
            auth_surface_high_risk_count: 0,
            auth_surface_medium_risk_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseFGate.blocking_reasons) ? phaseFGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(reconciliationPayloadArtifact.blocking_reasons)
        ? reconciliationPayloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_users_roles_auth_candidates"
        : "resolve_users_roles_auth_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_users_roles_auth_reconciliation_execution"
        ? "approve_users_roles_auth_mutation_trial"
        : "hold_users_roles_auth_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_users_roles_auth_dry_run_preview"
        : "no_users_roles_auth_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    reconciliation_payload_artifact: reconciliationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

function resolveWordpressPhaseGPlan(payload = {}) {
  const migration = payload?.migration || {};
  const seo = migration.seo_surfaces && typeof migration.seo_surfaces === "object"
    ? migration.seo_surfaces
    : {};

  return {
    enabled: seo.enabled === true,
    inventory_only:
      seo.inventory_only === undefined ? true : seo.inventory_only === true,
    apply: seo.apply === true,
    include_redirects:
      seo.include_redirects === undefined ? true : seo.include_redirects === true,
    include_metadata:
      seo.include_metadata === undefined ? true : seo.include_metadata === true,
    include_taxonomy_seo:
      seo.include_taxonomy_seo === undefined ? true : seo.include_taxonomy_seo === true,
    include_post_type_seo:
      seo.include_post_type_seo === undefined ? true : seo.include_post_type_seo === true,
    max_items: Math.max(1, toPositiveInt(seo.max_items, 1000))
  };
}

function assertWordpressPhaseGPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_g_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_redirects !== true &&
    plan.include_metadata !== true &&
    plan.include_taxonomy_seo !== true &&
    plan.include_post_type_seo !== true
  ) {
    blockingReasons.push("phase_g_no_inventory_scope_selected");
  }

  return {
    phase_g_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_g_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseGGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDFinalOperatorHandoffBundle =
    args.phaseDFinalOperatorHandoffBundle &&
    typeof args.phaseDFinalOperatorHandoffBundle === "object"
      ? args.phaseDFinalOperatorHandoffBundle
      : {};
  const phaseEFinalOperatorHandoffBundle =
    args.phaseEFinalOperatorHandoffBundle &&
    typeof args.phaseEFinalOperatorHandoffBundle === "object"
      ? args.phaseEFinalOperatorHandoffBundle
      : {};
  const phaseFFinalOperatorHandoffBundle =
    args.phaseFFinalOperatorHandoffBundle &&
    typeof args.phaseFFinalOperatorHandoffBundle === "object"
      ? args.phaseFFinalOperatorHandoffBundle
      : {};
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGPlanStatus =
    args.phaseGPlanStatus && typeof args.phaseGPlanStatus === "object"
      ? args.phaseGPlanStatus
      : {};

  const blockingReasons = [...(phaseGPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_g");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  return {
    phase_g_gate_status:
      blockingReasons.length === 0 ? "ready_for_seo_inventory" : "blocked",
    phase_g_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseGPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

function inferWordpressSeoPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_yoast:
      normalized.some(x => x.includes("wordpress-seo") || x.includes("yoast")),
    has_rank_math:
      normalized.some(x => x.includes("seo-by-rank-math") || x.includes("rank-math")),
    has_aioseo:
      normalized.some(x => x.includes("all-in-one-seo") || x.includes("aioseo")),
    has_redirection:
      normalized.some(x => x.includes("redirection")),
    has_seopress:
      normalized.some(x => x.includes("wp-seopress") || x.includes("seopress"))
  };
}

function buildWordpressSeoMetadataRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const seoMetadata =
    siteProfile?.seo_metadata &&
    typeof siteProfile.seo_metadata === "object" &&
    !Array.isArray(siteProfile.seo_metadata)
      ? siteProfile.seo_metadata
      : {};

  for (const [entityKey, entityValue] of Object.entries(seoMetadata).slice(0, limit)) {
    const value =
      entityValue && typeof entityValue === "object" && !Array.isArray(entityValue)
        ? entityValue
        : {};

    rows.push({
      entity_type: "seo_metadata",
      entity_key: String(entityKey || "").trim(),
      title_template: String(value.title_template || value.title || "").trim(),
      meta_description_template: String(
        value.meta_description_template || value.meta_description || ""
      ).trim(),
      robots: String(value.robots || "").trim(),
      canonical_mode: String(value.canonical_mode || "").trim(),
      inventory_classification: "metadata_surface"
    });
  }

  return rows;
}

function buildWordpressRedirectRows(siteProfile = {}, limit = 1000) {
  const redirectsRaw = Array.isArray(siteProfile?.redirects) ? siteProfile.redirects : [];

  return redirectsRaw.slice(0, limit).map(row => ({
    entity_type: "redirect",
    source_path: String(row?.source_path || row?.source || "").trim(),
    target_path: String(row?.target_path || row?.target || "").trim(),
    redirect_type: String(row?.redirect_type || row?.type || "301").trim(),
    status: String(row?.status || "").trim(),
    inventory_classification: "redirect_surface"
  }));
}

function buildWordpressTaxonomySeoRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const taxonomySeo =
    siteProfile?.taxonomy_seo &&
    typeof siteProfile.taxonomy_seo === "object" &&
    !Array.isArray(siteProfile.taxonomy_seo)
      ? siteProfile.taxonomy_seo
      : {};

  for (const [taxonomyKey, taxonomyValue] of Object.entries(taxonomySeo).slice(0, limit)) {
    const value =
      taxonomyValue && typeof taxonomyValue === "object" && !Array.isArray(taxonomyValue)
        ? taxonomyValue
        : {};

    rows.push({
      entity_type: "taxonomy_seo",
      taxonomy_key: String(taxonomyKey || "").trim(),
      title_template: String(value.title_template || "").trim(),
      meta_description_template: String(value.meta_description_template || "").trim(),
      robots: String(value.robots || "").trim(),
      inventory_classification: "taxonomy_seo_surface"
    });
  }

  return rows;
}

function buildWordpressPostTypeSeoRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const postTypeSeo =
    siteProfile?.post_type_seo &&
    typeof postTypeSeo === "object" &&
    !Array.isArray(postTypeSeo)
      ? postTypeSeo
      : {};

  for (const [postTypeKey, postTypeValue] of Object.entries(postTypeSeo).slice(0, limit)) {
    const value =
      postTypeValue && typeof postTypeValue === "object" && !Array.isArray(postTypeValue)
        ? postTypeValue
        : {};

    rows.push({
      entity_type: "post_type_seo",
      post_type_key: String(postTypeKey || "").trim(),
      title_template: String(value.title_template || "").trim(),
      meta_description_template: String(value.meta_description_template || "").trim(),
      robots: String(value.robots || "").trim(),
      inventory_classification: "post_type_seo_surface"
    });
  }

  return rows;
}

async function runWordpressSeoInventory(args = {}) {
  const {
    wpContext = {},
    phaseGPlan = {},
    phaseGGate = {}
  } = args;

  if (phaseGGate.phase_g_gate_ready !== true) {
    return {
      phase_g_inventory_status: "blocked",
      plugin_signals: {},
      redirect_rows: [],
      metadata_rows: [],
      taxonomy_seo_rows: [],
      post_type_seo_rows: [],
      summary: {
        redirect_count: 0,
        metadata_count: 0,
        taxonomy_seo_count: 0,
        post_type_seo_count: 0
      },
      failures: [
        {
          code: "phase_g_seo_inventory_blocked",
          message: "Phase G SEO inventory blocked by phase_g_gate.",
          blocking_reasons: phaseGGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressSeoPluginSignals(sourceProfile);
    const redirectRows =
      phaseGPlan.include_redirects === true
        ? buildWordpressRedirectRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const metadataRows =
      phaseGPlan.include_metadata === true
        ? buildWordpressSeoMetadataRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const taxonomySeoRows =
      phaseGPlan.include_taxonomy_seo === true
        ? buildWordpressTaxonomySeoRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const postTypeSeoRows =
      phaseGPlan.include_post_type_seo === true
        ? buildWordpressPostTypeSeoRows(sourceProfile, phaseGPlan.max_items)
        : [];

    return {
      phase_g_inventory_status: "completed",
      plugin_signals: pluginSignals,
      redirect_rows: redirectRows,
      metadata_rows: metadataRows,
      taxonomy_seo_rows: taxonomySeoRows,
      post_type_seo_rows: postTypeSeoRows,
      summary: {
        redirect_count: redirectRows.length,
        metadata_count: metadataRows.length,
        taxonomy_seo_count: taxonomySeoRows.length,
        post_type_seo_count: postTypeSeoRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_seo_inventory_failed",
      message: err?.message || "WordPress SEO inventory failed."
    });

    return {
      phase_g_inventory_status: "completed_with_failures",
      plugin_signals: {},
      redirect_rows: [],
      metadata_rows: [],
      taxonomy_seo_rows: [],
      post_type_seo_rows: [],
      summary: {
        redirect_count: 0,
        metadata_count: 0,
        taxonomy_seo_count: 0,
        post_type_seo_count: 0
      },
      failures
    };
  }
}

function buildWordpressPhaseGInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_g_seo_inventory",
    artifact_version: "v1",
    phase_g_gate_status: String(gate.phase_g_gate_status || "").trim(),
    phase_g_inventory_status: String(inventory.phase_g_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    redirect_rows: Array.isArray(inventory.redirect_rows) ? inventory.redirect_rows : [],
    metadata_rows: Array.isArray(inventory.metadata_rows) ? inventory.metadata_rows : [],
    taxonomy_seo_rows: Array.isArray(inventory.taxonomy_seo_rows)
      ? inventory.taxonomy_seo_rows
      : [],
    post_type_seo_rows: Array.isArray(inventory.post_type_seo_rows)
      ? inventory.post_type_seo_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressSeoTextValue(value = "") {
  return String(value ?? "").trim();
}

function classifyWordpressRedirectRisk(row = {}) {
  const redirectType = String(row?.redirect_type || "").trim();
  const sourcePath = String(row?.source_path || "").trim();
  const targetPath = String(row?.target_path || "").trim();

  let riskScore = 0;
  const reasons = [];

  if (redirectType === "301" || redirectType === "308") {
    riskScore += 1;
    reasons.push("permanent_redirect");
  } else {
    riskScore += 2;
    reasons.push("non_permanent_redirect");
  }

  if (!sourcePath || !targetPath) {
    riskScore += 3;
    reasons.push("missing_redirect_path");
  }

  if (/^https?:\/\//i.test(targetPath)) {
    riskScore += 2;
    reasons.push("absolute_target_path");
  }

  let seo_risk_class = "low";
  if (riskScore >= 4) seo_risk_class = "high";
  else if (riskScore >= 2) seo_risk_class = "medium";

  return {
    seo_risk_score: riskScore,
    seo_risk_class,
    seo_risk_reasons: reasons
  };
}

function classifyWordpressMetadataRisk(row = {}) {
  const titleTemplate = normalizeWordpressSeoTextValue(row?.title_template);
  const metaDescriptionTemplate = normalizeWordpressSeoTextValue(
    row?.meta_description_template
  );
  const canonicalMode = normalizeWordpressSeoTextValue(row?.canonical_mode);

  let riskScore = 0;
  const reasons = [];

  if (!titleTemplate) {
    riskScore += 2;
    reasons.push("missing_title_template");
  }
  if (!metaDescriptionTemplate) {
    riskScore += 1;
    reasons.push("missing_meta_description_template");
  }
  if (!canonicalMode) {
    riskScore += 1;
    reasons.push("missing_canonical_mode");
  }

  let seo_risk_class = "low";
  if (riskScore >= 3) seo_risk_class = "high";
  else if (riskScore >= 1) seo_risk_class = "medium";

  return {
    title_template: titleTemplate,
    meta_description_template: metaDescriptionTemplate,
    canonical_mode: canonicalMode,
    seo_risk_score: riskScore,
    seo_risk_class,
    seo_risk_reasons: reasons
  };
}

function buildWordpressPhaseGNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const redirectRows = Array.isArray(inventory.redirect_rows)
    ? inventory.redirect_rows
    : [];
  const metadataRows = Array.isArray(inventory.metadata_rows)
    ? inventory.metadata_rows
    : [];
  const taxonomySeoRows = Array.isArray(inventory.taxonomy_seo_rows)
    ? inventory.taxonomy_seo_rows
    : [];
  const postTypeSeoRows = Array.isArray(inventory.post_type_seo_rows)
    ? inventory.post_type_seo_rows
    : [];

  const normalizedRedirectRows = redirectRows.map(row => {
    const risk = classifyWordpressRedirectRisk(row);
    return {
      ...row,
      seo_risk_score: risk.seo_risk_score,
      seo_risk_class: risk.seo_risk_class,
      seo_risk_reasons: risk.seo_risk_reasons
    };
  });

  const normalizeMetadataLikeRow = row => {
    const risk = classifyWordpressMetadataRisk(row);
    return {
      ...row,
      title_template: risk.title_template,
      meta_description_template: risk.meta_description_template,
      canonical_mode: risk.canonical_mode,
      seo_risk_score: risk.seo_risk_score,
      seo_risk_class: risk.seo_risk_class,
      seo_risk_reasons: risk.seo_risk_reasons
    };
  };

  const normalizedMetadataRows = metadataRows.map(normalizeMetadataLikeRow);
  const normalizedTaxonomySeoRows = taxonomySeoRows.map(normalizeMetadataLikeRow);
  const normalizedPostTypeSeoRows = postTypeSeoRows.map(normalizeMetadataLikeRow);

  const allRows = [
    ...normalizedRedirectRows,
    ...normalizedMetadataRows,
    ...normalizedTaxonomySeoRows,
    ...normalizedPostTypeSeoRows
  ];

  const riskSummary = allRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const riskClass = String(row?.seo_risk_class || "").trim();
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "redirect") acc.redirect_count += 1;
      else if (entityType === "seo_metadata") acc.metadata_count += 1;
      else if (entityType === "taxonomy_seo") acc.taxonomy_seo_count += 1;
      else if (entityType === "post_type_seo") acc.post_type_seo_count += 1;

      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    }
  );

  return {
    normalized_redirect_rows: normalizedRedirectRows,
    normalized_metadata_rows: normalizedMetadataRows,
    normalized_taxonomy_seo_rows: normalizedTaxonomySeoRows,
    normalized_post_type_seo_rows: normalizedPostTypeSeoRows,
    risk_summary: riskSummary
  };
}

function buildWordpressPhaseGNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_g_seo_strategy",
    artifact_version: "v1",
    phase_g_gate_status: String(gate.phase_g_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    normalized_redirect_rows: Array.isArray(normalizedInventory.normalized_redirect_rows)
      ? normalizedInventory.normalized_redirect_rows
      : [],
    normalized_metadata_rows: Array.isArray(normalizedInventory.normalized_metadata_rows)
      ? normalizedInventory.normalized_metadata_rows
      : [],
    normalized_taxonomy_seo_rows: Array.isArray(
      normalizedInventory.normalized_taxonomy_seo_rows
    )
      ? normalizedInventory.normalized_taxonomy_seo_rows
      : [],
    normalized_post_type_seo_rows: Array.isArray(
      normalizedInventory.normalized_post_type_seo_rows
    )
      ? normalizedInventory.normalized_post_type_seo_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseGReadinessGate(args = {}) {
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseGGate.blocking_reasons || [])];

  if (phaseGPlan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }

  const highRiskCount = Number(riskSummary.high_risk_count || 0);
  const mediumRiskCount = Number(riskSummary.medium_risk_count || 0);

  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_seo_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_seo_reconciliation"
      : "blocked_for_seo_reconciliation",
    readiness_ready: readiness,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: Number(riskSummary.low_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseGSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      redirect_candidates: [],
      metadata_candidates: [],
      taxonomy_seo_candidates: [],
      post_type_seo_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_g_readiness_not_ready"]
    };
  }

  const normalizedRedirectRows = Array.isArray(normalizedInventory.normalized_redirect_rows)
    ? normalizedInventory.normalized_redirect_rows
    : [];
  const normalizedMetadataRows = Array.isArray(normalizedInventory.normalized_metadata_rows)
    ? normalizedInventory.normalized_metadata_rows
    : [];
  const normalizedTaxonomySeoRows = Array.isArray(
    normalizedInventory.normalized_taxonomy_seo_rows
  )
    ? normalizedInventory.normalized_taxonomy_seo_rows
    : [];
  const normalizedPostTypeSeoRows = Array.isArray(
    normalizedInventory.normalized_post_type_seo_rows
  )
    ? normalizedInventory.normalized_post_type_seo_rows
    : [];

  const redirectCandidates = normalizedRedirectRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "redirect",
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_redirect_candidate"
    }));

  const metadataCandidates = normalizedMetadataRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "seo_metadata",
      entity_key: String(row?.entity_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      canonical_mode: String(row?.canonical_mode || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_metadata_candidate"
    }));

  const taxonomySeoCandidates = normalizedTaxonomySeoRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "taxonomy_seo",
      taxonomy_key: String(row?.taxonomy_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_taxonomy_seo_candidate"
    }));

  const postTypeSeoCandidates = normalizedPostTypeSeoRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "post_type_seo",
      post_type_key: String(row?.post_type_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_post_type_seo_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      redirectCandidates.length +
      metadataCandidates.length +
      taxonomySeoCandidates.length +
      postTypeSeoCandidates.length,
    redirect_candidates: redirectCandidates,
    metadata_candidates: metadataCandidates,
    taxonomy_seo_candidates: taxonomySeoCandidates,
    post_type_seo_candidates: postTypeSeoCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseGReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_g_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    high_risk_count: Number(readiness.high_risk_count || 0),
    medium_risk_count: Number(readiness.medium_risk_count || 0),
    low_risk_count: Number(readiness.low_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    redirect_candidates: Array.isArray(safeCandidates.redirect_candidates)
      ? safeCandidates.redirect_candidates
      : [],
    metadata_candidates: Array.isArray(safeCandidates.metadata_candidates)
      ? safeCandidates.metadata_candidates
      : [],
    taxonomy_seo_candidates: Array.isArray(safeCandidates.taxonomy_seo_candidates)
      ? safeCandidates.taxonomy_seo_candidates
      : [],
    post_type_seo_candidates: Array.isArray(safeCandidates.post_type_seo_candidates)
      ? safeCandidates.post_type_seo_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressRedirectReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "redirect",
    source_path: String(row?.source_path || "").trim(),
    target_path: String(row?.target_path || "").trim(),
    redirect_type: String(row?.redirect_type || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_mode: "safe_redirect_reconciliation_candidate",
    payload_shape: {
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

function buildWordpressMetadataReconciliationPayloadRow(row = {}) {
  return {
    entity_type: String(row?.entity_type || "seo_metadata").trim(),
    entity_key: String(row?.entity_key || "").trim(),
    taxonomy_key: String(row?.taxonomy_key || "").trim(),
    post_type_key: String(row?.post_type_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    canonical_mode: String(row?.canonical_mode || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_mode: "safe_metadata_reconciliation_candidate",
    payload_shape: {
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      canonical_mode: String(row?.canonical_mode || "").trim(),
      robots: String(row?.robots || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

function buildWordpressPhaseGReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      redirect_payload_rows: [],
      metadata_payload_rows: [],
      taxonomy_seo_payload_rows: [],
      post_type_seo_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_g_safe_candidates_not_ready"]
    };
  }

  const redirectCandidates = Array.isArray(safeCandidates.redirect_candidates)
    ? safeCandidates.redirect_candidates
    : [];
  const metadataCandidates = Array.isArray(safeCandidates.metadata_candidates)
    ? safeCandidates.metadata_candidates
    : [];
  const taxonomySeoCandidates = Array.isArray(safeCandidates.taxonomy_seo_candidates)
    ? safeCandidates.taxonomy_seo_candidates
    : [];
  const postTypeSeoCandidates = Array.isArray(safeCandidates.post_type_seo_candidates)
    ? safeCandidates.post_type_seo_candidates
    : [];

  const redirectPayloadRows = redirectCandidates.map(
    buildWordpressRedirectReconciliationPayloadRow
  );
  const metadataPayloadRows = metadataCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );
  const taxonomySeoPayloadRows = taxonomySeoCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );
  const postTypeSeoPayloadRows = postTypeSeoCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      redirectPayloadRows.length +
      metadataPayloadRows.length +
      taxonomySeoPayloadRows.length +
      postTypeSeoPayloadRows.length,
    redirect_payload_rows: redirectPayloadRows,
    metadata_payload_rows: metadataPayloadRows,
    taxonomy_seo_payload_rows: taxonomySeoPayloadRows,
    post_type_seo_payload_rows: postTypeSeoPayloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseGReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_g_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    redirect_payload_rows: Array.isArray(planner.redirect_payload_rows)
      ? planner.redirect_payload_rows
      : [],
    metadata_payload_rows: Array.isArray(planner.metadata_payload_rows)
      ? planner.metadata_payload_rows
      : [],
    taxonomy_seo_payload_rows: Array.isArray(planner.taxonomy_seo_payload_rows)
      ? planner.taxonomy_seo_payload_rows
      : [],
    post_type_seo_payload_rows: Array.isArray(planner.post_type_seo_payload_rows)
      ? planner.post_type_seo_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseGExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const seoSurfaces =
    migration.seo_surfaces && typeof migration.seo_surfaces === "object"
      ? migration.seo_surfaces
      : {};
  const execution =
    seoSurfaces.execution && typeof seoSurfaces.execution === "object"
      ? seoSurfaces.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

function buildWordpressPhaseGExecutionGuard(args = {}) {
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseGPlan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }
  if (phaseGGate.phase_g_gate_ready !== true) {
    blockingReasons.push("phase_g_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_g_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_g_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_g_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_g_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseGPlan.inventory_only === true && phaseGPlan.apply === true) {
    blockingReasons.push("phase_g_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_seo_reconciliation_execution"
      : "blocked_before_seo_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseGExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_g_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressPhaseGMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_redirect_candidates: [],
      selected_metadata_candidates: [],
      selected_taxonomy_seo_candidates: [],
      selected_post_type_seo_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_g_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_redirect_candidates: [],
      selected_metadata_candidates: [],
      selected_taxonomy_seo_candidates: [],
      selected_post_type_seo_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_g_payload_planner_not_ready"]
    };
  }

  const redirectPayloadRows = Array.isArray(payloadPlanner.redirect_payload_rows)
    ? payloadPlanner.redirect_payload_rows
    : [];
  const metadataPayloadRows = Array.isArray(payloadPlanner.metadata_payload_rows)
    ? payloadPlanner.metadata_payload_rows
    : [];
  const taxonomySeoPayloadRows = Array.isArray(payloadPlanner.taxonomy_seo_payload_rows)
    ? payloadPlanner.taxonomy_seo_payload_rows
    : [];
  const postTypeSeoPayloadRows = Array.isArray(payloadPlanner.post_type_seo_payload_rows)
    ? payloadPlanner.post_type_seo_payload_rows
    : [];

  const selectedRedirectCandidates = [];
  const selectedMetadataCandidates = [];
  const selectedTaxonomySeoCandidates = [];
  const selectedPostTypeSeoCandidates = [];
  const rejectedCandidates = [];

  for (const row of redirectPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "redirect",
        source_path: String(row?.source_path || "").trim(),
        rejection_reason: "high_risk_redirect_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_redirect_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "redirect",
        source_path: String(row?.source_path || "").trim(),
        rejection_reason: "unsupported_redirect_payload_mode"
      });
      continue;
    }

    selectedRedirectCandidates.push({
      ...row,
      candidate_reason: "safe_redirect_candidate_ready_for_mutation"
    });
  }

  for (const row of metadataPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "seo_metadata",
        entity_key: String(row?.entity_key || "").trim(),
        rejection_reason: "high_risk_metadata_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "seo_metadata",
        entity_key: String(row?.entity_key || "").trim(),
        rejection_reason: "unsupported_metadata_payload_mode"
      });
      continue;
    }

    selectedMetadataCandidates.push({
      ...row,
      candidate_reason: "safe_metadata_candidate_ready_for_mutation"
    });
  }

  for (const row of taxonomySeoPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "taxonomy_seo",
        taxonomy_key: String(row?.taxonomy_key || "").trim(),
        rejection_reason: "high_risk_taxonomy_seo_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "taxonomy_seo",
        taxonomy_key: String(row?.taxonomy_key || "").trim(),
        rejection_reason: "unsupported_taxonomy_seo_payload_mode"
      });
      continue;
    }

    selectedTaxonomySeoCandidates.push({
      ...row,
      candidate_reason: "safe_taxonomy_seo_candidate_ready_for_mutation"
    });
  }

  for (const row of postTypeSeoPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "post_type_seo",
        post_type_key: String(row?.post_type_key || "").trim(),
        rejection_reason: "high_risk_post_type_seo_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "post_type_seo",
        post_type_key: String(row?.post_type_key || "").trim(),
        rejection_reason: "unsupported_post_type_seo_payload_mode"
      });
      continue;
    }

    selectedPostTypeSeoCandidates.push({
      ...row,
      candidate_reason: "safe_post_type_seo_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedRedirectCandidates = selectedRedirectCandidates.slice(0, candidateLimit);
  const limitedSelectedMetadataCandidates = selectedMetadataCandidates.slice(0, candidateLimit);
  const limitedSelectedTaxonomySeoCandidates =
    selectedTaxonomySeoCandidates.slice(0, candidateLimit);
  const limitedSelectedPostTypeSeoCandidates =
    selectedPostTypeSeoCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedRedirectCandidates.length +
      limitedSelectedMetadataCandidates.length +
      limitedSelectedTaxonomySeoCandidates.length +
      limitedSelectedPostTypeSeoCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_redirect_candidates: limitedSelectedRedirectCandidates,
    selected_metadata_candidates: limitedSelectedMetadataCandidates,
    selected_taxonomy_seo_candidates: limitedSelectedTaxonomySeoCandidates,
    selected_post_type_seo_candidates: limitedSelectedPostTypeSeoCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseGMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_g_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_redirect_candidates: Array.isArray(selector.selected_redirect_candidates)
      ? selector.selected_redirect_candidates
      : [],
    selected_metadata_candidates: Array.isArray(selector.selected_metadata_candidates)
      ? selector.selected_metadata_candidates
      : [],
    selected_taxonomy_seo_candidates: Array.isArray(selector.selected_taxonomy_seo_candidates)
      ? selector.selected_taxonomy_seo_candidates
      : [],
    selected_post_type_seo_candidates: Array.isArray(selector.selected_post_type_seo_candidates)
      ? selector.selected_post_type_seo_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressRedirectMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_redirect_reconciliation",
    target_scope: "destination_wordpress_redirect",
    payload: {
      source_path: Object.prototype.hasOwnProperty.call(payloadShape, "source_path")
        ? payloadShape.source_path
        : String(row?.source_path || "").trim(),
      target_path: Object.prototype.hasOwnProperty.call(payloadShape, "target_path")
        ? payloadShape.target_path
        : String(row?.target_path || "").trim(),
      redirect_type: Object.prototype.hasOwnProperty.call(payloadShape, "redirect_type")
        ? payloadShape.redirect_type
        : String(row?.redirect_type || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressMetadataMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_metadata_reconciliation",
    target_scope: "destination_wordpress_seo_surface",
    payload: {
      title_template: Object.prototype.hasOwnProperty.call(payloadShape, "title_template")
        ? payloadShape.title_template
        : String(row?.title_template || "").trim(),
      meta_description_template: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "meta_description_template"
      )
        ? payloadShape.meta_description_template
        : String(row?.meta_description_template || "").trim(),
      canonical_mode: Object.prototype.hasOwnProperty.call(payloadShape, "canonical_mode")
        ? payloadShape.canonical_mode
        : String(row?.canonical_mode || "").trim(),
      robots: Object.prototype.hasOwnProperty.call(payloadShape, "robots")
        ? payloadShape.robots
        : String(row?.robots || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressPhaseGMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      redirect_composed_payloads: [],
      metadata_composed_payloads: [],
      taxonomy_seo_composed_payloads: [],
      post_type_seo_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_g_mutation_candidates_not_ready"]
    };
  }

  const selectedRedirectCandidates = Array.isArray(selector.selected_redirect_candidates)
    ? selector.selected_redirect_candidates
    : [];
  const selectedMetadataCandidates = Array.isArray(selector.selected_metadata_candidates)
    ? selector.selected_metadata_candidates
    : [];
  const selectedTaxonomySeoCandidates = Array.isArray(
    selector.selected_taxonomy_seo_candidates
  )
    ? selector.selected_taxonomy_seo_candidates
    : [];
  const selectedPostTypeSeoCandidates = Array.isArray(
    selector.selected_post_type_seo_candidates
  )
    ? selector.selected_post_type_seo_candidates
    : [];

  const redirectComposedPayloads = selectedRedirectCandidates.map(row => ({
    entity_type: "redirect",
    source_path: String(row?.source_path || "").trim(),
    target_path: String(row?.target_path || "").trim(),
    redirect_type: String(row?.redirect_type || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_redirect_candidate",
    mutation_payload: buildWordpressRedirectMutationPayloadFromCandidate(row)
  }));

  const metadataComposedPayloads = selectedMetadataCandidates.map(row => ({
    entity_type: "seo_metadata",
    entity_key: String(row?.entity_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_metadata_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  const taxonomySeoComposedPayloads = selectedTaxonomySeoCandidates.map(row => ({
    entity_type: "taxonomy_seo",
    taxonomy_key: String(row?.taxonomy_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_taxonomy_seo_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  const postTypeSeoComposedPayloads = selectedPostTypeSeoCandidates.map(row => ({
    entity_type: "post_type_seo",
    post_type_key: String(row?.post_type_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_post_type_seo_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      redirectComposedPayloads.length +
      metadataComposedPayloads.length +
      taxonomySeoComposedPayloads.length +
      postTypeSeoComposedPayloads.length,
    redirect_composed_payloads: redirectComposedPayloads,
    metadata_composed_payloads: metadataComposedPayloads,
    taxonomy_seo_composed_payloads: taxonomySeoComposedPayloads,
    post_type_seo_composed_payloads: postTypeSeoComposedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseGMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_g_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    redirect_composed_payloads: Array.isArray(composer.redirect_composed_payloads)
      ? composer.redirect_composed_payloads
      : [],
    metadata_composed_payloads: Array.isArray(composer.metadata_composed_payloads)
      ? composer.metadata_composed_payloads
      : [],
    taxonomy_seo_composed_payloads: Array.isArray(composer.taxonomy_seo_composed_payloads)
      ? composer.taxonomy_seo_composed_payloads
      : [],
    post_type_seo_composed_payloads: Array.isArray(
      composer.post_type_seo_composed_payloads
    )
      ? composer.post_type_seo_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function simulateWordpressSeoDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "redirect") {
    return {
      entity_type: "redirect",
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_source_path: String(payload.source_path || "").trim(),
        expected_target_path: String(payload.target_path || "").trim(),
        expected_redirect_type: String(payload.redirect_type || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "seo_metadata") {
    return {
      entity_type: "seo_metadata",
      entity_key: String(row?.entity_key || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_title_template: String(payload.title_template || "").trim(),
        expected_meta_description_template: String(
          payload.meta_description_template || ""
        ).trim(),
        expected_canonical_mode: String(payload.canonical_mode || "").trim(),
        expected_robots: String(payload.robots || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "taxonomy_seo") {
    return {
      entity_type: "taxonomy_seo",
      taxonomy_key: String(row?.taxonomy_key || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_title_template: String(payload.title_template || "").trim(),
        expected_meta_description_template: String(
          payload.meta_description_template || ""
        ).trim(),
        expected_canonical_mode: String(payload.canonical_mode || "").trim(),
        expected_robots: String(payload.robots || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: "post_type_seo",
    post_type_key: String(row?.post_type_key || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_title_template: String(payload.title_template || "").trim(),
      expected_meta_description_template: String(
        payload.meta_description_template || ""
      ).trim(),
      expected_canonical_mode: String(payload.canonical_mode || "").trim(),
      expected_robots: String(payload.robots || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

function buildWordpressPhaseGDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_redirect_rows: [],
      simulated_metadata_rows: [],
      simulated_taxonomy_seo_rows: [],
      simulated_post_type_seo_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        redirect_rows: 0,
        metadata_rows: 0,
        taxonomy_seo_rows: 0,
        post_type_seo_rows: 0,
        preserve_from_source_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_g_mutation_payloads_not_ready"]
    };
  }

  const redirectRows = Array.isArray(composer.redirect_composed_payloads)
    ? composer.redirect_composed_payloads
    : [];
  const metadataRows = Array.isArray(composer.metadata_composed_payloads)
    ? composer.metadata_composed_payloads
    : [];
  const taxonomySeoRows = Array.isArray(composer.taxonomy_seo_composed_payloads)
    ? composer.taxonomy_seo_composed_payloads
    : [];
  const postTypeSeoRows = Array.isArray(composer.post_type_seo_composed_payloads)
    ? composer.post_type_seo_composed_payloads
    : [];

  const simulatedRedirectRows = redirectRows.map(simulateWordpressSeoDryRunRow);
  const simulatedMetadataRows = metadataRows.map(simulateWordpressSeoDryRunRow);
  const simulatedTaxonomySeoRows = taxonomySeoRows.map(simulateWordpressSeoDryRunRow);
  const simulatedPostTypeSeoRows = postTypeSeoRows.map(simulateWordpressSeoDryRunRow);

  const allRows = [
    ...simulatedRedirectRows,
    ...simulatedMetadataRows,
    ...simulatedTaxonomySeoRows,
    ...simulatedPostTypeSeoRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "redirect") acc.redirect_rows += 1;
      else if (entityType === "seo_metadata") acc.metadata_rows += 1;
      else if (entityType === "taxonomy_seo") acc.taxonomy_seo_rows += 1;
      else if (entityType === "post_type_seo") acc.post_type_seo_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (String(preview.expected_apply_mode || "").trim() === "preserve_from_source") {
        acc.preserve_from_source_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_redirect_rows: simulatedRedirectRows,
    simulated_metadata_rows: simulatedMetadataRows,
    simulated_taxonomy_seo_rows: simulatedTaxonomySeoRows,
    simulated_post_type_seo_rows: simulatedPostTypeSeoRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

function buildWordpressPhaseGDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_g_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_redirect_rows: Array.isArray(simulator.simulated_redirect_rows)
      ? simulator.simulated_redirect_rows
      : [],
    simulated_metadata_rows: Array.isArray(simulator.simulated_metadata_rows)
      ? simulator.simulated_metadata_rows
      : [],
    simulated_taxonomy_seo_rows: Array.isArray(simulator.simulated_taxonomy_seo_rows)
      ? simulator.simulated_taxonomy_seo_rows
      : [],
    simulated_post_type_seo_rows: Array.isArray(simulator.simulated_post_type_seo_rows)
      ? simulator.simulated_post_type_seo_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            redirect_rows: 0,
            metadata_rows: 0,
            taxonomy_seo_rows: 0,
            post_type_seo_rows: 0,
            preserve_from_source_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

function buildWordpressPhaseGFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const normalizedInventoryArtifact =
    args.normalizedInventoryArtifact &&
    typeof args.normalizedInventoryArtifact === "object"
      ? args.normalizedInventoryArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const reconciliationPayloadArtifact =
    args.reconciliationPayloadArtifact &&
    typeof args.reconciliationPayloadArtifact === "object"
      ? args.reconciliationPayloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_g_final_operator_handoff",
    artifact_version: "v1",
    phase_g_enabled: phaseGPlan.enabled === true,
    phase_g_inventory_only: phaseGPlan.inventory_only === true,
    phase_g_apply_requested: phaseGPlan.apply === true,
    requested_seo_scope: {
      include_redirects: phaseGPlan.include_redirects === true,
      include_metadata: phaseGPlan.include_metadata === true,
      include_taxonomy_seo: phaseGPlan.include_taxonomy_seo === true,
      include_post_type_seo: phaseGPlan.include_post_type_seo === true,
      max_items: Number(phaseGPlan.max_items || 0)
    },
    requested_seo_config:
      migration?.seo_surfaces && typeof migration.seo_surfaces === "object"
        ? migration.seo_surfaces
        : {},
    phase_g_gate_status: String(phaseGGate.phase_g_gate_status || "").trim(),
    phase_g_inventory_status: String(inventoryArtifact.phase_g_inventory_status || "").trim(),
    phase_g_strategy_status: String(
      normalizedInventoryArtifact.phase_g_gate_status || ""
    ).trim(),
    phase_g_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_g_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_g_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_g_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_g_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_g_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_g_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    plugin_signals:
      inventoryArtifact?.plugin_signals && typeof inventoryArtifact.plugin_signals === "object"
        ? inventoryArtifact.plugin_signals
        : {},
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseGGate.blocking_reasons) ? phaseGGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(reconciliationPayloadArtifact.blocking_reasons)
        ? reconciliationPayloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_seo_candidates"
        : "resolve_seo_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_seo_reconciliation_execution"
        ? "approve_seo_mutation_trial"
        : "hold_seo_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_seo_dry_run_preview"
        : "no_seo_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    reconciliation_payload_artifact: reconciliationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

function resolveWordpressPhaseHPlan(payload = {}) {
  const migration = payload?.migration || {};
  const analytics = migration.analytics_tracking && typeof migration.analytics_tracking === "object"
    ? migration.analytics_tracking
    : {};

  return {
    enabled: analytics.enabled === true,
    inventory_only:
      analytics.inventory_only === undefined ? true : analytics.inventory_only === true,
    apply: analytics.apply === true,
    include_google_analytics:
      analytics.include_google_analytics === undefined
        ? true
        : analytics.include_google_analytics === true,
    include_gtm:
      analytics.include_gtm === undefined ? true : analytics.include_gtm === true,
    include_meta_pixel:
      analytics.include_meta_pixel === undefined
        ? true
        : analytics.include_meta_pixel === true,
    include_tiktok_pixel:
      analytics.include_tiktok_pixel === true,
    include_custom_tracking:
      analytics.include_custom_tracking === undefined
        ? true
        : analytics.include_custom_tracking === true,
    max_items: Math.max(1, toPositiveInt(analytics.max_items, 500))
  };
}

function assertWordpressPhaseHPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_h_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_google_analytics !== true &&
    plan.include_gtm !== true &&
    plan.include_meta_pixel !== true &&
    plan.include_tiktok_pixel !== true &&
    plan.include_custom_tracking !== true
  ) {
    blockingReasons.push("phase_h_no_inventory_scope_selected");
  }

  return {
    phase_h_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_h_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseHGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDFinalOperatorHandoffBundle =
    args.phaseDFinalOperatorHandoffBundle &&
    typeof args.phaseDFinalOperatorHandoffBundle === "object"
      ? args.phaseDFinalOperatorHandoffBundle
      : {};
  const phaseEFinalOperatorHandoffBundle =
    args.phaseEFinalOperatorHandoffBundle &&
    typeof args.phaseEFinalOperatorHandoffBundle === "object"
      ? args.phaseEFinalOperatorHandoffBundle
      : {};
  const phaseFFinalOperatorHandoffBundle =
    args.phaseFFinalOperatorHandoffBundle &&
    typeof args.phaseFFinalOperatorHandoffBundle === "object"
      ? args.phaseFFinalOperatorHandoffBundle
      : {};
  const phaseGFinalOperatorHandoffBundle =
    args.phaseGFinalOperatorHandoffBundle &&
    typeof args.phaseGFinalOperatorHandoffBundle === "object"
      ? args.phaseGFinalOperatorHandoffBundle
      : {};
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHPlanStatus =
    args.phaseHPlanStatus && typeof args.phaseHPlanStatus === "object"
      ? args.phaseHPlanStatus
      : {};

  const blockingReasons = [...(phaseHPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_h");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseGFinalOperatorHandoffBundle.phase_g_enabled === true &&
    String(phaseGFinalOperatorHandoffBundle.phase_g_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_g_seo_stage_blocked");
  }

  return {
    phase_h_gate_status:
      blockingReasons.length === 0
        ? "ready_for_analytics_tracking_inventory"
        : "blocked",
    phase_h_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseHPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

function inferWordpressAnalyticsPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_site_kit: normalized.some(x => x.includes("google-site-kit")),
    has_gtm_plugin: normalized.some(x => x.includes("google-tag-manager")),
    has_pixel_plugin: normalized.some(
      x => x.includes("facebook-for-woocommerce") || x.includes("pixel")
    ),
    has_cookie_plugin: normalized.some(
      x =>
        x.includes("cookieyes") ||
        x.includes("complianz") ||
        x.includes("cookie-notice")
    ),
    has_ga_plugin: normalized.some(
      x =>
        x.includes("ga-google-analytics") ||
        x.includes("monsterinsights") ||
        x.includes("site-kit")
    )
  };
}

function buildWordpressTrackingRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const tracking =
    siteProfile?.tracking_surfaces &&
    typeof siteProfile.tracking_surfaces === "object" &&
    !Array.isArray(siteProfile.tracking_surfaces)
      ? siteProfile.tracking_surfaces
      : {};

  const trackers = [
    "google_analytics",
    "gtm",
    "meta_pixel",
    "tiktok_pixel",
    "custom_tracking"
  ];

  for (const key of trackers.slice(0, limit)) {
    if (!Object.prototype.hasOwnProperty.call(tracking, key)) continue;
    const value =
      tracking[key] && typeof tracking[key] === "object" && !Array.isArray(tracking[key])
        ? tracking[key]
        : {};

    rows.push({
      entity_type: "tracking_surface",
      tracking_key: String(key || "").trim(),
      tracking_id: String(
        value.tracking_id || value.id || value.container_id || ""
      ).trim(),
      implementation_mode: String(value.implementation_mode || value.mode || "").trim(),
      location_hint: String(value.location_hint || value.location || "").trim(),
      consent_required:
        value.consent_required === true ||
        String(value.consent_required || "").trim().toLowerCase() === "true",
      inventory_classification: "tracking_surface"
    });
  }

  return rows;
}

function buildWordpressConsentRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const consent =
    siteProfile?.consent_surfaces &&
    typeof siteProfile.consent_surfaces === "object" &&
    !Array.isArray(siteProfile.consent_surfaces)
      ? siteProfile.consent_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(consent).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "consent_surface",
      consent_key: String(key || "").trim(),
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      region_scope: String(value.region_scope || "").trim(),
      blocks_tracking_before_consent:
        value.blocks_tracking_before_consent === true ||
        String(value.blocks_tracking_before_consent || "").trim().toLowerCase() ===
          "true",
      inventory_classification: "consent_surface"
    });
  }

  return rows;
}

async function runWordpressAnalyticsTrackingInventory(args = {}) {
  const {
    wpContext = {},
    phaseHPlan = {},
    phaseHGate = {}
  } = args;

  if (phaseHGate.phase_h_gate_ready !== true) {
    return {
      phase_h_inventory_status: "blocked",
      plugin_signals: {},
      tracking_rows: [],
      consent_rows: [],
      summary: {
        tracking_count: 0,
        consent_count: 0
      },
      failures: [
        {
          code: "phase_h_analytics_inventory_blocked",
          message: "Phase H analytics/tracking inventory blocked by phase_h_gate.",
          blocking_reasons: phaseHGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressAnalyticsPluginSignals(sourceProfile);
    const trackingRows = buildWordpressTrackingRows(sourceProfile, phaseHPlan.max_items).filter(
      row =>
        (phaseHPlan.include_google_analytics === true &&
          row.tracking_key === "google_analytics") ||
        (phaseHPlan.include_gtm === true && row.tracking_key === "gtm") ||
        (phaseHPlan.include_meta_pixel === true && row.tracking_key === "meta_pixel") ||
        (phaseHPlan.include_tiktok_pixel === true && row.tracking_key === "tiktok_pixel") ||
        (phaseHPlan.include_custom_tracking === true &&
          row.tracking_key === "custom_tracking")
    );
    const consentRows = buildWordpressConsentRows(sourceProfile, phaseHPlan.max_items);

    return {
      phase_h_inventory_status: "completed",
      plugin_signals: pluginSignals,
      tracking_rows: trackingRows,
      consent_rows: consentRows,
      summary: {
        tracking_count: trackingRows.length,
        consent_count: consentRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_analytics_inventory_failed",
      message: err?.message || "WordPress analytics/tracking inventory failed."
    });

    return {
      phase_h_inventory_status: "completed_with_failures",
      plugin_signals: {},
      tracking_rows: [],
      consent_rows: [],
      summary: {
        tracking_count: 0,
        consent_count: 0
      },
      failures
    };
  }
}

function buildWordpressPhaseHInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_h_analytics_tracking_inventory",
    artifact_version: "v1",
    phase_h_gate_status: String(gate.phase_h_gate_status || "").trim(),
    phase_h_inventory_status: String(inventory.phase_h_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            tracking_count: 0,
            consent_count: 0
          },
    tracking_rows: Array.isArray(inventory.tracking_rows) ? inventory.tracking_rows : [],
    consent_rows: Array.isArray(inventory.consent_rows) ? inventory.consent_rows : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

function normalizeWordpressTrackingTextValue(value = "") {
  return String(value ?? "").trim();
}

function classifyWordpressTrackingRisk(row = {}) {
  const trackingKey = normalizeWordpressTrackingTextValue(row?.tracking_key);
  const trackingId = normalizeWordpressTrackingTextValue(row?.tracking_id);
  const implementationMode = normalizeWordpressTrackingTextValue(
    row?.implementation_mode
  );
  const locationHint = normalizeWordpressTrackingTextValue(row?.location_hint);
  const consentRequired = row?.consent_required === true;

  let riskScore = 0;
  const reasons = [];

  if (!trackingId) {
    riskScore += 3;
    reasons.push("missing_tracking_id");
  }

  if (!implementationMode) {
    riskScore += 2;
    reasons.push("missing_implementation_mode");
  } else if (
    implementationMode === "hardcoded" ||
    implementationMode === "theme_code" ||
    implementationMode === "template_injection"
  ) {
    riskScore += 2;
    reasons.push("hardcoded_implementation_mode");
  } else if (
    implementationMode === "plugin" ||
    implementationMode === "gtm" ||
    implementationMode === "consent_manager"
  ) {
    riskScore += 1;
    reasons.push("managed_implementation_mode");
  }

  if (!locationHint) {
    riskScore += 1;
    reasons.push("missing_location_hint");
  }

  if (
    (trackingKey === "meta_pixel" || trackingKey === "tiktok_pixel") &&
    consentRequired !== true
  ) {
    riskScore += 3;
    reasons.push("marketing_tracker_without_consent_requirement");
  }

  if (trackingKey === "custom_tracking") {
    riskScore += 2;
    reasons.push("custom_tracking_surface");
  }

  let tracking_risk_class = "low";
  if (riskScore >= 5) tracking_risk_class = "high";
  else if (riskScore >= 2) tracking_risk_class = "medium";

  return {
    tracking_key: trackingKey,
    tracking_id: trackingId,
    implementation_mode: implementationMode,
    location_hint: locationHint,
    consent_required: consentRequired,
    tracking_risk_score: riskScore,
    tracking_risk_class,
    tracking_risk_reasons: reasons
  };
}

function classifyWordpressConsentRisk(row = {}) {
  const consentKey = normalizeWordpressTrackingTextValue(row?.consent_key);
  const provider = normalizeWordpressTrackingTextValue(row?.provider);
  const mode = normalizeWordpressTrackingTextValue(row?.mode);
  const regionScope = normalizeWordpressTrackingTextValue(row?.region_scope);
  const blocksTrackingBeforeConsent = row?.blocks_tracking_before_consent === true;

  let riskScore = 0;
  const reasons = [];

  if (!provider) {
    riskScore += 2;
    reasons.push("missing_consent_provider");
  }

  if (!mode) {
    riskScore += 1;
    reasons.push("missing_consent_mode");
  }

  if (!regionScope) {
    riskScore += 1;
    reasons.push("missing_region_scope");
  }

  if (blocksTrackingBeforeConsent !== true) {
    riskScore += 3;
    reasons.push("tracking_not_blocked_before_consent");
  }

  if (consentKey === "custom_consent") {
    riskScore += 2;
    reasons.push("custom_consent_surface");
  }

  let consent_risk_class = "low";
  if (riskScore >= 5) consent_risk_class = "high";
  else if (riskScore >= 2) consent_risk_class = "medium";

  return {
    consent_key: consentKey,
    provider,
    mode,
    region_scope: regionScope,
    blocks_tracking_before_consent: blocksTrackingBeforeConsent,
    consent_risk_score: riskScore,
    consent_risk_class,
    consent_risk_reasons: reasons
  };
}

function buildWordpressPhaseHNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const trackingRows = Array.isArray(inventory.tracking_rows)
    ? inventory.tracking_rows
    : [];
  const consentRows = Array.isArray(inventory.consent_rows)
    ? inventory.consent_rows
    : [];

  const normalizedTrackingRows = trackingRows.map(row => {
    const risk = classifyWordpressTrackingRisk(row);
    return {
      ...row,
      tracking_key: risk.tracking_key,
      tracking_id: risk.tracking_id,
      implementation_mode: risk.implementation_mode,
      location_hint: risk.location_hint,
      consent_required: risk.consent_required,
      tracking_risk_score: risk.tracking_risk_score,
      tracking_risk_class: risk.tracking_risk_class,
      tracking_risk_reasons: risk.tracking_risk_reasons
    };
  });

  const normalizedConsentRows = consentRows.map(row => {
    const risk = classifyWordpressConsentRisk(row);
    return {
      ...row,
      consent_key: risk.consent_key,
      provider: risk.provider,
      mode: risk.mode,
      region_scope: risk.region_scope,
      blocks_tracking_before_consent: risk.blocks_tracking_before_consent,
      consent_risk_score: risk.consent_risk_score,
      consent_risk_class: risk.consent_risk_class,
      consent_risk_reasons: risk.consent_risk_reasons
    };
  });

  const riskSummary = {
    tracking_total_count: normalizedTrackingRows.length,
    tracking_high_risk_count: normalizedTrackingRows.filter(
      x => String(x?.tracking_risk_class || "").trim() === "high"
    ).length,
    tracking_medium_risk_count: normalizedTrackingRows.filter(
      x => String(x?.tracking_risk_class || "").trim() === "medium"
    ).length,
    consent_total_count: normalizedConsentRows.length,
    consent_high_risk_count: normalizedConsentRows.filter(
      x => String(x?.consent_risk_class || "").trim() === "high"
    ).length,
    consent_medium_risk_count: normalizedConsentRows.filter(
      x => String(x?.consent_risk_class || "").trim() === "medium"
    ).length
  };

  return {
    normalized_tracking_rows: normalizedTrackingRows,
    normalized_consent_rows: normalizedConsentRows,
    risk_summary: riskSummary
  };
}

function buildWordpressPhaseHNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_h_analytics_tracking_strategy",
    artifact_version: "v1",
    phase_h_gate_status: String(gate.phase_h_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            tracking_total_count: 0,
            tracking_high_risk_count: 0,
            tracking_medium_risk_count: 0,
            consent_total_count: 0,
            consent_high_risk_count: 0,
            consent_medium_risk_count: 0
          },
    normalized_tracking_rows: Array.isArray(normalizedInventory.normalized_tracking_rows)
      ? normalizedInventory.normalized_tracking_rows
      : [],
    normalized_consent_rows: Array.isArray(normalizedInventory.normalized_consent_rows)
      ? normalizedInventory.normalized_consent_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

function buildWordpressPhaseHReadinessGate(args = {}) {
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHGate =
    args.phaseHGate && typeof args.phaseHGate === "object" ? args.phaseHGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseHGate.blocking_reasons || [])];

  if (phaseHPlan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }

  const trackingHighRiskCount = Number(riskSummary.tracking_high_risk_count || 0);
  const consentHighRiskCount = Number(riskSummary.consent_high_risk_count || 0);

  if (trackingHighRiskCount > 0) {
    blockingReasons.push("high_risk_tracking_surfaces_present");
  }
  if (consentHighRiskCount > 0) {
    blockingReasons.push("high_risk_consent_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_analytics_tracking_reconciliation"
      : "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: readiness,
    tracking_high_risk_count: trackingHighRiskCount,
    tracking_medium_risk_count: Number(riskSummary.tracking_medium_risk_count || 0),
    consent_high_risk_count: consentHighRiskCount,
    consent_medium_risk_count: Number(riskSummary.consent_medium_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseHSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      tracking_candidates: [],
      consent_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_h_readiness_not_ready"]
    };
  }

  const normalizedTrackingRows = Array.isArray(normalizedInventory.normalized_tracking_rows)
    ? normalizedInventory.normalized_tracking_rows
    : [];
  const normalizedConsentRows = Array.isArray(normalizedInventory.normalized_consent_rows)
    ? normalizedInventory.normalized_consent_rows
    : [];

  const trackingCandidates = normalizedTrackingRows
    .filter(row => String(row?.tracking_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "tracking_surface",
      tracking_key: String(row?.tracking_key || "").trim(),
      tracking_id: String(row?.tracking_id || "").trim(),
      implementation_mode: String(row?.implementation_mode || "").trim(),
      location_hint: String(row?.location_hint || "").trim(),
      consent_required: row?.consent_required === true,
      tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
      candidate_reason: "non_high_risk_tracking_candidate"
    }));

  const consentCandidates = normalizedConsentRows
    .filter(row => String(row?.consent_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "consent_surface",
      consent_key: String(row?.consent_key || "").trim(),
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      region_scope: String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
      consent_risk_class: String(row?.consent_risk_class || "").trim(),
      candidate_reason: "non_high_risk_consent_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: trackingCandidates.length + consentCandidates.length,
    tracking_candidates: trackingCandidates,
    consent_candidates: consentCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseHReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_h_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    tracking_high_risk_count: Number(readiness.tracking_high_risk_count || 0),
    tracking_medium_risk_count: Number(readiness.tracking_medium_risk_count || 0),
    consent_high_risk_count: Number(readiness.consent_high_risk_count || 0),
    consent_medium_risk_count: Number(readiness.consent_medium_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    tracking_candidates: Array.isArray(safeCandidates.tracking_candidates)
      ? safeCandidates.tracking_candidates
      : [],
    consent_candidates: Array.isArray(safeCandidates.consent_candidates)
      ? safeCandidates.consent_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

function buildWordpressTrackingReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "tracking_surface",
    tracking_key: String(row?.tracking_key || "").trim(),
    tracking_id: String(row?.tracking_id || "").trim(),
    implementation_mode: String(row?.implementation_mode || "").trim(),
    location_hint: String(row?.location_hint || "").trim(),
    consent_required: row?.consent_required === true,
    tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
    payload_mode: "safe_tracking_reconciliation_candidate",
    payload_shape: {
      tracking_key: String(row?.tracking_key || "").trim(),
      tracking_id: String(row?.tracking_id || "").trim(),
      implementation_mode: String(row?.implementation_mode || "").trim(),
      location_hint: String(row?.location_hint || "").trim(),
      consent_required: row?.consent_required === true,
      apply_mode: "preserve_from_source"
    }
  };
}

function buildWordpressConsentReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    payload_mode: "safe_consent_reconciliation_candidate",
    payload_shape: {
      consent_key: String(row?.consent_key || "").trim(),
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      region_scope: String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
      apply_mode: "preserve_from_source"
    }
  };
}

function buildWordpressPhaseHReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      tracking_payload_rows: [],
      consent_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_h_safe_candidates_not_ready"]
    };
  }

  const trackingCandidates = Array.isArray(safeCandidates.tracking_candidates)
    ? safeCandidates.tracking_candidates
    : [];
  const consentCandidates = Array.isArray(safeCandidates.consent_candidates)
    ? safeCandidates.consent_candidates
    : [];

  const trackingPayloadRows = trackingCandidates.map(
    buildWordpressTrackingReconciliationPayloadRow
  );
  const consentPayloadRows = consentCandidates.map(
    buildWordpressConsentReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count: trackingPayloadRows.length + consentPayloadRows.length,
    tracking_payload_rows: trackingPayloadRows,
    consent_payload_rows: consentPayloadRows,
    blocking_reasons: []
  };
}

function buildWordpressPhaseHReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_h_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    tracking_payload_rows: Array.isArray(planner.tracking_payload_rows)
      ? planner.tracking_payload_rows
      : [],
    consent_payload_rows: Array.isArray(planner.consent_payload_rows)
      ? planner.consent_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

function resolveWordpressPhaseHExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const analyticsTracking =
    migration.analytics_tracking && typeof migration.analytics_tracking === "object"
      ? migration.analytics_tracking
      : {};
  const execution =
    analyticsTracking.execution && typeof analyticsTracking.execution === "object"
      ? analyticsTracking.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

function buildWordpressPhaseHExecutionGuard(args = {}) {
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHGate =
    args.phaseHGate && typeof args.phaseHGate === "object" ? args.phaseHGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseHPlan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }
  if (phaseHGate.phase_h_gate_ready !== true) {
    blockingReasons.push("phase_h_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_h_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_h_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_h_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_h_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseHPlan.inventory_only === true && phaseHPlan.apply === true) {
    blockingReasons.push("phase_h_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_analytics_tracking_reconciliation_execution"
      : "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

function buildWordpressPhaseHExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_h_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

function buildWordpressTrackingMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_tracking_reconciliation",
    target_scope: "destination_wordpress_tracking_surface",
    payload: {
      tracking_key: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_key")
        ? payloadShape.tracking_key
        : String(row?.tracking_key || "").trim(),
      tracking_id: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_id")
        ? payloadShape.tracking_id
        : String(row?.tracking_id || "").trim(),
      implementation_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "implementation_mode"
      )
        ? payloadShape.implementation_mode
        : String(row?.implementation_mode || "").trim(),
      location_hint: Object.prototype.hasOwnProperty.call(payloadShape, "location_hint")
        ? payloadShape.location_hint
        : String(row?.location_hint || "").trim(),
      consent_required: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "consent_required"
      )
        ? payloadShape.consent_required === true
        : row?.consent_required === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressConsentMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_consent_reconciliation",
    target_scope: "destination_wordpress_consent_surface",
    payload: {
      consent_key: Object.prototype.hasOwnProperty.call(payloadShape, "consent_key")
        ? payloadShape.consent_key
        : String(row?.consent_key || "").trim(),
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      region_scope: Object.prototype.hasOwnProperty.call(payloadShape, "region_scope")
        ? payloadShape.region_scope
        : String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "blocks_tracking_before_consent"
      )
        ? payloadShape.blocks_tracking_before_consent === true
        : row?.blocks_tracking_before_consent === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressPhaseHMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      tracking_composed_payloads: [],
      consent_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_h_mutation_candidates_not_ready"]
    };
  }

  const selectedTrackingCandidates = Array.isArray(selector.selected_tracking_candidates)
    ? selector.selected_tracking_candidates
    : [];
  const selectedConsentCandidates = Array.isArray(selector.selected_consent_candidates)
    ? selector.selected_consent_candidates
    : [];

  const trackingComposedPayloads = selectedTrackingCandidates.map(row => ({
    entity_type: "tracking_surface",
    tracking_key: String(row?.tracking_key || "").trim(),
    tracking_id: String(row?.tracking_id || "").trim(),
    implementation_mode: String(row?.implementation_mode || "").trim(),
    location_hint: String(row?.location_hint || "").trim(),
    tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
    payload_reason: "composed_from_safe_tracking_candidate",
    mutation_payload: buildWordpressTrackingMutationPayloadFromCandidate(row)
  }));

  const consentComposedPayloads = selectedConsentCandidates.map(row => ({
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    payload_reason: "composed_from_safe_consent_candidate",
    mutation_payload: buildWordpressConsentMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: trackingComposedPayloads.length + consentComposedPayloads.length,
    tracking_composed_payloads: trackingComposedPayloads,
    consent_composed_payloads: consentComposedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseHMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_h_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    tracking_composed_payloads: Array.isArray(composer.tracking_composed_payloads)
      ? composer.tracking_composed_payloads
      : [],
    consent_composed_payloads: Array.isArray(composer.consent_composed_payloads)
      ? composer.consent_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

function buildWordpressPhaseHMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_tracking_candidates: [],
      selected_consent_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_h_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_tracking_candidates: [],
      selected_consent_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_h_payload_planner_not_ready"]
    };
  }

  const trackingPayloadRows = Array.isArray(payloadPlanner.tracking_payload_rows)
    ? payloadPlanner.tracking_payload_rows
    : [];
  const consentPayloadRows = Array.isArray(payloadPlanner.consent_payload_rows)
    ? payloadPlanner.consent_payload_rows
    : [];

  const selectedTrackingCandidates = [];
  const selectedConsentCandidates = [];
  const rejectedCandidates = [];

  for (const row of trackingPayloadRows) {
    const trackingRiskClass = String(row?.tracking_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (trackingRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "tracking_surface",
        tracking_key: String(row?.tracking_key || "").trim(),
        rejection_reason: "high_risk_tracking_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_tracking_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "tracking_surface",
        tracking_key: String(row?.tracking_key || "").trim(),
        rejection_reason: "unsupported_tracking_payload_mode"
      });
      continue;
    }

    selectedTrackingCandidates.push({
      ...row,
      candidate_reason: "safe_tracking_candidate_ready_for_mutation"
    });
  }

  for (const row of consentPayloadRows) {
    const consentRiskClass = String(row?.consent_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (consentRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "consent_surface",
        consent_key: String(row?.consent_key || "").trim(),
        rejection_reason: "high_risk_consent_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_consent_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "consent_surface",
        consent_key: String(row?.consent_key || "").trim(),
        rejection_reason: "unsupported_consent_payload_mode"
      });
      continue;
    }

    selectedConsentCandidates.push({
      ...row,
      candidate_reason: "safe_consent_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedTrackingCandidates =
    selectedTrackingCandidates.slice(0, candidateLimit);
  const limitedSelectedConsentCandidates =
    selectedConsentCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedTrackingCandidates.length +
      limitedSelectedConsentCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_tracking_candidates: limitedSelectedTrackingCandidates,
    selected_consent_candidates: limitedSelectedConsentCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

function buildWordpressPhaseHMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_h_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_tracking_candidates: Array.isArray(selector.selected_tracking_candidates)
      ? selector.selected_tracking_candidates
      : [],
    selected_consent_candidates: Array.isArray(selector.selected_consent_candidates)
      ? selector.selected_consent_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

function buildWordpressTrackingMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_tracking_reconciliation",
    target_scope: "destination_wordpress_tracking_surface",
    payload: {
      tracking_key: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_key")
        ? payloadShape.tracking_key
        : String(row?.tracking_key || "").trim(),
      tracking_id: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_id")
        ? payloadShape.tracking_id
        : String(row?.tracking_id || "").trim(),
      implementation_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "implementation_mode"
      )
        ? payloadShape.implementation_mode
        : String(row?.implementation_mode || "").trim(),
      location_hint: Object.prototype.hasOwnProperty.call(payloadShape, "location_hint")
        ? payloadShape.location_hint
        : String(row?.location_hint || "").trim(),
      consent_required: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "consent_required"
      )
        ? payloadShape.consent_required === true
        : row?.consent_required === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressConsentMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_consent_reconciliation",
    target_scope: "destination_wordpress_consent_surface",
    payload: {
      consent_key: Object.prototype.hasOwnProperty.call(payloadShape, "consent_key")
        ? payloadShape.consent_key
        : String(row?.consent_key || "").trim(),
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      region_scope: Object.prototype.hasOwnProperty.call(payloadShape, "region_scope")
        ? payloadShape.region_scope
        : String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "blocks_tracking_before_consent"
      )
        ? payloadShape.blocks_tracking_before_consent === true
        : row?.blocks_tracking_before_consent === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

function buildWordpressPhaseHMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      tracking_composed_payloads: [],
      consent_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_h_mutation_candidates_not_ready"]
    };
  }

  const selectedTrackingCandidates = Array.isArray(selector.selected_tracking_candidates)
    ? selector.selected_tracking_candidates
    : [];
  const selectedConsentCandidates = Array.isArray(selector.selected_consent_candidates)
    ? selector.selected_consent_candidates
    : [];

  const trackingComposedPayloads = selectedTrackingCandidates.map(row => ({
    entity_type: "tracking_surface",
    tracking_key: String(row?.tracking_key || "").trim(),
    tracking_id: String(row?.tracking_id || "").trim(),
    implementation_mode: String(row?.implementation_mode || "").trim(),
    location_hint: String(row?.location_hint || "").trim(),
    tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
    payload_reason: "composed_from_safe_tracking_candidate",
    mutation_payload: buildWordpressTrackingMutationPayloadFromCandidate(row)
  }));

  const consentComposedPayloads = selectedConsentCandidates.map(row => ({
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    payload_reason: "composed_from_safe_consent_candidate",
    mutation_payload: buildWordpressConsentMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: trackingComposedPayloads.length + consentComposedPayloads.length,
    tracking_composed_payloads: trackingComposedPayloads,
    consent_composed_payloads: consentComposedPayloads,
    blocking_reasons: []
  };
}

function buildWordpressPhaseHMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_h_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    tracking_composed_payloads: Array.isArray(composer.tracking_composed_payloads)
      ? composer.tracking_composed_payloads
      : [],
    consent_composed_payloads: Array.isArray(composer.consent_composed_payloads)
      ? composer.consent_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

async function runHybridWordpressMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  return {
    ok: true,
    transport: "hybrid_wordpress",
    message: "Hybrid WordPress migration plan prepared.",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "hybrid_wordpress"),
    runtime_delta: {},
    settings_delta: {},
    plugin_delta: {}
  };
}

const siteMigrationTransports = {
  wordpress_connector: runWordpressConnectorMigration,
  ssh_wpcli: runSshWpCliMigration,
  hybrid_wordpress: runHybridWordpressMigration
};


async function validateSiteMigrationRouteWorkflowReadiness() {
  try {
    const validation = await ensureSiteMigrationRouteWorkflowRows();
    const missingRouteKeys = validation.missing_task_keys || [];
    const missingWorkflowIds = validation.missing_workflow_ids || [];

    return {
      ok:
        !!validation.task_routes_ready &&
        !!validation.workflow_registry_ready &&
        String(validation.outcome || "").trim() === "reuse_existing",
      mode: validation.mode || "validate_only",
      outcome: validation.outcome || "pending_validation",
      review: validation.review || null,
      task_routes_schema: validation.task_routes_schema || "surface_metadata_or_fallback",
      workflow_registry_schema: validation.workflow_registry_schema || "surface_metadata_or_fallback",
      active_route_keys: validation.executable_task_keys || [],
      active_workflow_keys: validation.executable_workflow_ids || [],
      missing_route_keys: missingRouteKeys,
      missing_workflow_keys: missingWorkflowIds,
      missing_task_keys: missingRouteKeys,
      missing_workflow_ids: missingWorkflowIds,
      unresolved_task_authority: validation.unresolved_task_authority || [],
      unresolved_workflow_authority: validation.unresolved_workflow_authority || [],
      chain_review_required: !!validation.chain_review_required,
      graph_review_required: !!validation.graph_review_required,
      bindings_review_required: !!validation.bindings_review_required,
      reconciliation_required: !!validation.reconciliation_required
    };
  } catch (err) {
    if (String(err?.code || "").trim() === "sheet_schema_mismatch") {
      return {
        ok: false,
        mode: "validate_only",
        outcome: "blocked_schema_mismatch",
        review: null,
        blocked: true,
        degraded: true,
        task_routes_schema: "surface_metadata_or_fallback",
        workflow_registry_schema: "surface_metadata_or_fallback",
        active_route_keys: [],
        active_workflow_keys: [],
        missing_route_keys: [],
        missing_workflow_keys: [],
        missing_task_keys: [],
        missing_workflow_ids: [],
        unresolved_task_authority: [],
        unresolved_workflow_authority: [],
        chain_review_required: false,
        graph_review_required: false,
        bindings_review_required: false,
        reconciliation_required: false,
        schema_validation_error: {
          code: String(err?.code || "sheet_schema_mismatch"),
          message: String(err?.message || "Sheet schema metadata validation failed."),
          details: err?.details || {}
        }
      };
    }
    throw err;
  }
}

async function executeSiteMigrationJob(job) {
  const payload = normalizeSiteMigrationPayload(job.request_payload || {});
  const validation = validateSiteMigrationPayload(payload);
  if (!validation.ok) {
    return {
      success: false,
      statusCode: 400,
      payload: {
        ok: false,
        error: {
          code: "invalid_site_migration_request",
          message: "Invalid site migration payload.",
          details: { errors: validation.errors }
        }
      }
    };
  }

  try {
    const routeWorkflowReadiness = await validateSiteMigrationRouteWorkflowReadiness();
    if (!routeWorkflowReadiness.ok) {
      return {
        success: false,
        statusCode: 409,
        payload: {
          ok: false,
          error: {
            code: "site_migration_route_workflow_not_ready",
            message: "Required site migration route/workflow governed keys are missing or schema validation is degraded.",
            details: routeWorkflowReadiness
          }
        }
      };
    }

    const awareness = await resolveWordpressSiteAwarenessContext(payload);
    awareness.source.runtime = await resolveWordpressRuntimeInventory(payload, awareness.source);
    awareness.destination.runtime = await resolveWordpressRuntimeInventory(payload, awareness.destination);
    awareness.source.settings = await resolveWordpressSettingsInventory(payload, awareness.source);
    awareness.destination.settings = await resolveWordpressSettingsInventory(payload, awareness.destination);
    awareness.source.plugins = await resolveWordpressPluginInventory(payload, awareness.source);
    awareness.destination.plugins = await resolveWordpressPluginInventory(payload, awareness.destination);
    awareness.requested_plugin_keys = payload?.migration?.plugin_keys || [];

    awareness.capability_state = classifyWordpressCapabilityState(awareness);
    awareness.impact = classifyWordpressMigrationImpact(awareness, payload);

    const transport = resolveMigrationTransport(payload, awareness);
    if (transport === "unsupported") {
      return {
        success: false,
        statusCode: 409,
        payload: {
          ok: false,
          error: {
            code: "unsupported_migration_transport",
            message: "No safe migration transport could be resolved.",
            details: {
              blocking_reasons: awareness.capability_state.blocking_reasons,
              degraded_reasons: awareness.capability_state.degraded_reasons
            }
          }
        }
      };
    }

    awareness.transport = transport;
    const mutationPlan = buildWordpressMutationPlan(awareness, payload);
    const writebackPlan = buildRegistryDeltaWritebackPlan(awareness, awareness.impact);

    const runner = siteMigrationTransports[transport];
    if (!runner) {
      throw createHttpError(
        "missing_migration_runner",
        `Migration runner not found for ${transport}.`,
        500
      );
    }

    const runnerResult = await runner({
      job,
      payload,
      wpContext: awareness,
      mutationPlan,
      writebackPlan
    });

    const effectiveWritebackPlan =
      runnerResult &&
      typeof runnerResult === "object" &&
      runnerResult.writeback_plan &&
      typeof runnerResult.writeback_plan === "object"
        ? runnerResult.writeback_plan
        : writebackPlan;

    const readback = await verifyRegistryDeltaReadback({
      writeback_plan: effectiveWritebackPlan
    });

    return {
      success: true,
      statusCode: 200,
      payload: {
        ok: true,
        job_type: "site_migration",
        transport,
        source: payload.source,
        destination: payload.destination,
        capability_state: awareness.capability_state,
        impact: awareness.impact,
        mutation_plan: mutationPlan,
        writeback_plan: effectiveWritebackPlan,
        readback,
        result: runnerResult
      }
    };
  } catch (err) {
    return {
      success: false,
      statusCode: Number(err?.status || 500),
      payload: {
        ok: false,
        error: {
          code: String(err?.code || "site_migration_failed"),
          message: String(err?.message || "Site migration execution failed."),
          details: err?.details || {}
        }
      }
    };
  }
}

function createSiteMigrationJobRecord({ payload, requestedBy, executionTraceId, maxAttempts, webhookUrl, callbackSecret, idempotencyKey }) {
  const createdAt = nowIso();
  return {
    job_id: buildJobId(),
    job_type: "site_migration",
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key: String(payload?.destination?.target_key || payload?.source?.target_key || "").trim(),
    parent_action_key: "site_migration_controller",
    endpoint_key: "site_migrate",
    route_id: "site_migration",
    target_module: "wordpress_site_migration",
    target_workflow: "wf_wordpress_site_migration",
    brand_name: String(payload?.destination?.brand || payload?.source?.brand || "").trim(),
    execution_trace_id: executionTraceId,
    request_payload: payload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(maxAttempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(webhookUrl),
    callback_secret: String(callbackSecret || "").trim(),
    idempotency_key: String(idempotencyKey || "").trim()
  };
}

async function executeQueuedJobByType(job) {
  const jobType = String(job?.job_type || "http_execute").trim();
  if (jobType === "site_migration") {
    return await executeSiteMigrationJob(job);
  }
  return await executeJobThroughHttpEndpoint(job);
}

function getJob(jobId) {
  const id = normalizeJobId(jobId);
  return id ? jobRepository.get(id) : null;
}

function updateJob(job, patch = {}) {
  Object.assign(job, patch);
  job.updated_at = nowIso();
  jobRepository.set(job);
  return job;
}

function toJobSummary(job) {
  return {
    job_id: job.job_id,
    job_type: job.job_type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    requested_by: job.requested_by,
    target_key: job.target_key,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key,
    route_id: job.route_id || "",
    target_module: job.target_module || "",
    target_workflow: job.target_workflow || "",
    brand_name: job.brand_name || "",
    execution_trace_id: job.execution_trace_id || "",
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    next_retry_at: job.next_retry_at || null,
    status_url: `/jobs/${job.job_id}`,
    result_url: `/jobs/${job.job_id}/result`
  };
}

function buildWebhookPayload(job) {
  return {
    job_id: job.job_id,
    execution_trace_id: job.execution_trace_id || "",
    status: job.status,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at || null,
    result: job.result_payload || null,
    error: job.error_payload || null
  };
}

async function sendJobWebhook(job) {
  const webhookUrl = normalizeWebhookUrl(job.webhook_url || "");
  if (!webhookUrl) return;

  const payloadObj = buildWebhookPayload(job);
  const payload = JSON.stringify(payloadObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = String(job.callback_secret || "").trim();
  const signature = secret
    ? crypto.createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex")
    : "";

  const headers = {
    "Content-Type": "application/json",
    "X-Job-Id": job.job_id,
    "X-Job-Status": job.status,
    "X-Job-Timestamp": timestamp
  };
  if (signature) headers["X-Signature"] = signature;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal
    });

    if (!response.ok) {
      debugLog("JOB_WEBHOOK_FAILED:", {
        job_id: job.job_id,
        webhook_url: webhookUrl,
        status: response.status
      });
      return;
    }

    debugLog("JOB_WEBHOOK_SENT:", {
      job_id: job.job_id,
      webhook_url: webhookUrl,
      status: response.status
    });
  } catch (err) {
    debugLog("JOB_WEBHOOK_FAILED:", {
      job_id: job.job_id,
      webhook_url: webhookUrl,
      message: err?.message || String(err)
    });
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryJobFailure(statusCode, payload) {
  const code = String(payload?.error?.code || "").trim().toLowerCase();

  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  if (code.includes("timeout")) return true;
  if (code === "worker_transport_error") return true;
  return false;
}

async function executeSameServiceNativeEndpoint({
  method,
  path: relativePath,
  body,
  timeoutSeconds,
  expectJson = true
}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (process.env.BACKEND_API_KEY) {
    headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;
  }

  const boundedTimeoutSeconds = Math.min(
    Number(timeoutSeconds || MAX_TIMEOUT_SECONDS),
    MAX_TIMEOUT_SECONDS
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(boundedTimeoutSeconds) && boundedTimeoutSeconds > 0
      ? boundedTimeoutSeconds
      : MAX_TIMEOUT_SECONDS) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}${relativePath}`, {
      method,
      headers,
      body:
        method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(body ?? {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed;

    if (!raw) {
      parsed = {};
    } else if (expectJson !== false) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          ok: false,
          error: {
            code: "upstream_unparseable_response",
            message: raw
          }
        };
      }
    } else {
      parsed = { ok: response.ok, raw };
    }

    return {
      success: response.ok && (parsed?.ok !== false),
      statusCode: response.status,
      payload: parsed
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: {
        ok: false,
        error: {
          code: aborted ? "worker_timeout" : "worker_transport_error",
          message: err?.message || String(err)
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchEndpointKeyExecution({ endpoint_key, requestPayload }) {
  switch (String(endpoint_key || "").trim()) {
    case "hostinger_ssh_runtime_read": {
      return await hostingerSshRuntimeRead({
        input: requestPayload || {}
      });
    }
    case "github_git_blob_chunk_read": {
      return await githubGitBlobChunkRead({
        input: requestPayload || {}
      });
    }
    default:
      return null;
  }
}

function inferLocalDispatchHttpStatus(result = {}) {
  const explicit = Number(result?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) {
    return explicit;
  }

  const code = String(result?.error?.code || "").trim().toLowerCase();
  if (code === "range_not_satisfiable") return 416;
  if (code === "github_blob_not_found") return 404;
  if (code === "missing_github_token") return 500;
  if (code === "github_blob_fetch_failed") return 502;
  if (code === "github_blob_encoding_unsupported") return 502;

  return result?.ok ? 200 : 400;
}

async function executeJobThroughHttpEndpoint(job) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (process.env.BACKEND_API_KEY) {
    headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;
  }

  const timeoutSeconds = Math.min(
    Number(job.request_payload?.timeout_seconds || 300),
    MAX_TIMEOUT_SECONDS
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 300) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}/http-execute`, {
      method: "POST",
      headers,
      body: JSON.stringify(job.request_payload || {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          ok: false,
          error: {
            code: "upstream_unparseable_response",
            message: raw
          }
        };
      }
    }

    const success = response.ok && parsed?.ok === true;
    return {
      success,
      statusCode: response.status,
      payload: parsed
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: {
        ok: false,
        error: {
          code: aborted ? "worker_timeout" : "worker_transport_error",
          message: err?.message || String(err)
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function enqueueJob(jobId) {
  queueRepository.push(jobId);
  void processQueuedJobs();
}

function scheduleJobRetry(job, delayMs) {
  updateJob(job, {
    status: "retrying",
    next_retry_at: new Date(Date.now() + delayMs).toISOString()
  });

  debugLog("JOB_RETRY_SCHEDULED:", {
    job_id: job.job_id,
    delay_ms: delayMs,
    attempt_count: job.attempt_count,
    next_retry_at: job.next_retry_at
  });

  const timer = setTimeout(() => {
    const current = getJob(job.job_id);
    if (!current) return;
    if (normalizeJobStatus(current.status) !== "retrying") return;

    updateJob(current, {
      status: "queued",
      next_retry_at: ""
    });
    enqueueJob(current.job_id);
  }, delayMs);

  if (typeof timer?.unref === "function") timer.unref();
}

async function executeSingleQueuedJob(job) {
  if (normalizeJobStatus(job.status) !== "queued") return;
  const queuedExecutionStartedAt = nowIso();
  const execution_trace_id =
    String(job.execution_trace_id || "").trim() || createExecutionTraceId();

  updateJob(job, {
    execution_trace_id,
    status: "running",
    attempt_count: Number(job.attempt_count || 0) + 1,
    next_retry_at: ""
  });

  debugLog("JOB_EXECUTION_STARTED:", {
    job_id: job.job_id,
    attempt_count: job.attempt_count,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key
  });

  const outcome = await executeQueuedJobByType(job);
  const success = outcome.success === true;

  if (success) {
    updateJob(job, {
      status: "succeeded",
      result_payload: outcome.payload || null,
      error_payload: null,
      completed_at: nowIso()
    });

    await performUniversalServerWriteback({
      mode: "async",
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      source_layer: "http_client_backend",
      entry_type: "async_job",
      execution_class: "async",
      attempt_count: job.attempt_count,
      status_source: job.status,
      responseBody: job.result_payload,
      error_code: job.result_payload?.error?.code,
      error_message_short: job.result_payload?.error?.message,
      http_status: outcome.statusCode,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: queuedExecutionStartedAt
    });

    await sendJobWebhook(job);
    return;
  }

  updateJob(job, {
    result_payload: null,
    error_payload: outcome.payload || {
      ok: false,
      error: {
        code: "job_execution_failed",
        message: "Background execution failed."
      }
    }
  });

  const retryable = shouldRetryJobFailure(outcome.statusCode, job.error_payload);
  const canRetry = retryable && Number(job.attempt_count || 0) < Number(job.max_attempts || 1);

  if (canRetry) {
    await logRetryWriteback({
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      attempt_count: job.attempt_count,
      responseBody: job.error_payload,
      error_code: job.error_payload?.error?.code,
      error_message_short: job.error_payload?.error?.message,
      http_status: outcome.statusCode,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: queuedExecutionStartedAt
    });
    scheduleJobRetry(job, nextRetryDelayMs(job.attempt_count));
    return;
  }

  updateJob(job, {
    status: "failed",
    completed_at: nowIso()
  });

  await performUniversalServerWriteback({
    mode: "async",
    job_id: job.job_id,
    target_key: job.target_key,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key,
    route_id: job.route_id,
    target_module: job.target_module,
    target_workflow: job.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "async_job",
    execution_class: "async",
    attempt_count: job.attempt_count,
    status_source: job.status,
    responseBody: job.error_payload,
    error_code: job.error_payload?.error?.code,
    error_message_short: job.error_payload?.error?.message,
    http_status: outcome.statusCode,
    brand_name: job.brand_name,
    execution_trace_id,
    started_at: queuedExecutionStartedAt
  });

  await sendJobWebhook(job);
}

async function processQueuedJobs() {
  await loadJobStateFromDisk();
  if (jobWorkerActive) return;
  jobWorkerActive = true;

  try {
    while (queueRepository.size()) {
      const jobId = queueRepository.shift();
      const job = getJob(jobId);
      if (!job) continue;
      try {
        await executeSingleQueuedJob(job);
      } catch (err) {
        console.error("JOB_EXECUTION_LOOP_ERROR:", {
          job_id: job.job_id,
          message: err?.message || String(err)
        });
      }
    }
  } finally {
    jobWorkerActive = false;
    await forceJobStateFlush();
  }
}

const jobWorkerTicker = setInterval(() => {
  void processQueuedJobs();
}, JOB_QUEUE_TICK_MS);
if (typeof jobWorkerTicker?.unref === "function") jobWorkerTicker.unref();

app.get("/health", async (_req, res) => {
  await loadJobStateFromDisk();

  const counts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    cancelled: 0
  };
  for (const job of jobRepository.values()) {
    const status = normalizeJobStatus(job.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }

  res.json({
    ok: true,
    service: "http_generic_api_connector",
    status: "healthy",
    version: SERVICE_VERSION,
    jobs: {
      total: jobRepository.size(),
      queued_buffer_size: queueRepository.size(),
      statuses: counts
    },
    timestamp: new Date().toISOString()
  });
});

app.post("/hostinger/ssh-runtime-read", requireBackendApiKey, async (req, res) => {
  try {
    const result = await hostingerSshRuntimeRead({
      input: req.body || {}
    });

    return res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: {
        code: err.code || "hostinger_ssh_runtime_read_failed",
        message: err.message || "Hostinger SSH runtime read failed."
      }
    });
  }
});

app.post("/governed-addition/review", requireBackendApiKey, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = buildGovernedAdditionReviewResult({
      outcome: body.outcome || "pending_validation",
      addition_state: body.addition_state || "pending_validation",
      route_overlap_detected: body.route_overlap_detected,
      workflow_overlap_detected: body.workflow_overlap_detected,
      chain_needed: body.chain_needed,
      graph_update_required: body.graph_update_required,
      bindings_update_required: body.bindings_update_required,
      policy_update_required: body.policy_update_required,
      starter_update_required: body.starter_update_required,
      reconciliation_required: body.reconciliation_required
    });

    return res.status(200).json({
      ok: true,
      review: result
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: {
        code: err.code || "governed_addition_review_failed",
        message: err.message || "Governed addition review failed."
      }
    });
  }
});



app.post("/site-migration/bootstrap-registry", requireBackendApiKey, async (_req, res) => {
  await loadJobStateFromDisk();

  try {
    requireEnv("REGISTRY_SPREADSHEET_ID");

    const surfaces = await ensureSiteMigrationRegistrySurfaces();
    const rowResults = await ensureSiteMigrationRouteWorkflowRows();
    const readiness = {
      ok:
        !!rowResults.task_routes_ready &&
        !!rowResults.workflow_registry_ready &&
        String(rowResults.outcome || "").trim() === "reuse_existing",
      ...rowResults
    };

    if (!readiness.ok) {
      return res.status(409).json({
        ok: false,
        degraded: true,
        message: "Validation-only check complete: registry schemas are metadata-governed, but route/workflow readiness remains pending validation or degraded by dependencies.",
        surfaces,
        row_results: rowResults,
        readiness
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Validation-only check complete: site migration registry surfaces and live route/workflow authority are ready.",
      surfaces,
      row_results: rowResults,
      readiness
    });
  } catch (err) {
    if (String(err?.code || "").trim() === "sheet_schema_mismatch") {
      return res.status(409).json({
        ok: false,
        degraded: true,
        blocked: true,
        message: "Validation-only check failed: metadata-governed surface schema mismatch detected.",
        error: {
          code: err?.code || "sheet_schema_mismatch",
          message: err?.message || "Registry bootstrap surface schema validation failed.",
          details: err?.details || {}
        }
      });
    }
    return res.status(err?.status || 500).json({
      ok: false,
      error: {
        code: err?.code || "registry_bootstrap_failed",
        message: err?.message || "Registry bootstrap failed."
      }
    });
  }
});

app.post("/site-migrate", requireBackendApiKey, async (req, res) => {
  await loadJobStateFromDisk();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const payload = normalizeSiteMigrationPayload(body);
  const validation = validateSiteMigrationPayload(payload);

  if (validation.errors.length) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_site_migration_request",
        message: "Invalid site migration payload.",
        details: { errors: validation.errors }
      }
    });
  }

  const requestedBy = resolveRequestedBy(req);
  const idempotencyKey = String(
    body.idempotency_key || req.header("Idempotency-Key") || ""
  ).trim();
  const idempotencyLookupKey = makeIdempotencyLookupKey(
    requestedBy,
    idempotencyKey
  );

  if (idempotencyLookupKey && idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId);
    if (existingJob) {
      return res.status(200).json({
        ...toJobSummary(existingJob),
        deduplicated: true
      });
    }
    idempotencyRepository.delete(idempotencyLookupKey);
  }

  const execution_trace_id =
    String(body.execution_trace_id || "").trim() || createExecutionTraceId();

  const job = createSiteMigrationJobRecord({
    payload: {
      ...payload,
      execution_trace_id
    },
    requestedBy,
    executionTraceId: execution_trace_id,
    maxAttempts: body.max_attempts,
    webhookUrl: body.webhook_url,
    callbackSecret: body.callback_secret,
    idempotencyKey
  });

  jobRepository.set(job);
  if (idempotencyLookupKey) {
    idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  enqueueJob(job.job_id);

  return res.status(202).json({
    ...toJobSummary(job),
    route: "/site-migrate",
    execution_class: "migration"
  });
});

app.post("/jobs", requireBackendApiKey, async (req, res) => {
  await loadJobStateFromDisk();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const hasNestedRequestPayload =
    body.request_payload &&
    typeof body.request_payload === "object" &&
    !Array.isArray(body.request_payload);

  const topLevelExecutionFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path",
    "path_params",
    "query",
    "headers",
    "body",
    "expect_json",
    "timeout_seconds",
    "readback",
    "force_refresh"
  ];

  const hasTopLevelExecutionFields = topLevelExecutionFields.some(
    key => body[key] !== undefined
  );

  if (hasNestedRequestPayload && hasTopLevelExecutionFields) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_job_request",
        message: "Job request is invalid.",
        details: {
          errors: [
            "Provide either request_payload or top-level execution fields, not both."
          ]
        }
      }
    });
  }

  const requestPayload = buildExecutionPayloadFromJobRequest(body);
  const requestedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const validationErrors =
    requestedJobType === "site_migration"
      ? validateSiteMigrationPayload(normalizeSiteMigrationPayload(requestPayload)).errors
      : validateAsyncJobRequest(requestPayload);

  if (body.max_attempts !== undefined) {
    const maxAttempts = Number(body.max_attempts);
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      validationErrors.push("max_attempts must be an integer between 1 and 10 when provided.");
    }
  }

  if (body.webhook_url !== undefined) {
    const normalizedWebhookUrl = normalizeWebhookUrl(body.webhook_url);
    if (String(body.webhook_url || "").trim() && !normalizedWebhookUrl) {
      validationErrors.push("webhook_url must be a valid http or https URL when provided.");
    }
  }

  if (body.callback_secret !== undefined && typeof body.callback_secret !== "string") {
    validationErrors.push("callback_secret must be a string when provided.");
  }

  if (body.idempotency_key !== undefined && typeof body.idempotency_key !== "string") {
    validationErrors.push("idempotency_key must be a string when provided.");
  }

  if (body.job_type !== undefined && typeof body.job_type !== "string") {
    validationErrors.push("job_type must be a string when provided.");
  }

  if (validationErrors.length) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_job_request",
        message: "Job request is invalid.",
        details: { errors: validationErrors }
      }
    });
  }

  const requestedBy = resolveRequestedBy(req);
  const idempotencyKey = String(
    body.idempotency_key || req.header("Idempotency-Key") || ""
  ).trim();
  const idempotencyLookupKey = makeIdempotencyLookupKey(
    requestedBy,
    idempotencyKey
  );

  if (idempotencyLookupKey && idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId);
    if (existingJob) {
      return res.status(200).json({
        ...toJobSummary(existingJob),
        deduplicated: true
      });
    }
    idempotencyRepository.delete(idempotencyLookupKey);
  }

  const createdAt = nowIso();
  const inboundExecutionTraceId = String(
    requestPayload.execution_trace_id || body.execution_trace_id || ""
  ).trim();
  const execution_trace_id = inboundExecutionTraceId || createExecutionTraceId();
  requestPayload.execution_trace_id = execution_trace_id;
  const normalizedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const normalizedSiteMigrationPayload =
    normalizedJobType === "site_migration"
      ? normalizeSiteMigrationPayload(requestPayload)
      : null;

  const job = {
    job_id: buildJobId(),
    job_type: normalizedJobType,
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.target_key ||
              normalizedSiteMigrationPayload?.source?.target_key ||
              ""
          ).trim()
        : String(requestPayload.target_key || "").trim(),
    parent_action_key:
      normalizedJobType === "site_migration"
        ? "site_migration_controller"
        : String(requestPayload.parent_action_key || "").trim(),
    endpoint_key:
      normalizedJobType === "site_migration"
        ? "site_migrate"
        : String(requestPayload.endpoint_key || "").trim(),
    route_id:
      normalizedJobType === "site_migration"
        ? "site_migration"
        : String(requestPayload.route_id || "").trim(),
    target_module:
      normalizedJobType === "site_migration"
        ? "wordpress_site_migration"
        : String(requestPayload.target_module || "").trim(),
    target_workflow:
      normalizedJobType === "site_migration"
        ? "wf_wordpress_site_migration"
        : String(requestPayload.target_workflow || "").trim(),
    brand_name:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.brand ||
              normalizedSiteMigrationPayload?.source?.brand ||
              ""
          ).trim()
        : String(requestPayload.brand_name || requestPayload.brand || "").trim(),
    execution_trace_id,
    request_payload: normalizedJobType === "site_migration" ? normalizedSiteMigrationPayload : requestPayload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(body.max_attempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(body.webhook_url),
    callback_secret: String(body.callback_secret || "").trim(),
    idempotency_key: idempotencyKey
  };

  jobRepository.set(job);
  if (idempotencyLookupKey) {
    idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  debugLog("JOB_CREATED:", {
    job_id: job.job_id,
    requested_by: job.requested_by,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key
  });

  enqueueJob(job.job_id);

  return res.status(202).json(toJobSummary(job));
});

app.get("/jobs/:jobId", requireBackendApiKey, async (req, res) => {
  await loadJobStateFromDisk();
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      ok: false,
      error: {
        code: "job_not_found",
        message: "Job not found."
      }
    });
  }

  const summary = toJobSummary(job);
  return res.status(200).json({
    ...summary,
    terminal: TERMINAL_JOB_STATUSES.has(normalizeJobStatus(job.status)),
    active: ACTIVE_JOB_STATUSES.has(normalizeJobStatus(job.status))
  });
});

app.get("/jobs/:jobId/result", requireBackendApiKey, async (req, res) => {
  try {
    await loadJobStateFromDisk();
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "job_not_found",
          message: "Job not found."
        }
      });
    }

    const poll_started_at = nowIso();
    const execution_trace_id =
      String(job.execution_trace_id || "").trim() || createExecutionTraceId();
    if (job.execution_trace_id !== execution_trace_id) {
      updateJob(job, { execution_trace_id });
    }

    const status = normalizeJobStatus(job.status);
    if (status === "succeeded") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        result: job.result_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.result_payload,
        error_code: job.result_payload?.error?.code,
        error_message_short: job.result_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return res.status(200).json(responsePayload);
    }

    if (status === "failed" || status === "cancelled") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        error: job.error_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.error_payload,
        error_code: job.error_payload?.error?.code,
        error_message_short: job.error_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return res.status(200).json(responsePayload);
    }

    const pendingPayload = {
      job_id: job.job_id,
      status: job.status,
      message: "Job is not complete yet.",
      status_url: `/jobs/${job.job_id}`
    };

    await performUniversalServerWriteback({
      mode: "poll",
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      source_layer: "http_client_backend",
      entry_type: "poll_read",
      execution_class: "poll",
      attempt_count: job.attempt_count,
      status_source: status,
      responseBody: pendingPayload,
      error_code: "",
      error_message_short: "",
      http_status: 202,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: poll_started_at
    });

    return res.status(202).json(pendingPayload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: {
        code: "poll_read_failed",
        message: err?.message || "Poll read failed."
      }
    });
  }
});

app.post("/http-execute", requireBackendApiKey, async (req, res) => {
  await loadJobStateFromDisk();
  let requestPayload = null;
  let action = null;
  let endpoint = null;
  let brand = null;
  const sync_execution_started_at = nowIso();
  let execution_trace_id =
    String(req.body?.execution_trace_id || "").trim() || createExecutionTraceId();

  try {
    requireEnv("REGISTRY_SPREADSHEET_ID");

    const originalPayload = req.body || {};
    const originalPayloadPromoted =
      promoteDelegatedExecutionPayload(originalPayload);

    const normalized = normalizeExecutionPayload(originalPayloadPromoted);
    const normalizedPromoted =
      promoteDelegatedExecutionPayload(normalized);
    const normalizedAssetHomeValidation = validateAssetHomePayloadRules(normalizedPromoted);
    if (!normalizedAssetHomeValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "normalized_asset_home_validation_failed",
          message: "Normalized asset home validation failed.",
          details: normalizedAssetHomeValidation.errors
        }
      });
    }
    assertHostingerTargetTier(normalizedPromoted);

    const payloadIntegrity = validatePayloadIntegrity(
      normalizeTopLevelRoutingFields(originalPayloadPromoted),
      normalizeTopLevelRoutingFields(normalizedPromoted)
    );
    if (!payloadIntegrity.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "payload_integrity_violation",
          message: "Normalized payload does not preserve required top-level routing fields.",
          details: {
            mismatches: payloadIntegrity.mismatches
          }
        },
        execution_guardrail: true
      });
    }

    // FORCE canonical payload for all downstream logic
    requestPayload = normalizedPromoted;
    execution_trace_id =
      String(requestPayload.execution_trace_id || execution_trace_id || "").trim() ||
      createExecutionTraceId();
    requestPayload.execution_trace_id = execution_trace_id;
    debugLog("IS_DELEGATED_HTTP_EXECUTE_WRAPPER:", isDelegatedHttpExecuteWrapper(requestPayload));
    debugLog("PROMOTED_ROUTING_FIELDS:", JSON.stringify({
      target_key: requestPayload.target_key || "",
      brand: requestPayload.brand || "",
      brand_domain: requestPayload.brand_domain || ""
    }));
    debugLog("PROMOTED_EXECUTION_TARGET:", JSON.stringify({
      provider_domain: requestPayload.provider_domain || "",
      parent_action_key: requestPayload.parent_action_key || "",
      endpoint_key: requestPayload.endpoint_key || "",
      method: requestPayload.method || "",
      path: requestPayload.path || ""
    }));
    const provider_domain = requestPayload.provider_domain;
    const parent_action_key = requestPayload.parent_action_key;
    const endpoint_key = requestPayload.endpoint_key;

    if (!parent_action_key || !endpoint_key) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "invalid_request",
          message: "parent_action_key and endpoint_key are required."
        }
      });
    }

    const forceRefresh = requestPayload.force_refresh === true || String(requestPayload.force_refresh || "").toLowerCase() === "true";
    if (forceRefresh) {
      debugLog("REGISTRY_FORCE_REFRESH:", true);
    }
    const { drive, brandRows, hostingAccounts, actionRows, endpointRows, policies } = forceRefresh
      ? await reloadRegistry()
      : await getRegistry();

    const requiredHttpExecutionPolicyKeys =
      getRequiredHttpExecutionPolicyKeys(policies);

    const requiredHttpExecutionPolicyCheck =
      requirePolicySet(
        policies,
        "HTTP Execution Governance",
        requiredHttpExecutionPolicyKeys
      );

    if (!requiredHttpExecutionPolicyCheck.ok) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "missing_required_http_execution_policy",
          message: "Required HTTP Execution Governance policies are not fully enabled.",
          details: {
            policy_group: "HTTP Execution Governance",
            missing_keys: requiredHttpExecutionPolicyCheck.missing,
            handling: String(
              policyValue(
                policies,
                "HTTP Execution Governance",
                "Missing Required Policy Handling",
                "BLOCK"
              )
            ).trim()
          }
        },
        execution_guardrail: true,
        repair_action: "restore_required_http_execution_governance_rows",
        execution_trace_id
      });
    }

    const topLevelRoutingValidation = validateTopLevelRoutingFields(requestPayload, policies);
    if (!topLevelRoutingValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "top_level_routing_schema_violation",
          message: "Top-level routing fields failed validation.",
          details: {
            errors: topLevelRoutingValidation.errors
          }
        },
        execution_guardrail: true
      });
    }
    const assetHomeValidation = validateAssetHomePayloadRules(requestPayload);

    if (!assetHomeValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "asset_home_validation_failed",
          message: "Asset home validation failed.",
          details: assetHomeValidation.errors
        }
      });
    }

    const callerHeaders = sanitizeCallerHeaders(requestPayload.headers || {});
    const query = requestPayload.query && typeof requestPayload.query === "object"
      ? { ...requestPayload.query }
      : {};
    const body = requestPayload.body;
    const pathParams = requestPayload.path_params || {};
    debugLog("NORMALIZED_TOP_LEVEL_ROUTING_FIELDS:", JSON.stringify({
      provider_domain: requestPayload.provider_domain || "",
      parent_action_key: requestPayload.parent_action_key || "",
      endpoint_key: requestPayload.endpoint_key || "",
      method: requestPayload.method || "",
      path: requestPayload.path || "",
      target_key: requestPayload.target_key || "",
      brand: requestPayload.brand || "",
      brand_domain: requestPayload.brand_domain || ""
    }));

    debugLog("FINAL_EXECUTION_PARENT_ACTION_KEY:", parent_action_key);
    debugLog("FINAL_EXECUTION_ENDPOINT_KEY:", endpoint_key);
    action = resolveAction(actionRows, parent_action_key);
    debugLog("RESOLVED_ACTION_OBJECT:", JSON.stringify(action));
    endpoint = resolveEndpoint(endpointRows, parent_action_key, endpoint_key);

    debugLog(
      "PRE_GUARD_ENDPOINT_OBJECT:",
      JSON.stringify(getEndpointExecutionSnapshot(endpoint))
    );

    brand = resolveBrand(brandRows, requestPayload);

    debugLog(
      "PRE_GUARD_ACTION_RUNTIME:",
      JSON.stringify({
        action_key: action.action_key,
        runtime_capability_class: action.runtime_capability_class,
        runtime_callable: action.runtime_callable,
        primary_executor: action.primary_executor,
        oauth_config_file_id: action.oauth_config_file_id || ""
      })
    );

    requireRuntimeCallableAction(policies, action, endpoint);

    const endpointEligibility =
      requireEndpointExecutionEligibility(policies, endpoint);

    requireExecutionModeCompatibility(action, endpoint);
    requireNativeFamilyBoundary(policies, action, endpoint);
    requireTransportIfDelegated(policies, action, endpoint);
    requireNoFallbackDirectExecution(policies, endpoint);

    debugLog(
      "POST_GUARD_ENDPOINT_ELIGIBILITY:",
      JSON.stringify(endpointEligibility)
    );

    const allowedTransport = String(
      process.env.HTTP_ALLOWED_TRANSPORT ||
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allowed Transport",
        "http_generic_api"
      )
    ).trim();

    const endpointExecutionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
    const endpointTransportActionKey = String(endpoint.transport_action_key || "").trim();
    const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
    const sameServiceNativeTarget =
      endpointExecutionMode === "native_controller" ||
      String(endpoint.provider_domain || "").trim() === "same_service_native";

    debugLog(
      "TRANSPORT_COMPATIBILITY_INPUT:",
      JSON.stringify({
        endpoint_key: endpoint.endpoint_key,
        endpoint_transport_action_key: endpointTransportActionKey,
        endpoint_execution_mode: String(endpoint.execution_mode || "").trim(),
        endpoint_transport_required_raw: endpoint.transport_required ?? "",
        endpoint_transport_required: boolFromSheet(endpoint.transport_required),
        delegated_transport_target: delegatedTransportTarget,
        same_service_native_target: sameServiceNativeTarget
      })
    );

    if (
      !sameServiceNativeTarget &&
      endpointTransportActionKey &&
      endpointTransportActionKey !== allowedTransport
    ) {
      const err = new Error(`Endpoint transport_action_key is not supported: ${endpointTransportActionKey}`);
      err.code = "unsupported_transport";
      err.status = 403;
      throw err;
    }

    if (
      !sameServiceNativeTarget &&
      boolFromSheet(endpoint.transport_required) &&
      endpointExecutionMode === "http_delegated" &&
      endpointTransportActionKey !== allowedTransport
    ) {
      const err = new Error(`Delegated transport endpoint is missing required allowed transport: ${endpoint.endpoint_key}`);
      err.code = "missing_required_transport";
      err.status = 403;
      throw err;
    }

    const resolvedMethodPath = ensureMethodAndPathMatchEndpoint(
      endpoint,
      requestPayload.method,
      requestPayload.path,
      pathParams
    );

    const dispatchedEndpointResult = await dispatchEndpointKeyExecution({
      endpoint_key,
      requestPayload
    });

    if (dispatchedEndpointResult) {
      const localDispatchStatusCode =
        inferLocalDispatchHttpStatus(dispatchedEndpointResult);

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key: parent_action_key,
        endpoint_key: endpoint_key,
        route_id: String(endpoint?.endpoint_id || "").trim(),
        target_module: String(endpoint?.module_binding || "").trim(),
        target_workflow: String(action?.action_key || "").trim(),
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: dispatchedEndpointResult.ok ? "succeeded" : "failed",
        responseBody: dispatchedEndpointResult,
        error_code: dispatchedEndpointResult?.error?.code || "",
        error_message_short: dispatchedEndpointResult?.error?.message || "",
        http_status: localDispatchStatusCode,
        brand_name: String(brand?.brand_name || requestPayload.brand || "").trim(),
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res
        .status(localDispatchStatusCode)
        .json(dispatchedEndpointResult);
    }

    if (sameServiceNativeTarget) {
      const nativeOutcome = await executeSameServiceNativeEndpoint({
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        body: requestPayload.body,
        timeoutSeconds: requestPayload.timeout_seconds,
        expectJson: requestPayload.expect_json
      });

      return res.status(nativeOutcome.statusCode).json(nativeOutcome.payload);
    }

    debugLog("REQUEST_PAYLOAD_TARGET_KEY:", requestPayload.target_key || "");
    debugLog("REQUEST_PAYLOAD_BRAND:", requestPayload.brand || "");
    debugLog("REQUEST_PAYLOAD_BRAND_DOMAIN:", requestPayload.brand_domain || "");
    const {
      providerDomain: resolvedProviderDomain,
      resolvedProviderDomainMode,
      placeholderResolutionSource
    } = resolveProviderDomain({
      requestedProviderDomain: provider_domain,
      endpoint,
      brand,
      parentActionKey: parent_action_key,
      policies,
      requestBody: requestPayload
    });
    debugLog("RESOLVED_PROVIDER_DOMAIN:", resolvedProviderDomain);
    debugLog("RESOLVED_PROVIDER_DOMAIN_MODE:", resolvedProviderDomainMode);
    debugLog("PLACEHOLDER_RESOLUTION_SOURCE:", placeholderResolutionSource);

    const requestBody = requestPayload;
    const resolvedTargetKey = String(
      requestPayload.target_key || brand?.target_key || ""
    ).trim();

    const authContract = normalizeAuthContract({
      action,
      brand,
      hostingAccounts,
      targetKey: requestBody.target_key || resolvedTargetKey || ""
    });
    if (String(action.action_key || "").trim() === "hostinger_api") {
      debugLog("HOSTINGER_BRAND_TARGET_KEY:", brand?.target_key || "");
      debugLog(
        "HOSTINGER_EFFECTIVE_ACCOUNT_KEY:",
        resolveAccountKey({
          brand,
          targetKey: requestBody.target_key || resolvedTargetKey || "",
          hostingAccounts
        })
      );
      debugLog("HOSTINGER_REQUEST_TARGET_KEY:", requestBody.target_key || resolvedTargetKey || "");
    }
    debugLog("INFERRED_AUTH_MODE:", authContract.mode);
    enforceSupportedAuthMode(policies, authContract.mode);

    if (authContract.mode === "oauth_gpt_action") {
      const handling = policyValue(
        policies,
        "HTTP Execution Governance",
        "OAuth GPT Action Transport Handling",
        "NATIVE_ONLY"
      );

      const allowDelegatedGoogleOAuth = String(
        policyValue(
          policies,
          "HTTP Google Auth",
          "Allow Delegated Google OAuth",
          "TRUE"
        )
      ).trim().toUpperCase() === "TRUE";

      const delegatedGoogleEndpoint =
        isDelegatedTransportTarget(endpoint) &&
        isGoogleApiHost(resolvedProviderDomain);

      if (!allowDelegatedGoogleOAuth || !delegatedGoogleEndpoint) {
        const err = new Error(
          `Resolved auth mode ${authContract.mode} must use governed native connector path (${handling}).`
        );
        err.code = "native_connector_required";
        err.status = 403;
        throw err;
      }

      try {
        authContract.mode = "bearer_token";
        authContract.header_name = "Authorization";
        authContract.secret = await mintGoogleAccessTokenForEndpoint({
          drive,
          policies,
          action,
          endpoint
        });
      } catch (err) {
        debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
          action_key: action.action_key,
          endpoint_key: endpoint.endpoint_key,
          provider_domain: resolvedProviderDomain,
          message: err?.message || String(err)
        });
        const authErr = new Error("Delegated Google OAuth token mint failed.");
        authErr.code = "auth_resolution_failed";
        authErr.status = err?.status || 500;
        throw authErr;
      }
    } else if (
      authContract.mode === "none" &&
      isDelegatedTransportTarget(endpoint) &&
      isGoogleApiHost(resolvedProviderDomain)
    ) {
      try {
        authContract.mode = "bearer_token";
        authContract.header_name = "Authorization";
        authContract.secret = await mintGoogleAccessTokenForEndpoint({
          drive,
          policies,
          action,
          endpoint
        });
      } catch (err) {
        debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
          action_key: action.action_key,
          endpoint_key: endpoint.endpoint_key,
          provider_domain: resolvedProviderDomain,
          message: err?.message || String(err)
        });
        const authErr = new Error("Delegated Google OAuth token mint failed.");
        authErr.code = "auth_resolution_failed";
        authErr.status = err?.status || 500;
        throw authErr;
      }
    }

    ensureWritePermissions(brand, resolvedMethodPath.method);

    const schemaContract = await fetchSchemaContract(drive, action.openai_schema_file_id);
    const schemaOperationInfo = resolveSchemaOperation(schemaContract, resolvedMethodPath.method, resolvedMethodPath.path);
    if (!schemaOperationInfo) {
      const err = new Error(`Method/path not found in authoritative schema for ${parent_action_key}.`);
      err.code = "schema_path_method_mismatch";
      err.status = 422;
      throw err;
    }

    debugLog("NORMALIZED_QUERY:", query);
    const schemaValidationInput = injectAuthForSchemaValidation(
      query,
      callerHeaders,
      authContract
    );

    const queryWithAuth = schemaValidationInput.query;
    const headersWithAuthForValidation = {
      ...schemaValidationInput.headers,
      ...getAdditionalStaticAuthHeaders(action, authContract)
    };

    const schemaValidationErrors = [
      ...validateParameters(schemaOperationInfo.operation, {
        query: queryWithAuth,
        headers: headersWithAuthForValidation,
        path_params: pathParams
      }),
      ...validateRequestBody(schemaOperationInfo.operation, body)
    ];
    const route_id = String(endpoint?.endpoint_id || "").trim();
    const target_module = String(endpoint?.module_binding || "").trim();
    const target_workflow = String(action?.action_key || "").trim();
    const brand_name = String(brand?.brand_name || requestPayload.brand || "").trim();

    const callerAuthTrust = policyValue(policies, "HTTP Execution Governance", "Caller Authorization Header Trust", "FALSE");
    if (
      String(callerAuthTrust).toUpperCase() === "FALSE" &&
      (requestPayload.headers?.Authorization || requestPayload.headers?.authorization)
    ) {
      const err = new Error("Caller-supplied Authorization is not trusted by policy.");
      err.code = "forbidden_header";
      err.status = 403;
      throw err;
    }

    if (schemaValidationErrors.length) {
      const responsePayload = {
        ok: false,
        error: {
          code: "request_schema_mismatch",
          message: "Request failed schema alignment.",
          details: {
            request_schema_alignment_status: "degraded",
            errors: schemaValidationErrors,
            openai_schema_file_id: action.openai_schema_file_id,
            schema_name: schemaContract.name
          }
        }
      };

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: responsePayload,
        error_code: "request_schema_mismatch",
        error_message_short: "Request failed schema alignment.",
        http_status: 422,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res.status(422).json(responsePayload);
    }

    await logValidationRunWriteback({
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      validationStatus: "succeeded",
      validationPayload: {
        request_schema_alignment_status: "validated",
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name
      },
      error_code: undefined,
      error_message_short: undefined,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    const finalQuery = queryWithAuth;
    let finalHeaders = {
      Accept: "application/json",
      ...(brand ? jsonParseSafe(brand.default_headers_json, {}) : {}),
      ...callerHeaders
    };
    finalHeaders = injectAuthIntoHeaders(finalHeaders, authContract);
    finalHeaders = {
      ...finalHeaders,
      ...getAdditionalStaticAuthHeaders(action, authContract)
    };

    if (body !== undefined && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
      finalHeaders["Content-Type"] = "application/json";
    }

    const baseUrl = buildUrl(resolvedProviderDomain, resolvedMethodPath.path);
    const requestUrl = appendQuery(baseUrl, finalQuery);

    debugLog("OUTBOUND_URL:", requestUrl);
    debugLog("AUTH_MODE:", authContract.mode);
    debugLog("HAS_AUTH_HEADER:", !!(finalHeaders["Authorization"] || finalHeaders["authorization"]));
    debugLog("AUTH_HEADER_NAME:", authContract.header_name || "");
    debugLog("HAS_CUSTOM_API_HEADER:", authContract.header_name ? !!finalHeaders[authContract.header_name] : false);

    const timeoutSeconds = Math.min(Number(requestPayload.timeout_seconds || 300), MAX_TIMEOUT_SECONDS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    const resilienceApplies = resilienceAppliesToParentAction(policies, parent_action_key);
    const providerRetryEnabled = retryMutationEnabled(policies);

    const maxAdditionalAttempts = Number(
      policyValue(
        policies,
        "HTTP Execution Resilience",
        "Provider Retry Max Additional Attempts",
        "0"
      )
    ) || 0;

    const retryMutations = buildProviderRetryMutations(
      policies,
      action?.action_key || parent_action_key
    );

    const transportBody = finalizeTransportBody(body);

    const upstreamRequest = {
      method: resolvedMethodPath.method,
      headers: finalHeaders,
      body: transportBody === undefined ? undefined : JSON.stringify(transportBody),
      signal: controller.signal,
      redirect: "follow"
    };

    let finalAttemptQuery = { ...finalQuery };
    let upstream;
    let data;
    let responseHeaders = {};
    let contentType = "";
    let responseText = "";
    let effectiveRequestUrl = requestUrl;

    const attempts = [{}, ...retryMutations].slice(
      0,
      1 + Math.max(0, maxAdditionalAttempts)
    );

    for (let i = 0; i < attempts.length; i++) {
      const mutation = attempts[i] || {};
      const attemptQuery = { ...finalQuery, ...mutation };
      const attemptUrl = appendQuery(baseUrl, attemptQuery);

      debugLog("RESILIENCE_APPLIES:", resilienceApplies);
      debugLog("PROVIDER_RETRY_ENABLED:", providerRetryEnabled);
      debugLog("PROVIDER_RETRY_ATTEMPT_INDEX:", i);
      debugLog("PROVIDER_RETRY_MUTATION:", mutation);
      debugLog("OUTBOUND_URL_ATTEMPT:", attemptUrl);

      const attemptResult = await executeUpstreamAttempt({
        requestUrl: attemptUrl,
        requestInit: upstreamRequest
      });

      upstream = attemptResult.upstream;
      data = attemptResult.data;
      responseHeaders = attemptResult.responseHeaders;
      contentType = attemptResult.contentType;
      responseText = attemptResult.responseText;
      effectiveRequestUrl = attemptUrl;
      finalAttemptQuery = attemptQuery;

      const canRetry =
        resilienceApplies &&
        providerRetryEnabled &&
        i < attempts.length - 1 &&
        shouldRetryProviderResponse(policies, upstream.status, responseText);

      if (!canRetry) {
        break;
      }
    }

    clearTimeout(timer);

    let responseSchemaAlignmentStatus = "not_declared";

    const responseSchemaEnforcementEnabled = String(
      policyValue(
        policies,
        "HTTP Response Schema Enforcement",
        "Response Schema Enforcement Enabled",
        "FALSE"
      )
    ).trim().toUpperCase() === "TRUE";

    const enforcedContentTypes = policyList(
      policies,
      "HTTP Response Schema Enforcement",
      "Response Content Type Enforcement"
    ).map(v => v.toLowerCase());

    const currentContentType = String(contentType || "").toLowerCase();

    const responseContent =
      schemaOperationInfo.operation?.responses?.[String(upstream.status)]?.content ||
      schemaOperationInfo.operation?.responses?.default?.content ||
      {};

    const responseJsonSchema =
      responseContent["application/json"]?.schema ||
      responseContent["application/problem+json"]?.schema ||
      null;

    const contentTypeEligible = enforcedContentTypes.length
      ? enforcedContentTypes.some(ct => currentContentType.includes(ct))
      : currentContentType.includes("application/json");

    if (responseSchemaEnforcementEnabled && contentTypeEligible) {
      if (!responseJsonSchema) {
        responseSchemaAlignmentStatus = "degraded";

        const responsePayload = {
          ok: false,
          error: {
            code: "response_schema_missing",
            message: "Response schema could not be resolved for schema-bound endpoint.",
            details: {
              schema_drift_detected: true,
              schema_drift_type: "structure_mismatch",
              schema_drift_scope: "response",
              schema_learning_candidate_emitted: true,
              upstream_status: upstream.status,
              openai_schema_file_id: action.openai_schema_file_id
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: responsePayload,
          error_code: "response_schema_missing",
          error_message_short: "Response schema could not be resolved for schema-bound endpoint.",
          http_status: 422,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(422).json(responsePayload);
      }

      responseSchemaAlignmentStatus = "validated";
      const responseErrors = validateByJsonSchema(responseJsonSchema, data, "response");
      if (responseErrors.length) {
        const drift = classifySchemaDrift(responseJsonSchema, data, "response") || {
          schema_drift_detected: true,
          schema_drift_type: "type_mismatch",
          schema_drift_scope: "response"
        };

        responseSchemaAlignmentStatus = "degraded";
        const responsePayload = {
          ok: false,
          error: {
            code: "response_schema_mismatch",
            message: "Response failed strict schema validation.",
            details: {
              errors: responseErrors,
              ...drift,
              schema_learning_candidate_emitted: true,
              upstream_status: upstream.status,
              openai_schema_file_id: action.openai_schema_file_id
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: responsePayload,
          error_code: "response_schema_mismatch",
          error_message_short: "Response failed strict schema validation.",
          http_status: 422,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(422).json(responsePayload);
      }
    }

    const compactWordPressCreate = parent_action_key === "wordpress_api" && endpoint_key === "wordpress_create_post";
    if (compactWordPressCreate) {
      const success = upstream.status === 201 && data && typeof data === "object" && data.id;
      if (success) {
        const responsePayload = {
          ok: true,
          upstream_status: upstream.status,
          provider_domain: resolvedProviderDomain,
          parent_action_key,
          endpoint_key,
          method: resolvedMethodPath.method,
          path: resolvedMethodPath.path,
          openai_schema_file_id: action.openai_schema_file_id,
          schema_name: schemaContract.name,
          resolved_auth_mode: authContract.mode,
          runtime_capability_class: action.runtime_capability_class || "",
          runtime_callable: boolFromSheet(action.runtime_callable),
          primary_executor: action.primary_executor || "",
          endpoint_role: endpoint.endpoint_role || "",
          execution_mode: endpoint.execution_mode || "",
          transport_required: boolFromSheet(endpoint.transport_required),
          request_schema_alignment_status: "validated",
          response_schema_alignment_status: responseSchemaAlignmentStatus,
          transport_request_contract_status: "validated",
          resolved_provider_domain_mode: resolvedProviderDomainMode,
          placeholder_resolution_source: placeholderResolutionSource,
          resilience_applied: resilienceApplies,
          final_query: finalAttemptQuery,
          request_url: effectiveRequestUrl,
          post_id: data.id,
          status: data.status,
          link: data.link || ""
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "succeeded",
          responseBody: data,
          error_code: data?.error?.code,
          error_message_short: data?.error?.message,
          http_status: upstream.status,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(200).json(responsePayload);
      }

      const responsePayload = {
        ok: false,
        upstream_status: upstream.status,
        provider_domain: resolvedProviderDomain,
        parent_action_key,
        endpoint_key,
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name,
        resolved_auth_mode: authContract.mode,
        runtime_capability_class: action.runtime_capability_class || "",
        runtime_callable: boolFromSheet(action.runtime_callable),
        primary_executor: action.primary_executor || "",
        endpoint_role: endpoint.endpoint_role || "",
        execution_mode: endpoint.execution_mode || "",
        transport_required: boolFromSheet(endpoint.transport_required),
        request_schema_alignment_status: "validated",
        response_schema_alignment_status: responseSchemaAlignmentStatus,
        transport_request_contract_status: "validated",
        resolved_provider_domain_mode: resolvedProviderDomainMode,
        placeholder_resolution_source: placeholderResolutionSource,
        resilience_applied: resilienceApplies,
        final_query: finalAttemptQuery,
        request_url: effectiveRequestUrl,
        error: {
          code: "wordpress_request_failed",
          message: "WordPress did not confirm post creation.",
          details: {
            upstream_status: upstream.status,
            data
          }
        }
      };

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: data,
        error_code: "wordpress_request_failed",
        error_message_short: "WordPress did not confirm post creation.",
        http_status: upstream.status,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res.status(200).json(responsePayload);
    }

    const responsePayload = {
      ok: upstream.ok,
      status: upstream.status,
      provider_domain: resolvedProviderDomain,
      parent_action_key,
      endpoint_key,
      method: resolvedMethodPath.method,
      path: resolvedMethodPath.path,
      openai_schema_file_id: action.openai_schema_file_id,
      schema_name: schemaContract.name,
      resolved_auth_mode: authContract.mode,
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: boolFromSheet(action.runtime_callable),
      primary_executor: action.primary_executor || "",
      endpoint_role: endpoint.endpoint_role || "",
      execution_mode: endpoint.execution_mode || "",
      transport_required: boolFromSheet(endpoint.transport_required),
      request_schema_alignment_status: "validated",
      response_schema_alignment_status: responseSchemaAlignmentStatus,
      transport_request_contract_status: "validated",
      resolved_provider_domain_mode: resolvedProviderDomainMode,
      placeholder_resolution_source: placeholderResolutionSource,
      resilience_applied: resilienceApplies,
      final_query: finalAttemptQuery,
      request_url: effectiveRequestUrl,
      response_headers: responseHeaders,
      data
    };

    await performUniversalServerWriteback({
      mode: "sync",
      job_id: undefined,
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      source_layer: "http_client_backend",
      entry_type: "sync_execution",
      execution_class: "sync",
      attempt_count: 1,
      status_source: upstream.ok ? "succeeded" : "failed",
      responseBody: data,
      error_code: data?.error?.code,
      error_message_short: data?.error?.message,
      http_status: upstream.status,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    return res.status(upstream.ok ? 200 : upstream.status).json(responsePayload);
  } catch (err) {
    const errorPayload = {
      code: err?.code || "internal_error",
      message: err?.message || "Unexpected error.",
      status: err?.status || 500,
      details: err?.details || null
    };

    console.error(
      "HTTP_EXECUTE_ERROR:",
      JSON.stringify({
        error: errorPayload,
        request: {
          provider_domain: requestPayload?.provider_domain || req.body?.provider_domain || "",
          parent_action_key: requestPayload?.parent_action_key || req.body?.parent_action_key || "",
          endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
          method: requestPayload?.method || req.body?.method || "",
          path: requestPayload?.path || req.body?.path || ""
        },
        action: action
          ? {
              action_key: action.action_key,
              runtime_capability_class: action.runtime_capability_class,
              runtime_callable: action.runtime_callable,
              primary_executor: action.primary_executor
            }
          : null,
        endpoint: endpoint ? getEndpointExecutionSnapshot(endpoint) : null,
        brand: brand
          ? {
              brand_name: brand.brand_name,
              target_key: brand.target_key,
              base_url: brand.base_url
            }
          : null
      })
    );

    try {
      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload?.target_key || "",
        parent_action_key:
          requestPayload?.parent_action_key || req.body?.parent_action_key || "",
        endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
        route_id: String(endpoint?.endpoint_id || "").trim(),
        target_module: String(endpoint?.module_binding || "").trim(),
        target_workflow: String(action?.action_key || "").trim(),
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: errorPayload,
        error_code: errorPayload.code,
        error_message_short: errorPayload.message,
        http_status: errorPayload.status,
        brand_name: String(brand?.brand_name || requestPayload?.brand || req.body?.brand || "").trim(),
        execution_trace_id,
        started_at: sync_execution_started_at
      });
    } catch (writebackErr) {
      console.error("SYNC_WRITEBACK_FAILED:", writebackErr);
    }

    return res.status(errorPayload.status).json({
      ok: false,
      error: errorPayload
    });
  }
});

async function shutdownJobState() {
  try {
    await forceJobStateFlush();
  } catch (err) {
    console.error("JOB_STATE_SHUTDOWN_FLUSH_FAILED:", err);
  }
}

process.on("SIGINT", async () => {
  await shutdownJobState();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownJobState();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`http_generic_api_connector listening on port ${port}`);
});
