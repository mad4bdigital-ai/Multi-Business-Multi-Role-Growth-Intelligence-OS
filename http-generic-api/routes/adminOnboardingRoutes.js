import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

function cleanText(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function cleanPriority(value) {
  const normalized = cleanText(value || "urgent", 20).toLowerCase();
  return VALID_PRIORITIES.has(normalized) ? normalized : "urgent";
}

function cleanRole(value) {
  const normalized = cleanText(value || "owner", 20).toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : "owner";
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function fetchActiveUser(connection, userId) {
  const [rows] = await connection.query(
    "SELECT user_id, email, display_name, status FROM `users` WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const user = rows[0] || null;
  return user?.status === "active" ? user : null;
}

async function fetchFirstActiveMembership(connection, userId) {
  const [rows] = await connection.query(
    `SELECT m.tenant_id, m.role, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function createWorkspaceForUser(userId, { displayName = null, source = "admin_onboarding_create_workspace" } = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const user = await fetchActiveUser(connection, userId);
    if (!user) {
      const err = new Error("User not found or inactive.");
      err.status = 404;
      err.code = "user_not_found";
      throw err;
    }

    const existing = await fetchFirstActiveMembership(connection, userId);
    if (existing) {
      await connection.commit();
      return {
        created: false,
        user,
        tenant_id: existing.tenant_id,
        display_name: existing.tenant_display_name,
        role: existing.role,
      };
    }

    const tenantId = randomUUID();
    const tenantName = cleanText(displayName, 120) || `${user.display_name || user.email || "User"}'s workspace`;
    await connection.query(
      `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
       VALUES (?, 'managed_client_account', ?, 'active', ?)`,
      [tenantId, tenantName, JSON.stringify({ source, repaired_user_id: userId })]
    );
    await connection.query(
      `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
       VALUES (?, ?, 'owner', 'active')`,
      [userId, tenantId]
    );
    await connection.query(
      `UPDATE \`onboarding_escalations\`
          SET tenant_id = COALESCE(tenant_id, ?), status = IF(status = 'open', 'in_review', status)
        WHERE user_id = ? AND tenant_id IS NULL`,
      [tenantId, userId]
    ).catch(() => {});
    await connection.commit();
    return { created: true, user, tenant_id: tenantId, display_name: tenantName, role: "owner" };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function attachMembership(userId, tenantId, { role = "owner" } = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const user = await fetchActiveUser(connection, userId);
    if (!user) {
      const err = new Error("User not found or inactive.");
      err.status = 404;
      err.code = "user_not_found";
      throw err;
    }
    const [tenantRows] = await connection.query(
      "SELECT tenant_id, display_name FROM `tenants` WHERE tenant_id = ? AND status = 'active' LIMIT 1",
      [tenantId]
    );
    const tenant = tenantRows[0] || null;
    if (!tenant) {
      const err = new Error("Target tenant not found or inactive.");
      err.status = 404;
      err.code = "tenant_not_found";
      throw err;
    }
    const finalRole = cleanRole(role);
    await connection.query(
      `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
       VALUES (?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', updated_at = CURRENT_TIMESTAMP`,
      [userId, tenantId, finalRole]
    );
    await connection.query(
      `UPDATE \`onboarding_escalations\`
          SET tenant_id = COALESCE(tenant_id, ?), status = IF(status = 'open', 'in_review', status)
        WHERE user_id = ? AND tenant_id IS NULL`,
      [tenantId, userId]
    ).catch(() => {});
    await connection.commit();
    return { user, tenant, role: finalRole };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function createEscalationForUser(userId, body = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    const user = await fetchActiveUser(connection, userId);
    if (!user) {
      const err = new Error("User not found or inactive.");
      err.status = 404;
      err.code = "user_not_found";
      throw err;
    }
    const membership = await fetchFirstActiveMembership(connection, userId);
    const tenantId = cleanText(body.tenant_id, 36) || membership?.tenant_id || null;
    const title = cleanText(body.title || "Admin-created onboarding escalation", 512);
    const priority = cleanPriority(body.priority);
    const escalationId = randomUUID();
    let ticketId = null;

    await connection.beginTransaction();
    if (tenantId) {
      ticketId = randomUUID();
      await connection.query(
        `INSERT INTO \`tickets\` (ticket_id, tenant_id, title, category, priority, service_mode, metadata_json)
         VALUES (?, ?, ?, 'escalation', ?, 'managed', ?)`,
        [ticketId, tenantId, title, priority, JSON.stringify({ body: body.body || null, source: "admin_onboarding_escalate", metadata: safeMetadata(body.metadata_json) })]
      );
    }
    await connection.query(
      `INSERT INTO \`onboarding_escalations\`
         (escalation_id, tenant_id, user_id, email, title, body, category, priority, status, source, metadata_json, ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, 'escalation', ?, 'open', 'admin_onboarding_escalate', ?, ?)`,
      [escalationId, tenantId, user.user_id, user.email, title, body.body || null, priority, JSON.stringify(safeMetadata(body.metadata_json)), ticketId]
    );
    await connection.commit();
    return { escalation_id: escalationId, ticket_id: ticketId, tenant_id: tenantId, title, priority };
  } catch (err) {
    try { await connection.rollback(); } catch {}
    throw err;
  } finally {
    connection.release();
  }
}

export function buildAdminOnboardingRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter((fn) => typeof fn === "function");

  router.get("/admin/onboarding/tenantless-users", ...adminGuards, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const [rows] = await getPool().query(
        `SELECT u.user_id, u.email, u.display_name, u.created_at,
                COUNT(e.id) AS escalation_count,
                MAX(e.created_at) AS last_escalation_at
           FROM \`users\` u
           LEFT JOIN \`memberships\` m ON m.user_id = u.user_id AND m.status = 'active'
           LEFT JOIN \`onboarding_escalations\` e ON e.user_id = u.user_id AND e.status IN ('open','in_review')
          WHERE u.status = 'active' AND m.user_id IS NULL
          GROUP BY u.user_id, u.email, u.display_name, u.created_at
          ORDER BY COALESCE(MAX(e.created_at), u.created_at) DESC
          LIMIT ?`,
        [limit]
      );
      return res.status(200).json({ ok: true, users: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tenantless_users_read_failed", message: err.message } });
    }
  });

  router.get("/admin/onboarding/escalations", ...adminGuards, async (req, res) => {
    try {
      const status = cleanText(req.query.status, 32);
      const params = [];
      let where = "1=1";
      if (status) { where += " AND e.status = ?"; params.push(status); }
      params.push(Math.min(Number(req.query.limit) || 100, 500));
      const [rows] = await getPool().query(
        `SELECT e.escalation_id, e.ticket_id, e.tenant_id, e.user_id, e.email, e.title,
                e.priority, e.status, e.source, e.created_at, u.display_name
           FROM \`onboarding_escalations\` e
           LEFT JOIN \`users\` u ON u.user_id = e.user_id
          WHERE ${where}
          ORDER BY e.created_at DESC
          LIMIT ?`,
        params
      );
      return res.status(200).json({ ok: true, escalations: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "onboarding_escalations_read_failed", message: err.message } });
    }
  });

  router.post("/admin/onboarding/:user_id/create-workspace", ...adminGuards, async (req, res) => {
    try {
      const result = await createWorkspaceForUser(req.params.user_id, {
        displayName: req.body?.display_name || req.body?.tenant_display_name,
        source: "admin_onboarding_create_workspace",
      });
      return res.status(result.created ? 201 : 200).json({
        ok: true,
        created: result.created,
        user: { user_id: result.user.user_id, email: result.user.email, display_name: result.user.display_name },
        tenant: { tenant_id: result.tenant_id, display_name: result.display_name, role: result.role },
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "admin_workspace_create_failed", message: err.message } });
    }
  });

  router.post("/admin/onboarding/:user_id/repair-membership", ...adminGuards, async (req, res) => {
    try {
      if (!req.body?.tenant_id) {
        const result = await createWorkspaceForUser(req.params.user_id, {
          displayName: req.body?.display_name || req.body?.tenant_display_name,
          source: "admin_onboarding_repair_membership_new_workspace",
        });
        return res.status(result.created ? 201 : 200).json({ ok: true, repaired: true, created_workspace: result.created, tenant: { tenant_id: result.tenant_id, display_name: result.display_name, role: result.role } });
      }
      const result = await attachMembership(req.params.user_id, req.body.tenant_id, { role: req.body.role || "owner" });
      return res.status(200).json({ ok: true, repaired: true, user_id: result.user.user_id, tenant: result.tenant, role: result.role });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "admin_membership_repair_failed", message: err.message } });
    }
  });

  router.post("/admin/onboarding/:user_id/escalate", ...adminGuards, async (req, res) => {
    try {
      const escalation = await createEscalationForUser(req.params.user_id, req.body || {});
      return res.status(201).json({ ok: true, escalation });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "admin_onboarding_escalate_failed", message: err.message } });
    }
  });

  router.post("/admin/onboarding/:user_id/link-session-archive", ...adminGuards, async (req, res) => {
    try {
      const tenantId = cleanText(req.body?.tenant_id, 36);
      if (!tenantId) return res.status(400).json({ ok: false, error: { code: "missing_tenant_id", message: "tenant_id is required." } });
      const [membershipRows] = await getPool().query(
        "SELECT 1 FROM `memberships` WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1",
        [req.params.user_id, tenantId]
      );
      if (!membershipRows.length) return res.status(403).json({ ok: false, error: { code: "tenant_membership_required", message: "User must have active membership before archive relink." } });

      const [sessions] = await getPool().query(
        `UPDATE \`customer_sessions\`
            SET tenant_id = ?
          WHERE user_id = ? AND tenant_id = ? AND originator = 'gpt_action'`,
        [tenantId, req.params.user_id, PLATFORM_TENANT_ID]
      );
      const [turns] = await getPool().query(
        `UPDATE \`session_turns\`
            SET tenant_id = ?
          WHERE tenant_id = ? AND session_id IN (
            SELECT session_id FROM \`customer_sessions\` WHERE user_id = ? AND tenant_id = ?
          )`,
        [tenantId, PLATFORM_TENANT_ID, req.params.user_id, tenantId]
      ).catch(() => [{ affectedRows: 0 }]);
      return res.status(200).json({ ok: true, user_id: req.params.user_id, tenant_id: tenantId, updated: { customer_sessions: sessions.affectedRows || 0, session_turns: turns.affectedRows || 0 } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "session_archive_relink_failed", message: err.message } });
    }
  });

  return router;
}
