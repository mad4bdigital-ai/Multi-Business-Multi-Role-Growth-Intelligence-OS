# Deployment Parity Checklist
**Authority document - run before and after every deployment**

This checklist distinguishes four verification layers that must all pass before a deployment is considered aligned. File-level changes alone do not constitute deployment verification.

---

## Layer 1 - File merged (CI gate)

These pass automatically in CI on every push/PR:

- [ ] `npm test` passes from `http-generic-api/` (336+ assertions across 17 test files: utility, job runner, execution routing, connectors, routes, activation bootstrap cache, Google Sheets chunking, sheets range drift, starter authority surfaces, transport governance, activation classification, activation response, governed activation runner, registry alignment validator, logic switching, and WordPress)
- [ ] `npm run validate` passes from `http-generic-api/` (104+ architecture checks)
- [ ] All `.js` modules pass `node --check`
- [ ] No new imports from removed or renamed modules
- [ ] `wordpress/index.js` barrel exports >= 545 symbols
- [ ] `github.js` exports exactly 2 public symbols
- [ ] `server.js` remains under 6,000 lines

---

## Layer 2 - Registry aligned

Verify the live Google Sheets registry reflects intended architecture:

- [ ] `Site Runtime Inventory Registry` sheet exists and has required columns (`target_key`, `brand_name`, `base_url`, `site_type`, `active_status`)
- [ ] `Execution Log Unified` sheet exists and is writable
- [ ] `JSON Asset Registry` sheet exists and is writable
- [ ] `REGISTRY_SPREADSHEET_ID` environment variable points to correct spreadsheet
- [ ] `EXECUTION_LOG_UNIFIED_SPREADSHEET_ID` and `JSON_ASSET_REGISTRY_SPREADSHEET_ID` are set if using separate spreadsheets
- [ ] Policy sheet values align with backend normalization rules (no unsupported custom literals in active policy rows)

---

## Layer 3 - Runtime deployed

Verify the deployed container/process matches the committed code:

- [ ] Deployed image was built from the current `main` commit (`git rev-parse HEAD`)
- [ ] `GET /health` returns `200 OK` with `{ ok: true }`
- [ ] `SERVICE_VERSION` in health response matches `package.json` version
- [ ] `GET /health` dependency surface matches the intended topology: `dependencies.redis`, `dependencies.queue`, and `dependencies.worker.enabled`
- [ ] No stale environment variables from a prior deployment remain active
- [ ] Redis/BullMQ connection is live if this instance is expected to accept async work (Google Cloud Memorystore, Upstash, or Hostinger VPS)
- [ ] `QUEUE_WORKER_ENABLED` matches the instance role (`TRUE` for worker-enabled runtime, `FALSE` for API-only runtime without Redis costs)
- [ ] `BACKEND_API_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` (or equivalent) are injected

---

## Layer 4 - Live behavior confirmed

Verify governed execution paths produce expected outcomes against the live runtime:

- [ ] A dry-run site migration payload (`apply: false`) returns `execution_mode: plan_only` with no errors
- [ ] A `github_git_blob_chunk_read` dispatch resolves without `ReferenceError` (auth errors acceptable in staging)
- [ ] A `hostinger_ssh_runtime_read` dispatch resolves without `ReferenceError`
- [ ] A governed connector action (e.g. `github_unified_proxy`) reaches the execution layer without `sameServiceNativeTarget is not defined` or `retryMutationEnabled is not defined` errors
- [ ] A delegated transport action (`http_generic_api` family) resolves transport binding without `transport_required` governance rejection when the endpoint is correctly configured
- [ ] An async job enqueued via `POST /jobs` reaches `queued` or `running` status within 5 seconds when queue connectivity is expected
- [ ] If queue connectivity is unavailable, `POST /jobs` and `POST /site-migrate` return a truthful `503`
- [ ] `GET /jobs/:id` returns a valid job summary for the enqueued job
- [ ] `Execution Log Unified` receives a writeback row for a completed governed execution
- [ ] `JSON Asset Registry` receives an asset row for a CPT schema preflight execution (if triggered)

---

## Drift detection

If any Layer 2-4 check fails after a successful Layer 1 (CI) pass, the failure class is:

| Failure location | Drift class |
|---|---|
| Registry sheet missing/wrong columns | Registry schema drift |
| Wrong spreadsheet ID in env | Configuration drift |
| Deployed image is behind `main` | Deployment lag |
| Health endpoint not responding | Runtime startup failure |
| Health endpoint reports degraded queue/redis unexpectedly | Dependency topology drift |
| `apply=false` returns error | Canonical/runtime logic drift |
| Async enqueue returns `503` unexpectedly | Queue dependency failure |
| Writeback not reaching sheet | Sink connectivity failure |
| `sameServiceNativeTarget is not defined` at runtime | Deployment lag - deploy from `c3c3b15` or later |
| `retryMutationEnabled is not defined` at runtime | Deployment lag - deploy from `46affb6` or later |
| `transport_required` governance rejection on correctly-configured endpoint | Registry data gap - verify `transport_action_key` is set on endpoint row |
| Drive schema/config returns `404 File not found` for shared-drive files | Missing `supportsAllDrives` - deploy from `c3286cf` or later |

Record any drift in the deployment log and do not mark the deployment complete until all four layers pass.

---

## Version stamp

Each deployment should record:

```
Deployed commit:   <git rev-parse HEAD>
Deployed at:       <ISO timestamp>
Deployed by:       <operator>
Layer 1 (CI):      PASS / FAIL
Layer 2 (registry): PASS / FAIL / SKIP
Layer 3 (runtime):  PASS / FAIL
Layer 4 (live):     PASS / FAIL / SKIP
```
