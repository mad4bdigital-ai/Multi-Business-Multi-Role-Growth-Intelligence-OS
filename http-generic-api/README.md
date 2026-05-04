# http-generic-api-connector

Policy-enforced HTTP executor.

## Key behavior
- Resolves `parent_action_key`, `endpoint_key`, and brand target from registry sheets
- Resolves `action_key.openai_schema_file_id` and validates request against the schema before transport execution
- Normalizes auth modes:
  - `none`
  - `basic_auth`
  - `bearer_token`
  - `api_key_query`
  - `api_key_header`
  - `oauth_gpt_action`
  - `custom_headers`
- Injects auth server-side
- Rejects caller-supplied `Authorization`
- Blocks `oauth_gpt_action` on this transport and requires native connector path

## Key runtime modules

- `server.js` — Express route surface, top-level orchestration, and engine evidence auto-derivation
- `execution.js` — execution-result classification, `Execution Log Unified` row shaping (56 columns), logic/engine evidence normalizers, `buildEngineEvidenceFromWorkflow`, `getWorkflowRowByKey`, `getActiveEngineRegistryRows`, and writeback wrappers
- `resolveLogicPointerContext.js` — canonical logic pointer resolution (`resolveLogicPointerContext`, `guardDirectLegacyExecution`); emits sink-compatible evidence fields directly
- `sinkOrchestration.js` — universal writeback orchestration accepting full logic and engine evidence payloads
- `registryCache.js` — Redis-backed registry cache with configurable TTL; transparent to callers of `registrySheets.js`
- `registryResolution.js`, `registrySheets.js`, `registryMutations.js` — registry-backed routing and execution control
- `mutationGovernance.js`, `governedChangeControl.js`, `governedSheetWrites.js` — governed writeback and mutation control
- `normalization.js` — canonical payload normalization for all A–H domains
- `wordpress/` — 16 phase modules (A–P) for governed site migration

Test suite: 394 assertions across 21 test files (`npm test`). Architecture checks: 173 checks (`npm run validate`).

## Required env
- `REGISTRY_SPREADSHEET_ID`
- optional:
  - `BRAND_REGISTRY_SHEET`
  - `ACTIONS_REGISTRY_SHEET`
  - `ENDPOINT_REGISTRY_SHEET`
  - `EXECUTION_POLICY_SHEET`
  - `HOSTING_ACCOUNT_REGISTRY_SHEET`
  - `BACKEND_API_KEY`
  - `REGISTRY_CACHE_TTL_SECONDS` (default: `600`) — Redis cache TTL for registry sheets; set to `0` to disable caching
  - `JSON_BODY_LIMIT` (default: `20mb`)
  - `JOB_MAX_ATTEMPTS` (default: `3`)
  - `MAX_TIMEOUT_SECONDS` (default: `300`, max: `3600`) - upper bound for sync and queued execution timeouts
  - `WORKER_CONCURRENCY` (default: `2`) - BullMQ worker concurrency; use `1` for scheduled bursts when providers are slow or rate-limited
  - `JOB_QUEUE_TICK_MS` (default: `1000`)
  - `JOB_WEBHOOK_TIMEOUT_MS` (default: `10000`)
  - `JOB_STATE_FILE` (default: `./data/http-job-state.json`)
  - `JOB_STATE_FLUSH_DEBOUNCE_MS` (default: `250`)
  - `hostinger_cloud_plan_01` (must match `ref:secret:hostinger_cloud_plan_01` in Hosting Account Registry)

## Endpoints
- `POST /http-execute` (existing sync execution)
- `POST /jobs` (new async execution)
- `GET /jobs/:jobId` (job status/metadata)
- `GET /jobs/:jobId/result` (final result/error)

## Sync request body (`POST /http-execute`)
```json
{
  "provider_domain": "https://donatours.com/wp-json",
  "parent_action_key": "wordpress_api",
  "endpoint_key": "wordpress_create_post",
  "method": "POST",
  "path": "/wp/v2/posts",
  "query": {},
  "headers": {
    "Content-Type": "application/json"
  },
  "path_params": {},
  "body": {
    "title": "Example",
    "status": "draft",
    "content": "Hello"
  }
}
```

## Async request body (`POST /jobs`)
```json
{
  "target_key": "donatours_wp",
  "parent_action_key": "hostinger_api",
  "endpoint_key": "hostinger_subscriptions_list",
  "method": "GET",
  "path": "/api/billing/v1/subscriptions",
  "webhook_url": "https://your-app.com/webhooks/job-finished",
  "callback_secret": "optional-signing-secret",
  "idempotency_key": "optional-client-generated-key",
  "max_attempts": 3
}
```

## Async response examples
Create job:
```json
{
  "job_id": "job_123",
  "job_type": "http_execute",
  "status": "queued",
  "created_at": "2026-04-12T09:00:00Z",
  "updated_at": "2026-04-12T09:00:00Z",
  "requested_by": "127.0.0.1",
  "target_key": "donatours_wp",
  "parent_action_key": "hostinger_api",
  "endpoint_key": "hostinger_subscriptions_list",
  "attempt_count": 0,
  "max_attempts": 3,
  "next_retry_at": null,
  "status_url": "/jobs/job_123",
  "result_url": "/jobs/job_123/result"
}
```

Check status:
```json
{
  "job_id": "job_123",
  "status": "running",
  "attempt_count": 1
}
```

Get final result:
```json
{
  "job_id": "job_123",
  "status": "succeeded",
  "result": {
    "ok": true
  }
}
```
