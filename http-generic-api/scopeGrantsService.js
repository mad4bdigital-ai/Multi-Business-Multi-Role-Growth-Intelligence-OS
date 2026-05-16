/**
 * Admin Scope Grants — Sprint 55
 *
 * Resolves tenant access to normally admin-only DB tools when an active
 * admin_scope_grant row authorises it. The dispatcher in gptToolsRoutes.js
 * calls findActiveGrantForTool before falling back to a tool_not_found
 * response on the tenant table. validateArgsAgainstGrant enforces
 * allowed_actions and allowed_args constraints stored on the grant.
 */

import { getPool } from "./db.js";

function parseJsonField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function rowToGrant(row) {
  if (!row) return null;
  return {
    grant_id: row.grant_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    source_tool_key: row.source_tool_key,
    allowed_actions: parseJsonField(row.allowed_actions),
    allowed_args: parseJsonField(row.allowed_args),
    reason: row.reason,
    granted_by: row.granted_by,
    granted_at: row.granted_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    revoked_by: row.revoked_by,
    last_used_at: row.last_used_at,
    use_count: row.use_count,
  };
}

export async function findActiveGrantForTool(tenantId, userId, toolKey) {
  if (!tenantId || !userId || !toolKey) return null;
  const [rows] = await getPool().query(
    `SELECT grant_id, tenant_id, user_id, source_tool_key, allowed_actions, allowed_args,
            reason, granted_by, granted_at, expires_at, revoked_at, revoked_by,
            last_used_at, use_count
       FROM \`admin_scope_grants\`
      WHERE tenant_id = ?
        AND user_id = ?
        AND source_tool_key = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY granted_at DESC
      LIMIT 1`,
    [tenantId, userId, toolKey]
  );
  return rowToGrant(rows[0] || null);
}

export async function listGrantsForUser(tenantId, userId, { activeOnly = true } = {}) {
  if (!tenantId || !userId) return [];
  const activeFilter = activeOnly
    ? "AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())"
    : "";
  const [rows] = await getPool().query(
    `SELECT grant_id, tenant_id, user_id, source_tool_key, allowed_actions, allowed_args,
            reason, granted_by, granted_at, expires_at, revoked_at, revoked_by,
            last_used_at, use_count
       FROM \`admin_scope_grants\`
      WHERE tenant_id = ? AND user_id = ? ${activeFilter}
      ORDER BY granted_at DESC
      LIMIT 100`,
    [tenantId, userId]
  );
  return rows.map(rowToGrant);
}

export async function listGrantsForAdmin({ tenantId, userId, sourceToolKey, activeOnly = true, limit = 50 } = {}) {
  const filters = [];
  const params = [];
  if (tenantId) { filters.push("tenant_id = ?"); params.push(tenantId); }
  if (userId) { filters.push("user_id = ?"); params.push(userId); }
  if (sourceToolKey) { filters.push("source_tool_key = ?"); params.push(sourceToolKey); }
  if (activeOnly) {
    filters.push("revoked_at IS NULL");
    filters.push("(expires_at IS NULL OR expires_at > NOW())");
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  params.push(safeLimit);
  const [rows] = await getPool().query(
    `SELECT grant_id, tenant_id, user_id, source_tool_key, allowed_actions, allowed_args,
            reason, granted_by, granted_at, expires_at, revoked_at, revoked_by,
            last_used_at, use_count
       FROM \`admin_scope_grants\`
       ${where}
      ORDER BY granted_at DESC
      LIMIT ?`,
    params
  );
  return rows.map(rowToGrant);
}

export function validateArgsAgainstGrant(grant, args = {}) {
  if (!grant) return { ok: false, reason: "no_grant" };
  const allowedActions = Array.isArray(grant.allowed_actions) ? grant.allowed_actions : null;
  if (allowedActions && allowedActions.length > 0) {
    const requestedAction = args && typeof args === "object" ? args.action : undefined;
    if (requestedAction === undefined || !allowedActions.includes(String(requestedAction))) {
      return {
        ok: false,
        reason: "action_not_in_grant",
        message: `Grant ${grant.grant_id} restricts actions to: ${allowedActions.join(", ")}. Requested action: ${requestedAction ?? "(none)"}.`,
        details: { allowed_actions: allowedActions, requested_action: requestedAction ?? null },
      };
    }
  }

  const allowedArgs = grant.allowed_args && typeof grant.allowed_args === "object" ? grant.allowed_args : null;
  if (allowedArgs) {
    for (const [key, constraint] of Object.entries(allowedArgs)) {
      const requested = args?.[key];
      if (Array.isArray(constraint)) {
        if (constraint.length === 0) continue;
        if (!constraint.map(String).includes(String(requested))) {
          return {
            ok: false,
            reason: "arg_value_not_in_grant",
            message: `Grant ${grant.grant_id} restricts arg '${key}' to one of: ${constraint.join(", ")}. Requested: ${requested ?? "(missing)"}.`,
            details: { arg: key, allowed: constraint, requested: requested ?? null },
          };
        }
        continue;
      }
      if (constraint !== null && constraint !== undefined && typeof constraint !== "object") {
        if (String(requested) !== String(constraint)) {
          return {
            ok: false,
            reason: "arg_value_not_in_grant",
            message: `Grant ${grant.grant_id} pins arg '${key}' to '${constraint}'. Requested: ${requested ?? "(missing)"}.`,
            details: { arg: key, pinned: constraint, requested: requested ?? null },
          };
        }
        continue;
      }
    }
  }

  return { ok: true };
}

export async function recordGrantUse(grantId) {
  if (!grantId) return;
  await getPool().query(
    `UPDATE \`admin_scope_grants\`
        SET last_used_at = NOW(), use_count = use_count + 1
      WHERE grant_id = ?`,
    [grantId]
  ).catch(() => {});
}

export async function adminToolExists(toolKey) {
  if (!toolKey) return false;
  const [rows] = await getPool().query(
    `SELECT 1 FROM \`admin_platform_endpoint_tools\`
      WHERE tool_key = ? AND is_enabled = 1 LIMIT 1`,
    [toolKey]
  );
  return rows.length > 0;
}
