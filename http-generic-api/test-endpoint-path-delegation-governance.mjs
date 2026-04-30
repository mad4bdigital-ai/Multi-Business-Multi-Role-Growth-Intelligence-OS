import assert from "node:assert/strict";
import {
  isGovernedControllerDelegation,
  normalizeEndpointPathForLookup,
  findEndpointRowsByPath,
  buildEndpointPathSearchReport,
  requireEndpointPathColumnSearchBeforeAdd
} from "./registryResolution.js";

// --- isGovernedControllerDelegation ---

{
  const row = {
    parent_action_key: "site_migration_controller",
    execution_mode: "http_delegated",
    transport_action_key: "http_post",
    status: "active",
    execution_readiness: "ready",
    endpoint_role: "primary"
  };

  assert.equal(
    isGovernedControllerDelegation(row, "site_migration_controller", "wordpress_api"),
    true,
    "controller endpoint should allow delegation to different route_target"
  );
}

{
  const row = {
    parent_action_key: "wordpress_api",
    execution_mode: "http_delegated",
    transport_action_key: "http_post",
    status: "active",
    execution_readiness: "ready",
    endpoint_role: "primary"
  };

  assert.equal(
    isGovernedControllerDelegation(row, "wordpress_api", "site_migration_controller"),
    false,
    "non-controller parent should not allow delegation"
  );
}

{
  const row = {
    parent_action_key: "site_migration_controller",
    execution_mode: "http_delegated",
    transport_action_key: "http_post",
    status: "inactive",
    execution_readiness: "ready",
    endpoint_role: "primary"
  };

  assert.equal(
    isGovernedControllerDelegation(row, "site_migration_controller", "wordpress_api"),
    false,
    "inactive row should not pass delegation check"
  );
}

{
  const row = {
    parent_action_key: "site_migration_controller",
    execution_mode: "http_delegated",
    transport_action_key: "http_post",
    status: "active",
    execution_readiness: "not_ready",
    endpoint_role: "primary"
  };

  assert.equal(
    isGovernedControllerDelegation(row, "site_migration_controller", "wordpress_api"),
    false,
    "not-ready row should not pass delegation check"
  );
}

{
  const row = {
    parent_action_key: "site_migration_controller",
    execution_mode: "native_controller",
    transport_action_key: "http_get",
    status: "active",
    execution_readiness: "ready",
    endpoint_role: "primary"
  };

  assert.equal(
    isGovernedControllerDelegation(row, "site_migration_controller", "wordpress_api"),
    true,
    "native_controller execution mode should also allow delegation"
  );
}

// --- normalizeEndpointPathForLookup ---

{
  assert.equal(
    normalizeEndpointPathForLookup("/wp/v2/posts"),
    "/wp/v2/posts"
  );
  assert.equal(
    normalizeEndpointPathForLookup("https://example.com/wp-json/wp/v2/posts"),
    "/wp/v2/posts"
  );
  assert.equal(
    normalizeEndpointPathForLookup("/wp-json/wp/v2/posts"),
    "/wp/v2/posts"
  );
  assert.equal(
    normalizeEndpointPathForLookup("/wp/v2/posts?per_page=10"),
    "/wp/v2/posts"
  );
  assert.equal(
    normalizeEndpointPathForLookup("/wp/v2/posts/"),
    "/wp/v2/posts"
  );
  assert.equal(
    normalizeEndpointPathForLookup(""),
    "/"
  );
}

// --- findEndpointRowsByPath ---

{
  const rows = [
    { endpoint_key: "wp_get_posts", endpoint_path_or_function: "/wp/v2/posts" },
    { endpoint_key: "wp_get_pages", endpoint_path_or_function: "/wp/v2/pages" },
    { endpoint_key: "wp_get_posts_via_json", endpoint_path_or_function: "https://example.com/wp-json/wp/v2/posts" }
  ];

  const matches = findEndpointRowsByPath(rows, "/wp/v2/posts");
  assert.equal(matches.length, 2, "should match both direct and wp-json prefixed paths");
  assert.ok(matches.some(r => r.endpoint_key === "wp_get_posts"));
  assert.ok(matches.some(r => r.endpoint_key === "wp_get_posts_via_json"));
}

// --- buildEndpointPathSearchReport ---

{
  const rows = [
    { endpoint_key: "wp_get_posts", parent_action_key: "wordpress_api", endpoint_path_or_function: "/wp/v2/posts", status: "active", execution_readiness: "ready" }
  ];

  const report = buildEndpointPathSearchReport(rows, "/wp/v2/posts");
  assert.equal(report.match_count, 1);
  assert.equal(report.matches[0].endpoint_key, "wp_get_posts");
  assert.equal(report.normalized_path, "/wp/v2/posts");
}

// --- requireEndpointPathColumnSearchBeforeAdd ---

{
  const rows = [
    { endpoint_key: "wp_get_posts", parent_action_key: "wordpress_api", endpoint_path_or_function: "/wp/v2/posts", status: "active", execution_readiness: "ready" }
  ];

  assert.throws(
    () => requireEndpointPathColumnSearchBeforeAdd(rows, "/wp/v2/posts"),
    err => err.code === "endpoint_path_already_exists"
  );
}

{
  const rows = [
    { endpoint_key: "wp_get_posts", parent_action_key: "wordpress_api", endpoint_path_or_function: "/wp/v2/posts", status: "active", execution_readiness: "ready" }
  ];

  const report = requireEndpointPathColumnSearchBeforeAdd(rows, "/wp/v2/pages");
  assert.equal(report.match_count, 0, "no match should not throw");
}

console.log("endpoint path delegation governance tests passed");
