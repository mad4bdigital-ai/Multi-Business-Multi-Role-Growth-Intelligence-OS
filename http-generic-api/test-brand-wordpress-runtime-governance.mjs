import assert from "node:assert/strict";

import {
  describeAllowedDelegatedTransportKeys,
  isSupportedDelegatedTransportActionKey,
  transportActionKeyForMethod
} from "./transportKeys.js";
import { validateEndpointRowConsistency } from "./registryExecutionEligibility.js";
import { requireTransportIfDelegated } from "./registryTransportGovernance.js";
import { enforceBrandLiveMutationPreflight } from "./brandLiveMutationPreflight.js";

const policies = [
  {
    policy_group: "Execution Capability Governance",
    policy_key: "Require Transport For Delegated Actions",
    policy_value: "TRUE"
  },
  {
    policy_group: "HTTP Execution Governance",
    policy_key: "Allowed Transport",
    policy_value: "http_generic_api"
  }
];

const deps = {
  boolFromSheet: value => String(value).toLowerCase() === "true",
  policyValue: (rows, group, key, fallback) => {
    const row = rows.find(item => item.policy_group === group && item.policy_key === key);
    return row ? row.policy_value : fallback;
  }
};

assert.equal(isSupportedDelegatedTransportActionKey("http_generic_api"), true);
assert.equal(isSupportedDelegatedTransportActionKey("http_get"), true);
assert.equal(isSupportedDelegatedTransportActionKey("http_post"), true);
assert.equal(isSupportedDelegatedTransportActionKey("ftp_post"), false);
assert.equal(transportActionKeyForMethod("POST"), "http_post");
assert.match(describeAllowedDelegatedTransportKeys("http_generic_api"), /http_post/);

assert.doesNotThrow(() => requireTransportIfDelegated(
  policies,
  { action_key: "wordpress_api", primary_executor: "http_client_backend" },
  {
    endpoint_key: "wordpress_get_tours_and_activities",
    execution_mode: "http_delegated",
    transport_required: "TRUE",
    transport_action_key: "http_get"
  },
  deps
));

const canonicalWpRead = validateEndpointRowConsistency({
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_get_tours_and_activities",
  route_target: "wordpress_api",
  provider_domain: "target_resolved",
  provider_family: "wordpress_cms",
  method: "GET",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}",
  transport_action_key: "http_get"
}, {
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_get_tours_and_activities"
});
assert.equal(canonicalWpRead.valid, true, JSON.stringify(canonicalWpRead.mismatches));

const badWpUpdate = validateEndpointRowConsistency({
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_update_tours_and_activities",
  route_target: "wordpress_api",
  provider_domain: "https://developers.hostinger.com",
  provider_family: "hosting_provider",
  method: "GET",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}",
  transport_action_key: "hostinger_api"
}, {
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_update_tours_and_activities"
});
assert.equal(badWpUpdate.valid, false);
assert.ok(badWpUpdate.mismatches.some(item => item.field === "provider_domain"));
assert.ok(badWpUpdate.mismatches.some(item => item.field === "provider_family"));
assert.ok(badWpUpdate.mismatches.some(item => item.field === "method"));
assert.ok(badWpUpdate.mismatches.some(item => item.field === "transport_action_key"));

const wpEndpoint = {
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_update_tours_and_activities",
  method: "POST",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}"
};

assert.equal(enforceBrandLiveMutationPreflight({
  parent_action_key: "wordpress_api",
  endpoint: wpEndpoint,
  resolvedMethodPath: { method: "GET" },
  requestPayload: {},
  brand: { brand_name: "AllRoyalEgypt" }
}).preflight_status, "read_only_fetch");

assert.throws(
  () => enforceBrandLiveMutationPreflight({
    parent_action_key: "wordpress_api",
    endpoint: wpEndpoint,
    resolvedMethodPath: { method: "POST" },
    requestPayload: { body: { title: "Draft" } },
    brand: { brand_name: "AllRoyalEgypt" }
  }),
  /operator approval/
);

assert.equal(enforceBrandLiveMutationPreflight({
  parent_action_key: "wordpress_api",
  endpoint: wpEndpoint,
  resolvedMethodPath: { method: "POST" },
  requestPayload: {
    mutation_approval: { approved: true },
    dry_run_preflight_completed: true,
    live_execution_approved: true,
    body: { title: "Draft" }
  },
  brand: { brand_name: "AllRoyalEgypt" }
}).preflight_status, "passed");

assert.throws(
  () => enforceBrandLiveMutationPreflight({
    parent_action_key: "wordpress_api",
    endpoint: wpEndpoint,
    resolvedMethodPath: { method: "POST" },
    requestPayload: {
      mutation_approval: { approved: true },
      body: { status: "publish" }
    },
    brand: { brand_name: "AllRoyalEgypt" }
  }),
  /publish_status_gate_validated/
);

console.log("brand WordPress runtime governance tests passed");
