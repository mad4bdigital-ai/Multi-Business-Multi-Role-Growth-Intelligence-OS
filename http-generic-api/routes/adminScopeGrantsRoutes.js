/**
 * Admin Scope Grants routes — Sprint 55
 *
 * POST   /admin/scope-grants         (admin only)
 * GET    /admin/scope-grants         (admin only)
 * DELETE /admin/scope-grants/:grant_id (admin only)
 * GET    /me/scope-grants            (user JWT, scoped to self)
 *
 * Backend only — UI for grant management is deferred.
 *
 * Dispatcher consultation happens inside gptToolsRoutes via
 * scopeGrantsService.findActiveGrantForTool.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { writeAuditLogAsync } from "../auditLogger.js";
import {
  adminToolExists,
  listGrantsForAdmin,
  listGrantsForUser,
} from "../scopeGrantsService.js";

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseExpiresAt(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function sanitizeAllowedActions(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.map((entry) => String(entry).trim()).filter(Boolean);
  return cleaned.length ? cleaned : [];
}

function sanitizeAllowedArgs(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function principalAuditFields(req) {
  return {
    actor_id: req?.auth?.user_id || null,
    actor_type: req?.auth?.mode || (req?.auth?.is_admin ? "backend_api_key" : null),
    ip_address: req?.ip || null,
    user_agent: req?.headers?.["user-agent"] || null,
  };
}

export function buildAdminScopeGrantsRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal, requireUserJwt } = deps;
  const router = Router();

  function adminOnly(req, res, next) {
    if (typeof requireAdminPrincipal === "function") return requireAdminPrincipal(req, res, next);
    if (req.auth?.is_admin === true) return next();
    return res.status(403).json({
      ok: false,
      error: { code: "admin_backend_api_key_required", message: "Admin BACKEND_API_KEY required.", status: 403 },
    });
  }

  function userScopeOnly(req, res, next) {
    if (req.auth?.mode === "user_jwt" && req.auth?.user_id) return next();
    if (req.auth?.mode === "api_credential" && req.auth?.user_id) return next();
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign-in required to read your scope grants." },
    });
  }

  router.post("/admin/scope-grants", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = String(body.tenant_id || "").trim();
      const userId = String(body.user_id || "").trim();
      const sourceToolKey = String(body.source_tool_key || "").trim();
      const reason = body.reason ? String(body.reason).trim().slice(0, 2000) : null;

      if (!isUuidLike(tenantId)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_tenant_id", message: "tenant_id must be a UUID." } });
      }
      if (!isUuidLike(userId)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_user_id", message: "user_id must be a UUID." } });
      }
      if (!sourceToolKey) {
        return res.status(400).json({ ok: false, error: { code: "missing_source_tool_key", message: "source_tool_key is required." } });
      }
      const exists = await adminToolExists(sourceToolKey);
      if (!exists) {
        return res.status(404).json({
          ok: false,
          error: { code: "source_tool_not_found", message: `source_tool_key '${sourceToolKey}' is not registered in admin_platform_endpoint_tools or is disabled.` },
        });
      }

      const allowedActions = sanitizeAllowedActions(body.allowed_actions);
      if (allowedActions === undefined) {
        return res.status(400).json({ ok: false, error: { code: "invalid_allowed_actions", message: "allowed_actions must be an array of strings when provided." } });
      }
      const allowedArgs = sanitizeAllowedArgs(body.allowed_args);
      if (allowedArgs === undefined) {
        return res.status(400).json({ ok: false, error: { code: "invalid_allowed_args", message: "allowed_args must be a JSON object when provided." } });
      }
      const expiresAt = parseExpiresAt(body.expires_at);
      if (expiresAt === undefined) {
        return res.status(400).json({ ok: false, error: { code: "invalid_expires_at", message: "expires_at must be a valid date-time string." } });
      }

      const grantId = randomUUID();
      const grantedBy = req.auth?.user_id || req.auth?.mode || "admin";
      const expiresValue = expiresAt instanceof Date ? expiresAt.toISOString().slice(0, 19).replace("T", " ") : null;

      await getPool().query(
        `INSERT INTO \`admin_scope_grants\`
           (grant_id, tenant_id, user_id, source_tool_key, allowed_actions, allowed_args, reason, granted_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          grantId, tenantId, userId, sourceToolKey,
          allowedActions ? JSON.stringify(allowedActions) : null,
          allowedArgs ? JSON.stringify(allowedArgs) : null,
          reason, grantedBy, expiresValue,
        ]
      );

      const audit = principalAuditFields(req);
      writeAuditLogAsync({
        tenant_id: tenantId,
        action: "admin_scope_grant_create",
        resource_type: "admin_scope_grant",
        resource_id: grantId,
        after_json: { tenant_id: tenantId, user_id: userId, source_tool_key: sourceToolKey, allowed_actions: allowedActions, allowed_args: allowedArgs, expires_at: expiresValue, reason },
        ...audit,
      });

      return res.status(201).json({
        ok: true,
        grant: {
          grant_id: grantId,
          tenant_id: tenantId,
          user_id: userId,
          source_tool_key: sourceToolKey,
          allowed_actions: allowedActions,
          allowed_args: allowedArgs,
          reason,
          granted_by: grantedBy,
          expires_at: expiresValue,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "scope_grant_create_failed", message: err.message } });
    }
  });

  router.get("/admin/scope-grants", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      const grants = await listGrantsForAdmin({
        tenantId: req.query.tenant_id ? String(req.query.tenant_id) : null,
        userId: req.query.user_id ? String(req.query.user_id) : null,
        sourceToolKey: req.query.source_tool_key ? String(req.query.source_tool_key) : null,
        activeOnly: String(req.query.active_only ?? "true").toLowerCase() !== "false",
        limit: req.query.limit,
      });
      return res.status(200).json({ ok: true, count: grants.length, grants });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "scope_grant_list_failed", message: err.message } });
    }
  });

  router.delete("/admin/scope-grants/:grant_id", requireBackendApiKey, adminOnly, async (req, res) => {
    try {
      const grantId = String(req.params.grant_id || "").trim();
      if (!isUuidLike(grantId)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_grant_id", message: "grant_id must be a UUID." } });
      }
      const revokedBy = req.auth?.user_id || req.auth?.mode || "admin";
      const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 2000) : null;
      const [result] = await getPool().query(
        `UPDATE \`admin_scope_grants\`
            SET revoked_at = NOW(), revoked_by = ?, reason = COALESCE(?, reason)
          WHERE grant_id = ? AND revoked_at IS NULL`,
        [revokedBy, reason, grantId]
      );
      if (result.affectedRows === 0) {
        const [existing] = await getPool().query(
          `SELECT grant_id, revoked_at FROM \`admin_scope_grants\` WHERE grant_id = ? LIMIT 1`,
          [grantId]
        );
        if (!existing.length) {
          return res.status(404).json({ ok: false, error: { code: "grant_not_found", message: `Grant '${grantId}' was not found.` } });
        }
        return res.status(409).json({ ok: false, error: { code: "grant_already_revoked", message: `Grant '${grantId}' was already revoked.` } });
      }

      const audit = principalAuditFields(req);
      writeAuditLogAsync({
        action: "admin_scope_grant_revoke",
        resource_type: "admin_scope_grant",
        resource_id: grantId,
        after_json: { revoked_by: revokedBy, reason },
        ...audit,
      });

      return res.status(200).json({ ok: true, grant_id: grantId, revoked_at: new Date().toISOString(), revoked_by: revokedBy });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "scope_grant_revoke_failed", message: err.message } });
    }
  });

  router.get("/me/scope-grants", requireBackendApiKey, userScopeOnly, async (req, res) => {
    try {
      const tenantId = req.auth?.tenant_id || null;
      const userId = req.auth?.user_id || null;
      if (!tenantId || !userId) {
        return res.status(400).json({ ok: false, error: { code: "missing_principal_context", message: "Sign-in token must carry both tenant_id and user_id." } });
      }
      const activeOnly = String(req.query.active_only ?? "true").toLowerCase() !== "false";
      const grants = await listGrantsForUser(tenantId, userId, { activeOnly });
      return res.status(200).json({ ok: true, count: grants.length, grants });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "scope_grant_self_list_failed", message: err.message } });
    }
  });

  return router;
}
