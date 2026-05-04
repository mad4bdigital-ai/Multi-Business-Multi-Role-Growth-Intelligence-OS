/**
 * Access Decision Engine — Sprint 06
 *
 * Resolves one of 6 outcomes based on:
 *   access = role + scope + entitlement + commercial_state + policy
 *
 * Outcomes:
 *   ALLOW_SELF_SERVE             — proceed immediately, no human needed
 *   ALLOW_WITH_OPTIONAL_ASSISTANCE — allowed but assistance is available
 *   REQUIRE_REVIEW               — must pass a reviewer before execution
 *   REQUIRE_SUPERVISOR_APPROVAL  — escalated approval required
 *   ROUTE_TO_MANAGED_SERVICE     — hand off to managed service operator
 *   DENY                         — blocked entirely
 */

import { getPool } from "./db.js";

// ── Risk thresholds ────────────────────────────────────────────────────────────
const RISK = { low: 1, medium: 2, high: 3, critical: 4 };

function riskScore(level) {
  return RISK[level] || 1;
}

// ── Load tenant context from DB ───────────────────────────────────────────────
async function loadTenantContext(tenant_id) {
  const pool = getPool();

  const [[tenantRow]] = await pool.query(
    "SELECT tenant_type, status FROM `tenants` WHERE tenant_id = ? LIMIT 1",
    [tenant_id]
  );
  if (!tenantRow || tenantRow.status !== "active") return null;

  // Active subscription + plan
  const [[subRow]] = await pool.query(
    `SELECT s.status AS sub_status, p.plan_key, p.service_mode
     FROM \`subscriptions\` s
     JOIN \`plans\` p ON p.plan_id = s.plan_id
     WHERE s.tenant_id = ? AND s.status = 'active'
     ORDER BY s.started_at DESC LIMIT 1`,
    [tenant_id]
  );

  // Entitlements
  const [entitlementRows] = await pool.query(
    `SELECT entitlement_key, entitlement_value
     FROM \`entitlements\`
     WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [tenant_id]
  );

  const entitlements = {};
  for (const { entitlement_key, entitlement_value } of entitlementRows) {
    entitlements[entitlement_key] = entitlement_value;
  }

  return {
    tenant_type: tenantRow.tenant_type,
    plan_key: subRow?.plan_key || null,
    service_mode: subRow?.service_mode || "self_serve",
    commercial_active: Boolean(subRow),
    entitlements,
  };
}

// ── Load user membership for tenant ──────────────────────────────────────────
async function loadMembership(user_id, tenant_id) {
  if (!user_id) return null;
  const [[row]] = await getPool().query(
    "SELECT role, status FROM `memberships` WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1",
    [user_id, tenant_id]
  );
  return row || null;
}

// ── Core decision logic ───────────────────────────────────────────────────────
function computeDecision({ tenant_ctx, membership, risk_level, intent_flags = {} }) {
  const risk = riskScore(risk_level);

  // No tenant or commercial state → deny
  if (!tenant_ctx) return { decision: "DENY", reason: "tenant_not_found_or_inactive" };
  if (!tenant_ctx.commercial_active) return { decision: "DENY", reason: "no_active_subscription" };

  const mode = tenant_ctx.service_mode;
  const role  = membership?.role || "guest";

  // Fully managed tenants always route to operator
  if (mode === "managed") {
    return { decision: "ROUTE_TO_MANAGED_SERVICE", reason: "tenant_on_managed_plan" };
  }

  // Guest with no membership → deny unless public scope
  if (role === "guest" && !intent_flags.public_scope) {
    return { decision: "DENY", reason: "no_active_membership" };
  }

  // Critical risk always requires supervisor
  if (risk >= RISK.critical) {
    return { decision: "REQUIRE_SUPERVISOR_APPROVAL", reason: "critical_risk_operation" };
  }

  // High risk + assisted mode → require review
  if (risk >= RISK.high) {
    if (mode === "assisted") {
      return { decision: "REQUIRE_REVIEW", reason: "high_risk_assisted_mode" };
    }
    // Self-serve + high risk → supervisor
    return { decision: "REQUIRE_SUPERVISOR_APPROVAL", reason: "high_risk_self_serve" };
  }

  // Medium risk on assisted plan
  if (risk >= RISK.medium && mode === "assisted") {
    return { decision: "ALLOW_WITH_OPTIONAL_ASSISTANCE", reason: "medium_risk_assistance_available" };
  }

  // Destructive operations (flagged by caller)
  if (intent_flags.destructive) {
    if (role === "admin" || role === "owner") {
      return { decision: "REQUIRE_REVIEW", reason: "destructive_op_requires_review" };
    }
    return { decision: "DENY", reason: "destructive_op_role_insufficient" };
  }

  // Low risk self-serve → allow
  return { decision: "ALLOW_SELF_SERVE", reason: "low_risk_self_serve" };
}

// ── Public: resolve access for a request ─────────────────────────────────────
export async function resolveAccess({ tenant_id, user_id, risk_level = "low", intent_flags = {}, persist = false }) {
  if (!tenant_id) {
    return { decision: "DENY", reason: "tenant_id_required", resolved_at: new Date().toISOString() };
  }

  const [tenant_ctx, membership] = await Promise.all([
    loadTenantContext(tenant_id),
    loadMembership(user_id, tenant_id),
  ]);

  const { decision, reason } = computeDecision({ tenant_ctx, membership, risk_level, intent_flags });

  const resolved_at = new Date().toISOString();

  if (persist) {
    try {
      const { randomUUID } = await import("node:crypto");
      const envelope_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`request_envelopes\`
           (envelope_id, tenant_id, user_id, risk_level, access_decision, decision_reason, service_mode, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          envelope_id,
          tenant_id,
          user_id || null,
          risk_level,
          decision,
          reason,
          tenant_ctx?.service_mode || "self_serve",
        ]
      );
    } catch { /* non-blocking — log only */ }
  }

  return {
    decision,
    reason,
    tenant_id,
    user_id: user_id || null,
    risk_level,
    service_mode: tenant_ctx?.service_mode || null,
    plan_key: tenant_ctx?.plan_key || null,
    resolved_at,
  };
}

// ── Convenience: check if decision allows execution ──────────────────────────
export function decisionAllowsExecution(decision) {
  return decision === "ALLOW_SELF_SERVE" || decision === "ALLOW_WITH_OPTIONAL_ASSISTANCE";
}

export const DECISIONS = {
  ALLOW_SELF_SERVE: "ALLOW_SELF_SERVE",
  ALLOW_WITH_OPTIONAL_ASSISTANCE: "ALLOW_WITH_OPTIONAL_ASSISTANCE",
  REQUIRE_REVIEW: "REQUIRE_REVIEW",
  REQUIRE_SUPERVISOR_APPROVAL: "REQUIRE_SUPERVISOR_APPROVAL",
  ROUTE_TO_MANAGED_SERVICE: "ROUTE_TO_MANAGED_SERVICE",
  DENY: "DENY",
};
