import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildTenantsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /tenants ──────────────────────────────────────────────────────────
  router.post("/tenants", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_type, display_name, status = "active", metadata_json } = req.body || {};

      if (!tenant_type || !display_name) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "tenant_type and display_name are required." }
        });
      }

      const VALID_TYPES = ["platform_owner", "partner_organization", "freelancer_operator", "managed_client_account", "brand"];
      if (!VALID_TYPES.includes(tenant_type)) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_tenant_type", message: `tenant_type must be one of: ${VALID_TYPES.join(", ")}` }
        });
      }

      const tenant_id = randomUUID();
      const meta = metadata_json ? (typeof metadata_json === "string" ? metadata_json : JSON.stringify(metadata_json)) : null;

      await getPool().query(
        `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json) VALUES (?, ?, ?, ?, ?)`,
        [tenant_id, tenant_type, display_name, status, meta]
      );

      return res.status(201).json({ ok: true, tenant_id, tenant_type, display_name, status });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "tenant_create_failed", message: err.message || "Failed to create tenant." }
      });
    }
  });

  // ── GET /tenants/:id ───────────────────────────────────────────────────────
  router.get("/tenants/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT tenant_id, tenant_type, display_name, status, metadata_json, created_at, updated_at
         FROM \`tenants\` WHERE tenant_id = ? LIMIT 1`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: { code: "tenant_not_found", message: `Tenant ${req.params.id} not found.` }
        });
      }

      const tenant = rows[0];
      if (tenant.metadata_json) {
        try { tenant.metadata_json = JSON.parse(tenant.metadata_json); } catch { /* leave as string */ }
      }

      return res.status(200).json({ ok: true, tenant });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "tenant_read_failed", message: err.message || "Failed to read tenant." }
      });
    }
  });

  // ── GET /tenants ───────────────────────────────────────────────────────────
  router.get("/tenants", requireBackendApiKey, async (req, res) => {
    try {
      const { type, status } = req.query;
      let sql = "SELECT tenant_id, tenant_type, display_name, status, created_at FROM `tenants`";
      const params = [];
      const conditions = [];

      if (type) { conditions.push("tenant_type = ?"); params.push(type); }
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
      sql += " ORDER BY created_at DESC LIMIT 200";

      const [rows] = await getPool().query(sql, params);
      return res.status(200).json({ ok: true, tenants: rows, count: rows.length });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "tenants_list_failed", message: err.message || "Failed to list tenants." }
      });
    }
  });

  // ── POST /tenants/:id/relationships ───────────────────────────────────────
  router.post("/tenants/:id/relationships", requireBackendApiKey, async (req, res) => {
    try {
      const parent_tenant_id = req.params.id;
      const { child_tenant_id, relationship_type, status = "active" } = req.body || {};

      if (!child_tenant_id || !relationship_type) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "child_tenant_id and relationship_type are required." }
        });
      }

      const VALID_RELS = ["owns", "manages", "partners_with", "white_labels"];
      if (!VALID_RELS.includes(relationship_type)) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_relationship_type", message: `relationship_type must be one of: ${VALID_RELS.join(", ")}` }
        });
      }

      // Verify both tenants exist
      const [parentRows] = await getPool().query("SELECT id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [parent_tenant_id]);
      if (!parentRows.length) {
        return res.status(404).json({ ok: false, error: { code: "parent_not_found", message: `Parent tenant ${parent_tenant_id} not found.` } });
      }
      const [childRows] = await getPool().query("SELECT id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [child_tenant_id]);
      if (!childRows.length) {
        return res.status(404).json({ ok: false, error: { code: "child_not_found", message: `Child tenant ${child_tenant_id} not found.` } });
      }

      await getPool().query(
        `INSERT INTO \`tenant_relationships\` (parent_tenant_id, child_tenant_id, relationship_type, status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [parent_tenant_id, child_tenant_id, relationship_type, status]
      );

      return res.status(201).json({ ok: true, parent_tenant_id, child_tenant_id, relationship_type, status });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "relationship_create_failed", message: err.message || "Failed to create relationship." }
      });
    }
  });

  // ── POST /tenants/:id/memberships ─────────────────────────────────────────
  router.post("/tenants/:id/memberships", requireBackendApiKey, async (req, res) => {
    try {
      const tenant_id = req.params.id;
      const { user_id, role, status = "active" } = req.body || {};

      if (!user_id || !role) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "user_id and role are required." }
        });
      }

      const [tenantRows] = await getPool().query("SELECT id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [tenant_id]);
      if (!tenantRows.length) {
        return res.status(404).json({ ok: false, error: { code: "tenant_not_found", message: `Tenant ${tenant_id} not found.` } });
      }

      await getPool().query(
        `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
        [user_id, tenant_id, role, status]
      );

      return res.status(201).json({ ok: true, tenant_id, user_id, role, status });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "membership_create_failed", message: err.message || "Failed to create membership." }
      });
    }
  });

  // ── GET /tenants/:id/memberships ──────────────────────────────────────────
  router.get("/tenants/:id/memberships", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT user_id, role, status, granted_at FROM \`memberships\` WHERE tenant_id = ? ORDER BY granted_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, tenant_id: req.params.id, memberships: rows, count: rows.length });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "memberships_read_failed", message: err.message || "Failed to read memberships." }
      });
    }
  });

  return router;
}
