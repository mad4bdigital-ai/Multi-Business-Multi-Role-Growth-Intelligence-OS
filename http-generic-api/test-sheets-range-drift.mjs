/**
 * Closure test: getSheetValues range integrity guards
 * Verifies all 3 guard layers added during the drift-fix sprint:
 *   1. assertExplicitRange (googleSheets.js — SDK layer)
 *   2. validateEndpointRowConsistency exactPath (registryExecutionEligibility.js — registry layer)
 *   3. resolveExecutionRequest pre/post guards (executionResolution.js — request layer)
 *
 * Run: node test-sheets-range-drift.mjs
 */

import { fetchRange } from "./googleSheets.js";
import { validateEndpointRowConsistency } from "./registryExecutionEligibility.js";
import { resolveExecutionRequest } from "./executionResolution.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

// ── 1. assertExplicitRange — SDK layer ──────────────────────────────────────
section("assertExplicitRange (via fetchRange) — SDK layer");

for (const [label, range] of [
  ["empty string", ""],
  ["null", null],
  ["whitespace only", "   "]
]) {
  let errCode;
  try {
    await fetchRange(null, range);
  } catch (e) {
    errCode = e.code;
  }
  assert(
    `${label} range throws missing_required_range_param`,
    errCode === "missing_required_range_param",
    `got: ${errCode}`
  );
}

// ── 2. validateEndpointRowConsistency exactPath — registry layer ─────────────
section("validateEndpointRowConsistency — getSheetValues exactPath guard");

{
  const correct = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://sheets.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v4/spreadsheets/{spreadsheetId}/values/{range}"
  };
  const r = validateEndpointRowConsistency(correct, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert("correct registry row passes", r.valid === true, JSON.stringify(r.mismatches));
}

{
  const bakedRange = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://sheets.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v4/spreadsheets/abc/values/Execution%20Policy%20Registry%21A1852%3AH1901"
  };
  const r = validateEndpointRowConsistency(bakedRange, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert(
    "row with baked-in range fails exactPath guard",
    r.valid === false && r.mismatches.some(m => m.field === "endpoint_path_or_function"),
    JSON.stringify(r.mismatches)
  );
}

{
  const docsDrift = {
    endpoint_key: "getSheetValues",
    parent_action_key: "google_sheets_api",
    endpoint_operation: "getSheetValues",
    openai_action_name: "getSheetValues",
    route_target: "google_sheets_api",
    provider_domain: "https://docs.googleapis.com",
    method: "GET",
    endpoint_path_or_function: "/v1/documents/{documentId}"
  };
  const r = validateEndpointRowConsistency(docsDrift, { endpoint_key: "getSheetValues", parent_action_key: "google_sheets_api" });
  assert(
    "row pointing to Docs domain fails provider_domain guard",
    r.valid === false && r.mismatches.some(m => m.field === "provider_domain"),
    JSON.stringify(r.mismatches)
  );
}

// ── 3. resolveExecutionRequest guards — request layer ────────────────────────

function makeMinimalDeps(overrides = {}) {
  const registry = { drive: {}, brandRows: [], hostingAccounts: [], actionRows: [], endpointRows: [], policies: {} };
  return {
    requireEnv: () => {},
    createExecutionTraceId: () => "trace_closure_test",
    debugLog: () => {},
    promoteDelegatedExecutionPayload: p => p,
    normalizeExecutionPayload: p => p,
    validateAssetHomePayloadRules: () => ({ ok: true }),
    normalizeAssetType: t => t,
    classifyAssetHome: () => "external",
    assertHostingerTargetTier: () => {},
    validatePayloadIntegrity: () => ({ ok: true }),
    normalizeTopLevelRoutingFields: p => p,
    isDelegatedHttpExecuteWrapper: () => false,
    validateTopLevelRoutingFields: () => ({ ok: true }),
    getRegistry: async () => registry,
    reloadRegistry: async () => registry,
    getRequiredHttpExecutionPolicyKeys: () => [],
    requirePolicySet: () => ({ ok: true }),
    policyValue: (_p, _g, _k, fallback = "") => fallback,
    resolveHttpExecutionContext: () => ({ resolvedMethodPath: { path: "" } }),
    boolFromSheet: v => String(v || "").trim().toUpperCase() === "TRUE",
    resolveAction: () => ({}),
    resolveEndpoint: () => ({}),
    getEndpointExecutionSnapshot: () => ({}),
    resolveBrand: () => ({}),
    requireRuntimeCallableAction: () => {},
    requireEndpointExecutionEligibility: () => ({
      endpointRole: "primary",
      executionMode: "http_delegated",
      transportRequired: true,
      delegatedTransportTarget: false
    }),
    requireExecutionModeCompatibility: () => {},
    requireNativeFamilyBoundary: () => {},
    requireTransportIfDelegated: () => {},
    requireNoFallbackDirectExecution: () => {},
    isDelegatedTransportTarget: () => false,
    ensureMethodAndPathMatchEndpoint: () => ({ path: "" }),
    sanitizeCallerHeaders: h => (h || {}),
    ...overrides
  };
}

section("resolveExecutionRequest — pre-resolution guard (missing_required_range_param)");

for (const [label, pathParams] of [
  ["no path_params", undefined],
  ["empty path_params", {}],
  ["path_params with empty range", { spreadsheetId: "abc", range: "" }],
  ["path_params with whitespace range", { spreadsheetId: "abc", range: "   " }]
]) {
  const payload = { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET" };
  if (pathParams !== undefined) payload.path_params = pathParams;
  const result = await resolveExecutionRequest(payload, makeMinimalDeps());
  assert(
    `${label} → missing_required_range_param`,
    result.ok === false && result.response?.body?.error?.code === "missing_required_range_param",
    JSON.stringify(result.response?.body?.error)
  );
}

section("resolveExecutionRequest — post-resolution drift guard (sheets_range_resolution_mismatch)");

const REGRESSION_RANGES = [
  "Review Stage Registry!A1:C3",
  "Actor Role Capability Registry!A1:C3",
  "Registry Surfaces Catalog!A32:P32",
  "Execution Policy Registry!A190:H196"
];

const KNOWN_BAD_DRIFT_PATH = `/v4/spreadsheets/abc/values/${encodeURIComponent("Execution Policy Registry!A1852:H1901")}`;

for (const range of REGRESSION_RANGES) {
  const result = await resolveExecutionRequest(
    { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: { spreadsheetId: "abc", range } },
    makeMinimalDeps({ resolveHttpExecutionContext: () => ({ resolvedMethodPath: { path: KNOWN_BAD_DRIFT_PATH } }) })
  );
  assert(
    `drift to Execution Policy Registry!A1852:H1901 caught for "${range}"`,
    result.ok === false && result.response?.body?.error?.code === "sheets_range_resolution_mismatch",
    JSON.stringify(result.response?.body?.error)
  );
}

section("resolveExecutionRequest — regression: 4 ranges pass when resolver is faithful");

for (const range of REGRESSION_RANGES) {
  const encodedRange = encodeURIComponent(range);
  const correctPath = `/v4/spreadsheets/abc/values/${encodedRange}`;
  const result = await resolveExecutionRequest(
    { parent_action_key: "google_sheets_api", endpoint_key: "getSheetValues", method: "GET", path_params: { spreadsheetId: "abc", range } },
    makeMinimalDeps({ resolveHttpExecutionContext: () => ({ resolvedMethodPath: { path: correctPath } }) })
  );
  assert(
    `"${range}" resolves without drift`,
    result.ok === true,
    result.ok === false ? JSON.stringify(result.response?.body?.error) : ""
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
