/**
 * Unit tests for utils.js CPT schema preflight exports
 * Run: node test-utils.mjs
 */
import {
  extractJsonAssetPayloadBody,
  normalizeJsonObjectOrEmpty,
  isWordpressCptSchemaPreflightEndpoint,
  buildWordpressCptSchemaPreflightAssetKey,
  buildWordpressCptSchemaPreflightPayload
} from "./utils.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─── extractJsonAssetPayloadBody ────────────────────────────────────────────
section("extractJsonAssetPayloadBody");

assert("returns null when no response_body",
  extractJsonAssetPayloadBody({}) === null);
assert("returns body.data when data key present",
  extractJsonAssetPayloadBody({ response_body: { data: { id: 1 } } })?.id === 1);
assert("returns full body when no data key",
  extractJsonAssetPayloadBody({ response_body: { title: "x" } })?.title === "x");
assert("returns array body as-is",
  Array.isArray(extractJsonAssetPayloadBody({ response_body: [1, 2] })));

// ─── normalizeJsonObjectOrEmpty ─────────────────────────────────────────────
section("normalizeJsonObjectOrEmpty");

assert("returns {} for null",
  Object.keys(normalizeJsonObjectOrEmpty(null)).length === 0);
assert("returns {} for array",
  Object.keys(normalizeJsonObjectOrEmpty([1, 2])).length === 0);
assert("returns {} for string",
  Object.keys(normalizeJsonObjectOrEmpty("str")).length === 0);
assert("passes through plain object",
  normalizeJsonObjectOrEmpty({ a: 1 }).a === 1);

// ─── isWordpressCptSchemaPreflightEndpoint ──────────────────────────────────
section("isWordpressCptSchemaPreflightEndpoint");

assert("true for wordpress_get_cpt_runtime_type",
  isWordpressCptSchemaPreflightEndpoint("wordpress_get_cpt_runtime_type") === true);
assert("true for jetengine_get_post_type_config",
  isWordpressCptSchemaPreflightEndpoint("jetengine_get_post_type_config") === true);
assert("true for wordpress_get_taxonomy_runtime",
  isWordpressCptSchemaPreflightEndpoint("wordpress_get_taxonomy_runtime") === true);
assert("false for wordpress_list_types",
  isWordpressCptSchemaPreflightEndpoint("wordpress_list_types") === false);
assert("false for empty string",
  isWordpressCptSchemaPreflightEndpoint("") === false);

// ─── buildWordpressCptSchemaPreflightAssetKey ────────────────────────────────
section("buildWordpressCptSchemaPreflightAssetKey");

const key1 = buildWordpressCptSchemaPreflightAssetKey({
  brand_name: "My Brand",
  target_key: "site_abc",
  cpt_slug: "post"
});
assert("key contains brand slug", key1.startsWith("my_brand__"));
assert("key contains target_key", key1.includes("__site_abc__"));
assert("key contains cpt_slug", key1.includes("__post__"));
assert("key ends with v1 suffix", key1.endsWith("__wordpress_cpt_schema_preflight_v1"));

const keyFallback = buildWordpressCptSchemaPreflightAssetKey({});
assert("fallback key uses unknown_brand", keyFallback.startsWith("unknown_brand__"));
assert("fallback key uses unknown_cpt", keyFallback.includes("__unknown_cpt__"));

// ─── buildWordpressCptSchemaPreflightPayload ─────────────────────────────────
section("buildWordpressCptSchemaPreflightPayload");

const payload = buildWordpressCptSchemaPreflightPayload({
  brand_name: "Test Brand",
  target_key: "site_x",
  base_url: "https://site.example.com",
  cpt_slug: "article",
  endpoint_key: "wordpress_get_cpt_runtime_type"
});
assert("returns identity block", typeof payload.identity === "object");
assert("identity.site_type is wordpress", payload.identity.site_type === "wordpress");
assert("identity.brand_name set", payload.identity.brand_name === "Test Brand");
assert("source_resolution block present", typeof payload.source_resolution === "object");
assert("wordpress_rest_type_resolved true for matching endpoint",
  payload.source_resolution.wordpress_rest_type_resolved === true);
assert("jetengine_config_resolved false for non-matching endpoint",
  payload.source_resolution.jetengine_config_resolved === false);
assert("field_contract is object", typeof payload.field_contract === "object");
assert("playbook_inference block present", typeof payload.playbook_inference === "object");
assert("playbook_coverage_status defaults to not_applicable",
  payload.playbook_inference.playbook_coverage_status === "not_applicable");

const payloadWithData = buildWordpressCptSchemaPreflightPayload({
  brand_name: "B",
  endpoint_key: "jetengine_get_post_type_config",
  response_body: {
    data: {
      field_contract: { name: "string" },
      wordpress_rest_type_resolved: true
    }
  }
});
assert("merges field_contract from response_body.data",
  payloadWithData.field_contract?.name === "string");
assert("jetengine_config_resolved true for matching endpoint",
  payloadWithData.source_resolution.jetengine_config_resolved === true);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
