# Connector Contracts
**Authority document — updated when public connector APIs change**

This document defines the explicit public API surface for each provider connector module in `http-generic-api/`. Internal helpers are not exported unless required by callers outside the module.

---

## github.js

### Public exports

#### `githubGitBlobChunkRead({ input })`
- **Purpose:** Read a GitHub blob by SHA, with chunked range support.
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `github_git_blob_chunk_read`)
- **Input:** `input.owner`, `input.repo`, `input.file_sha`, `input.byte_offset`, `input.length`
- **Returns:** `{ ok, chunk, byte_offset, length, total_size, sha }` or error object
- **Auth:** `GITHUB_TOKEN` environment variable

#### `fetchGitHubBlobPayload({ owner, repo, fileSha })`
- **Purpose:** Low-level fetch of a single GitHub blob by SHA.
- **Caller:** Internal helper, also exported for direct use if needed.
- **Returns:** `{ ok, content, encoding, sha, size }` or error object
- **Note:** This is the raw fetch primitive. Prefer `githubGitBlobChunkRead` for ranged access.

### Internal (not exported)
All helper utilities (base64 decoding, byte range slicing, error shaping) are private.

---

## hostinger.js

### Public exports

#### `hostingerSshRuntimeRead({ input })`
- **Purpose:** Read runtime state from a Hostinger SSH target (site inventory lookup).
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `hostinger_ssh_runtime_read`)
- **Input:** `input.target_key` or `input.brand` to identify the hosting account row
- **Returns:** Governed runtime read result or error object

#### `matchesHostingerSshTarget(rowObj, input)`
- **Purpose:** Determines whether a registry row matches the given input criteria.
- **Caller:** Internal to `hostingerSshRuntimeRead`; exported for use in registry resolution helpers.

### Internal (not exported)
SSH transport logic, credential resolution internals.

---

## resolveLogicPointerContext.js

### Public exports

#### `resolveLogicPointerContext(input, deps)`
- **Purpose:** Resolve which logic document (canonical or governed legacy) is active for a given logic family/id, following the 6-step orchestration rule from `canonicals/system_bootstrap/01_logic_pointer_knowledge.md`.
- **Input:** `{ logic_id, logic_family, require_knowledge }` — at least one of `logic_id` or `logic_family` must be non-empty.
- **Deps:** `{ getPointerRow(id), isRollbackAuthorized(id)?, getKnowledgeProfile(id)? }` — all injected, none global.
- **Returns:** `{ ok, state, blocked_reason?, knowledge? }`
  - `state` always includes: `logic_pointer_surface_id`, `logic_pointer_resolution_status`, `resolved_logic_doc_id`, `resolved_logic_doc_mode`, `resolved_logic_mode`, `canonical_status`, `active_pointer`, `legacy_doc_retained`, `rollback_available`, `logic_association_status`, `used_logic_id`, `used_logic_name`, `logic_rollback_status`, `logic_knowledge_status`
  - Sink-compatible fields (`used_logic_id`, `used_logic_name`, `resolved_logic_doc_id`, `resolved_logic_mode`, `logic_pointer_resolution_status`, `logic_knowledge_status`, `logic_rollback_status`, `logic_association_status`) are emitted directly — no call-site translation needed before forwarding to writeback
  - `knowledge` present when `require_knowledge: true` and a profile was found
- **Resolution priority:** rollback check first (overrides `canonical_active`), then `canonical_active`, then `legacy_recovery`. No valid path → `degraded`.

#### `guardDirectLegacyExecution(pointerRow, rollbackAuthorized)`
- **Purpose:** Block direct legacy execution when the canonical pointer is active and no governed rollback is authorized.
- **Returns:** `{ blocked: true, reason }` or `{ blocked: false }`
- **Note:** Called before any legacy document is executed directly. Canonical-active with no rollback auth always blocks.

### Internal (not exported)
All intermediate evidence construction and status-string normalization are private.

---

---

## connectorExecutor.js

### Public exports

#### `dispatchPlan(plan_id, options)`
- **Purpose:** Execute an approved execution_plan by routing it to the correct connector dispatcher.
- **Caller:** Planner routes — `POST /planner/plans/:id/execute`
- **Input:** `plan_id` (UUID), options: `{ apply, post_types, publish_status, actor_id }`
- **Returns:** `{ ok, run_id, trace_id, plan_id, connector_type, plan_status, apply, duration_ms, result?, error? }`
- **Routing:** Detects connector type from loaded brand/connected_system:
  - `brand.auth_type = basic_auth_app_password` OR `connected_system.connector_family = wordpress` → `dispatchWordpress()`
  - `connected_system.connector_family = make_mcp` → `dispatchMcpConnector()`
  - else → `dispatchContentWorkflow()` (async stub)
- **Records:** `workflow_runs`, `step_runs`, `telemetry_spans`, `audit_log`

#### `dispatchMcpConnector(plan)` *(internal, via dispatchPlan)*
- **Purpose:** Send a JSON-RPC 2.0 `tools/call` to the Make MCP stateless endpoint.
- **Transport:** `POST https://eu2.make.com/mcp/stateless`, `Authorization: Bearer <MAKE_MCP_TOKEN>`
- **Envelope:** Built from first step in `plan.steps_json`: `{ jsonrpc: "2.0", method: "tools/call", params: { name: <tool>, arguments: <args> } }`
- **Auth:** Resolved via `resolveSecretFromReference("ref:secret:MAKE_MCP_TOKEN")` or `process.env.MAKE_MCP_TOKEN`
- **Returns:** `{ ok: true, dispatch_mode: "sync", rpc_id, tool, mcp_response }`

---

## googleAuthTokenResolver.js

### Public exports

#### `getGoogleAccessToken()`
- **Purpose:** Async — return a valid Google OAuth2 access token, fetching fresh if cache is stale.
- **Credential chain (priority order):**
  1. `GOOGLE_APPLICATION_CREDENTIALS` — path to service account JSON file
  2. `GOOGLE_SA_JSON` — inline service account JSON (raw or base64)
  3. `GOOGLE_REFRESH_TOKEN` + `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — user OAuth2
- **Scopes covered:** Sheets, Docs, Drive, Analytics (readonly), Search Ads 360, Search Console, Tag Manager
- **Cache:** 55-minute TTL; auto-refreshes every 50 minutes via `setInterval().unref()`
- **Pre-warms** at module import (non-blocking)
- **Returns:** access token string, or `""` if no credentials are configured

#### `getGoogleAccessTokenSync()`
- **Purpose:** Sync — return cached token if fresh; trigger background refresh if stale; return stale token or `""` if cache is empty.
- **Caller:** `authCredentialResolution.normalizeAuthContract()` — used for `google_oauth2` and `google_ads_oauth2` auth modes
- **Returns:** cached token string or `""` (never throws)

### Internal (not exported)
`fetchGoogleToken()`, `parseSaJson()`, module-level cache variables.

---

## Dispatch entrypoint

Connector dispatch routes through two layers:

- `dispatchPlan()` in `connectorExecutor.js` for connector-family-based execution
- `dispatchEndpointKeyExecution` in `jobRunner.js` for endpoint-key execution

```js
// connectorExecutor.js — dispatchPlan() routing
case "make_mcp_connector":  // connector_family = make_mcp
  return await dispatchMcpConnector(plan);  // via dispatchPlan()

// jobRunner.js — dispatchEndpointKeyExecution routing
case "github_git_blob_chunk_read":
  return await githubGitBlobChunkRead({ input: requestPayload });

case "hostinger_ssh_runtime_read":
  return await hostingerSshRuntimeRead({ input: requestPayload });
```

No connector is called directly from route handlers or the main server entrypoint. All connector access goes through the dispatch layer.

---

## Contract rules

1. Each connector exports only what has a real caller or explicit contract purpose.
2. Internal helpers remain unexported unless another module requires them.
3. Dispatch is always by `endpoint_key` string — no connector is hard-wired to a route.
4. Auth credentials are read from environment variables inside the connector, not injected by callers.
5. Error returns are structured objects with `ok: false, error: { code, message }` — not thrown exceptions, except for configuration errors.
