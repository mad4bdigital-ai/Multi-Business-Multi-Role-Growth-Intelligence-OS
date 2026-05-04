/**
 * Audit Logger — Sprint 16
 *
 * Write-only append to audit_log. Never UPDATE or DELETE from this table.
 * Designed to be called from any route handler without blocking the response.
 */

import { getPool } from "./db.js";
import { randomUUID } from "node:crypto";

export async function writeAuditLog({
  tenant_id = null,
  actor_id = null,
  actor_type = null,
  action,
  resource_type = null,
  resource_id = null,
  before_json = null,
  after_json = null,
  ip_address = null,
  user_agent = null,
  service_mode = "self_serve",
} = {}) {
  if (!action) throw new Error("auditLogger: action is required");
  const audit_id = randomUUID();
  await getPool().query(
    `INSERT INTO \`audit_log\`
       (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
        before_json, after_json, ip_address, user_agent, service_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      audit_id, tenant_id, actor_id, actor_type, action,
      resource_type, resource_id,
      before_json ? JSON.stringify(before_json) : null,
      after_json  ? JSON.stringify(after_json)  : null,
      ip_address, user_agent, service_mode,
    ]
  );
  return audit_id;
}

// Fire-and-forget version for use inside route handlers where we don't want
// audit failures to affect the HTTP response.
export function writeAuditLogAsync(params) {
  writeAuditLog(params).catch(() => { /* suppress — audit must not break the request */ });
}
