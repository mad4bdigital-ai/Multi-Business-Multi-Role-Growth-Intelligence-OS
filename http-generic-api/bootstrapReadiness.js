/**
 * Bootstrap Readiness — Sprint 12
 *
 * Runs the 8 first-execution readiness checks for a tenant before any
 * execution is allowed. Each check is independent and can pass/fail/warn.
 *
 * Checks:
 *   1. active_tenant_context      — tenant exists and is active
 *   2. active_membership          — at least one active membership
 *   3. commercial_eligibility     — active subscription on a real plan
 *   4. connector_available        — at least one active connected system
 *   5. workspace_bootstrapped     — at least one workspace in ready state (or brand row exists)
 *   6. policy_path_resolved       — execution_policies table has at least one active row
 *   7. review_path_resolved       — assistance_roles seeded (review capacity exists)
 *   8. managed_assignment_ready   — managed plan has managed_service_operator role seeded
 */

import { getPool } from "./db.js";

const CHECKS = [
  "active_tenant_context",
  "active_membership",
  "commercial_eligibility",
  "connector_available",
  "workspace_bootstrapped",
  "policy_path_resolved",
  "review_path_resolved",
  "managed_assignment_ready",
];

async function checkActiveTenantContext(tenant_id) {
  const [[row]] = await getPool().query(
    "SELECT status FROM `tenants` WHERE tenant_id = ? LIMIT 1", [tenant_id]
  );
  if (!row) return { status: "fail", detail: "Tenant not found." };
  if (row.status !== "active") return { status: "fail", detail: `Tenant status is '${row.status}', expected 'active'.` };
  return { status: "pass", detail: "Tenant is active." };
}

async function checkActiveMembership(tenant_id) {
  const [[row]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `memberships` WHERE tenant_id = ? AND status = 'active'", [tenant_id]
  );
  if (!row || row.cnt === 0) return { status: "fail", detail: "No active memberships for this tenant." };
  return { status: "pass", detail: `${row.cnt} active membership(s).` };
}

async function checkCommercialEligibility(tenant_id) {
  const [[row]] = await getPool().query(
    `SELECT s.status, p.plan_key FROM \`subscriptions\` s
     JOIN \`plans\` p ON p.plan_id = s.plan_id
     WHERE s.tenant_id = ? AND s.status = 'active' LIMIT 1`,
    [tenant_id]
  );
  if (!row) return { status: "fail", detail: "No active subscription found." };
  return { status: "pass", detail: `Active subscription on plan '${row.plan_key}'.` };
}

async function checkConnectorAvailable(tenant_id) {
  // Check connected_systems table first, fall back to brands table (legacy)
  const [[csRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `connected_systems` WHERE tenant_id = ? AND status = 'active'", [tenant_id]
  );
  if (csRow && csRow.cnt > 0) return { status: "pass", detail: `${csRow.cnt} active connected system(s).` };

  // Fall back to brands table via brand_domain match
  const [[brandRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `brands` WHERE status = 'active' LIMIT 1"
  );
  if (brandRow && brandRow.cnt > 0) {
    return { status: "warn", detail: "No connected systems registered for tenant; legacy brand connectors available." };
  }
  return { status: "fail", detail: "No active connectors available for this tenant." };
}

async function checkWorkspaceBootstrapped(tenant_id) {
  // Check workspace_registry for a ready workspace
  const [[wsRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `workspace_registry` WHERE tenant_id = ? AND bootstrap_status = 'ready'",
    [tenant_id]
  );
  if (wsRow && wsRow.cnt > 0) return { status: "pass", detail: `${wsRow.cnt} bootstrapped workspace(s).` };

  // Warn if workspaces exist but none ready yet
  const [[anyWs]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `workspace_registry` WHERE tenant_id = ?", [tenant_id]
  );
  if (anyWs && anyWs.cnt > 0) return { status: "warn", detail: "Workspace(s) exist but none have reached ready status." };

  // Legacy: site_runtime_inventory counts as bootstrapped
  const [[sriRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `site_runtime_inventory` WHERE active_status = 'active' LIMIT 1"
  );
  if (sriRow && sriRow.cnt > 0) {
    return { status: "warn", detail: "No workspaces in workspace_registry; legacy site_runtime_inventory is populated." };
  }
  return { status: "fail", detail: "No workspaces registered or bootstrapped for this tenant." };
}

async function checkPolicyPathResolved(_tenant_id) {
  const [[row]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `execution_policies` WHERE active = 'true' OR active = '1' OR active = 1 LIMIT 1"
  );
  if (!row || row.cnt === 0) return { status: "fail", detail: "No active execution policies found." };
  return { status: "pass", detail: `${row.cnt} active execution policy row(s).` };
}

async function checkReviewPathResolved(_tenant_id) {
  const [[row]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `assistance_roles` WHERE active = 1 AND level >= 2"
  );
  if (!row || row.cnt === 0) return { status: "fail", detail: "No certified reviewer roles seeded — review path unavailable." };
  return { status: "pass", detail: `${row.cnt} review-capable assistance role(s) available.` };
}

async function checkManagedAssignmentReady(tenant_id) {
  // Only required for managed-plan tenants
  const [[subRow]] = await getPool().query(
    `SELECT p.service_mode FROM \`subscriptions\` s
     JOIN \`plans\` p ON p.plan_id = s.plan_id
     WHERE s.tenant_id = ? AND s.status = 'active' LIMIT 1`,
    [tenant_id]
  );
  if (!subRow || subRow.service_mode !== "managed") {
    return { status: "pass", detail: "Not on a managed plan — managed assignment not required." };
  }
  const [[opRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM `assistance_roles` WHERE role_key = 'managed_service_operator' AND active = 1"
  );
  if (!opRow || opRow.cnt === 0) {
    return { status: "fail", detail: "Managed plan detected but managed_service_operator role not seeded." };
  }
  return { status: "pass", detail: "Managed service operator role available." };
}

const CHECK_FNS = {
  active_tenant_context:   checkActiveTenantContext,
  active_membership:       checkActiveMembership,
  commercial_eligibility:  checkCommercialEligibility,
  connector_available:     checkConnectorAvailable,
  workspace_bootstrapped:  checkWorkspaceBootstrapped,
  policy_path_resolved:    checkPolicyPathResolved,
  review_path_resolved:    checkReviewPathResolved,
  managed_assignment_ready: checkManagedAssignmentReady,
};

// ── Public: run all 8 checks for a tenant ────────────────────────────────────
export async function runReadinessChecks(tenant_id, { persist = false } = {}) {
  const results = {};
  let overall = "pass";

  await Promise.all(
    CHECKS.map(async (key) => {
      try {
        const fn = CHECK_FNS[key];
        results[key] = await fn(tenant_id);
      } catch (err) {
        results[key] = { status: "fail", detail: `Check error: ${err.message}` };
      }

      if (results[key].status === "fail") overall = "fail";
      else if (results[key].status === "warn" && overall !== "fail") overall = "warn";
    })
  );

  const ready = overall === "pass";

  if (persist) {
    try {
      const { randomUUID } = await import("node:crypto");
      const pool = getPool();
      await Promise.all(
        CHECKS.map((key) =>
          pool.query(
            `INSERT INTO \`readiness_checks\` (check_id, tenant_id, check_key, check_status, detail)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), tenant_id, key, results[key].status, results[key].detail || null]
          )
        )
      );
    } catch { /* non-blocking */ }
  }

  return { ready, overall_status: overall, tenant_id, checks: results };
}

export { CHECKS };
