/**
 * test-platform-routes.mjs
 *
 * HTTP smoke tests for platform route modules introduced in Sprints 02-09.
 * Tests input validation (400 responses — no DB call needed) and route
 * registration (route exists → status != 404, even if DB is unavailable → 500).
 *
 * Run: node test-platform-routes.mjs
 */

import assert from "node:assert/strict";
import express from "express";
import { buildTenantsRoutes }          from "./routes/tenantsRoutes.js";
import { buildAccessRoutes }           from "./routes/accessRoutes.js";
import { buildPlannerRoutes }          from "./routes/plannerRoutes.js";
import { buildConnectorRoutes }        from "./routes/connectorRoutes.js";
import { buildIdentityRoutes }         from "./routes/identityRoutes.js";
import { buildCustomerRoutes }         from "./routes/customerRoutes.js";
import { buildConnectedSystemsRoutes } from "./routes/connectedSystemsRoutes.js";
import { buildBootstrapRoutes }        from "./routes/bootstrapRoutes.js";

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}
function section(name) { console.log(`\n== ${name}`); }

// ── Build Express app with all tested routers ─────────────────────────────────

const DEPS = { requireBackendApiKey: (_req, _res, next) => next() };

const app = express();
app.use(express.json());
app.use(buildTenantsRoutes(DEPS));
app.use(buildAccessRoutes(DEPS));
app.use(buildPlannerRoutes(DEPS));
app.use(buildConnectorRoutes(DEPS));
app.use(buildIdentityRoutes(DEPS));
app.use(buildCustomerRoutes(DEPS));
app.use(buildConnectedSystemsRoutes(DEPS));
app.use(buildBootstrapRoutes(DEPS));

const server = app.listen(0);
await new Promise(resolve => server.once("listening", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function post(path, body, query = "") {
  const res = await fetch(`${base}${path}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function patch(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── 1. POST /tenants — input validation ───────────────────────────────────────

section("POST /tenants — input validation");

{
  const r = await post("/tenants", {});
  ok("missing tenant_type → 400", r.status === 400, `got ${r.status}`);
  ok("missing tenant_type → code missing_fields", r.body.error?.code === "missing_fields",
    `got ${r.body.error?.code}`);
}
{
  const r = await post("/tenants", { tenant_type: "brand" });
  ok("missing display_name → 400", r.status === 400, `got ${r.status}`);
}
{
  const r = await post("/tenants", { tenant_type: "invalid_type", display_name: "X" });
  ok("invalid tenant_type → 400", r.status === 400, `got ${r.status}`);
  ok("invalid tenant_type → code invalid_tenant_type", r.body.error?.code === "invalid_tenant_type",
    `got ${r.body.error?.code}`);
}

section("POST /tenants — route registered");
{
  const r = await post("/tenants", { tenant_type: "brand", display_name: "Test Brand" });
  ok("valid input → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
  ok("valid input → response has ok field", "ok" in r.body, `body: ${JSON.stringify(r.body)}`);
}

// ── 2. POST /access/resolve — input validation ────────────────────────────────

section("POST /access/resolve — input validation");

{
  const r = await post("/access/resolve", {});
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("missing tenant_id → code missing_tenant_id", r.body.error?.code === "missing_tenant_id",
    `got ${r.body.error?.code}`);
}
{
  const r = await post("/access/resolve", { tenant_id: "t1", risk_level: "extreme" });
  ok("invalid risk_level → 400", r.status === 400, `got ${r.status}`);
  ok("invalid risk_level → code invalid_risk_level", r.body.error?.code === "invalid_risk_level",
    `got ${r.body.error?.code}`);
}

section("POST /access/resolve — route registered");
{
  const r = await post("/access/resolve", { tenant_id: "t1", risk_level: "low" });
  ok("valid input → not 404", r.status !== 404, `got ${r.status}`);
  ok("response has ok field", "ok" in r.body);
}

// ── 3. POST /planner/resolve-intent — input validation ───────────────────────

section("POST /planner/resolve-intent — input validation");

{
  const r = await post("/planner/resolve-intent", {});
  ok("missing tenant_id + raw_input → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await post("/planner/resolve-intent", { tenant_id: "t1" });
  ok("missing raw_input → 400", r.status === 400, `got ${r.status}`);
}
{
  const r = await post("/planner/resolve-intent", { raw_input: "publish a post" });
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
}

section("POST /planner/resolve-intent — route registered");
{
  const r = await post("/planner/resolve-intent", { tenant_id: "t1", raw_input: "publish post" });
  ok("valid input → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 4. POST /planner/create-plan — input validation ──────────────────────────

section("POST /planner/create-plan — input validation");

{
  const r = await post("/planner/create-plan", {});
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}

// ── 5. PATCH /planner/plans/:id/status — validation ──────────────────────────

section("PATCH /planner/plans/:id/status — input validation");

{
  const r = await patch("/planner/plans/test-plan-123/status", { status: "flying" });
  ok("invalid status → 400", r.status === 400, `got ${r.status}`);
  ok("code = invalid_status", r.body.error?.code === "invalid_status",
    `got ${r.body.error?.code}`);
}
{
  const r = await patch("/planner/plans/test-plan-123/status", { status: "validated" });
  ok("valid status → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 6. POST /connector/dispatch — input validation ────────────────────────────

section("POST /connector/dispatch — input validation");

{
  const r = await post("/connector/dispatch", {});
  ok("missing plan_id and tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields",
    `got ${r.body.error?.code}`);
}

section("POST /connector/dispatch — route registered");
{
  const r = await post("/connector/dispatch", { plan_id: "00000000-0000-0000-0000-000000000001" });
  ok("plan_id provided → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
  ok("response has ok field", "ok" in r.body);
}

// ── 7. GET /connector/dispatch/status/:run_id — route registration ────────────

section("GET /connector/dispatch/status/:run_id — route registered");

{
  const r = await get("/connector/dispatch/status/00000000-0000-0000-0000-999999999999");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 8. GET /connector/history — route registration ───────────────────────────

section("GET /connector/history — route registered");

{
  const r = await get("/connector/history?tenant_id=t1");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 9. GET /planner/plans/:id — route registration ───────────────────────────

section("GET /planner/plans/:id — route registered");

{
  const r = await get("/planner/plans/00000000-0000-0000-0000-000000000001");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 10. POST /planner/plans/:id/execute — route registration ─────────────────

section("POST /planner/plans/:id/execute — route registered");

{
  const r = await post("/planner/plans/00000000-0000-0000-0000-000000000001/execute", {});
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 11. GET /tenants — route registered ──────────────────────────────────────

section("GET /tenants — route registered");

{
  const r = await get("/tenants");
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

// ── 12. POST /customers — route registered ───────────────────────────────────

section("POST /customers — route registered");

{
  const r = await post("/customers", {});
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

// ── 13. GET /tenants/:id/connected-systems — route registered ────────────────

section("GET /tenants/:id/connected-systems — route registered");

{
  const r = await get("/tenants/t1/connected-systems");
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

server.close();

console.log(`\n── Results ──`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll tests passed.");
