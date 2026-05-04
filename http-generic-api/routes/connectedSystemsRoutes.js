import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildConnectedSystemsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /connected-systems ────────────────────────────────────────────────
  router.post("/connected-systems", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id, system_key, display_name, provider_family,
        provider_domain, connector_family, auth_type, service_mode = "self_serve",
        self_serve_capable = 1, assisted_capable = 0, managed_capable = 0,
        config_json,
      } = req.body || {};

      if (!tenant_id || !system_key || !display_name || !provider_family) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_fields", message: "tenant_id, system_key, display_name, and provider_family are required." }
        });
      }

      const system_id = randomUUID();
      const cfg = config_json ? JSON.stringify(config_json) : null;

      await getPool().query(
        `INSERT INTO \`connected_systems\`
           (system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family,
            auth_type, service_mode, self_serve_capable, assisted_capable, managed_capable, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [system_id, tenant_id, system_key, display_name, provider_family,
         provider_domain || null, connector_family || null, auth_type || null,
         service_mode, self_serve_capable, assisted_capable, managed_capable, cfg]
      );

      return res.status(201).json({ ok: true, system_id, tenant_id, system_key, display_name, provider_family, status: "pending" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ ok: false, error: { code: "system_already_exists", message: "A connected system with this system_key already exists for this tenant." } });
      }
      return res.status(500).json({ ok: false, error: { code: "system_create_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/connected-systems ────────────────────────────────────
  router.get("/tenants/:id/connected-systems", requireBackendApiKey, async (req, res) => {
    try {
      const { status } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status) { conditions.push("status = ?"); params.push(status); }

      const [rows] = await getPool().query(
        `SELECT system_id, system_key, display_name, provider_family, provider_domain,
                connector_family, service_mode, status, self_serve_capable, assisted_capable, managed_capable, created_at
         FROM \`connected_systems\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
        params
      );
      return res.status(200).json({ ok: true, systems: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "systems_list_failed", message: err.message } });
    }
  });

  // ── PATCH /connected-systems/:id/status ───────────────────────────────────
  router.patch("/connected-systems/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status } = req.body || {};
      const VALID = ["active", "pending", "error", "archived"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      await getPool().query("UPDATE `connected_systems` SET status = ? WHERE system_id = ?", [status, req.params.id]);
      return res.status(200).json({ ok: true, system_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "system_update_failed", message: err.message } });
    }
  });

  // ── POST /installations ───────────────────────────────────────────────────
  router.post("/installations", requireBackendApiKey, async (req, res) => {
    try {
      const { system_id, tenant_id, scope, credential_ref, expires_at, meta_json } = req.body || {};
      if (!system_id || !tenant_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "system_id and tenant_id are required." } });
      }
      const installation_id = randomUUID();
      const meta = meta_json ? JSON.stringify(meta_json) : null;
      await getPool().query(
        `INSERT INTO \`installations\` (installation_id, system_id, tenant_id, scope, credential_ref, expires_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [installation_id, system_id, tenant_id, scope || null, credential_ref || null, expires_at || null, meta]
      );
      return res.status(201).json({ ok: true, installation_id, system_id, tenant_id, status: "active" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "installation_create_failed", message: err.message } });
    }
  });

  // ── POST /workspaces ──────────────────────────────────────────────────────
  router.post("/workspaces", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, workspace_key, display_name, workspace_type = "brand", linked_brand_key, linked_system_ids, config_json } = req.body || {};
      if (!tenant_id || !workspace_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id, workspace_key, and display_name are required." } });
      }
      const workspace_id = randomUUID();
      const systemIds = linked_system_ids ? JSON.stringify(linked_system_ids) : null;
      const cfg = config_json ? JSON.stringify(config_json) : null;
      await getPool().query(
        `INSERT INTO \`workspace_registry\`
           (workspace_id, tenant_id, workspace_key, display_name, workspace_type, linked_brand_key, linked_system_ids, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [workspace_id, tenant_id, workspace_key, display_name, workspace_type, linked_brand_key || null, systemIds, cfg]
      );
      return res.status(201).json({ ok: true, workspace_id, tenant_id, workspace_key, display_name, bootstrap_status: "not_started" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ ok: false, error: { code: "workspace_already_exists", message: "A workspace with this key already exists for this tenant." } });
      }
      return res.status(500).json({ ok: false, error: { code: "workspace_create_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/workspaces ───────────────────────────────────────────
  router.get("/tenants/:id/workspaces", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT workspace_id, workspace_key, display_name, workspace_type, bootstrap_status, linked_brand_key, created_at
         FROM \`workspace_registry\` WHERE tenant_id = ? ORDER BY created_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, workspaces: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspaces_list_failed", message: err.message } });
    }
  });

  // ── GET /installations/:id ────────────────────────────────────────────────
  router.get("/installations/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `installations` WHERE installation_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "installation_not_found", message: `Installation ${req.params.id} not found.` } });
      const inst = rows[0];
      if (inst.meta_json) try { inst.meta_json = JSON.parse(inst.meta_json); } catch {}
      return res.status(200).json({ ok: true, installation: inst });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "installation_read_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/installations ────────────────────────────────────────
  router.get("/tenants/:id/installations", requireBackendApiKey, async (req, res) => {
    try {
      const { status, system_id } = req.query;
      const conditions = ["i.tenant_id = ?"];
      const params = [req.params.id];
      if (status)    { conditions.push("i.status = ?");    params.push(status); }
      if (system_id) { conditions.push("i.system_id = ?"); params.push(system_id); }
      const [rows] = await getPool().query(
        `SELECT i.installation_id, i.system_id, i.scope, i.status, i.installed_at, i.expires_at,
                cs.system_key, cs.display_name AS system_name, cs.provider_family
         FROM \`installations\` i
         LEFT JOIN \`connected_systems\` cs ON cs.system_id = i.system_id
         WHERE ${conditions.join(" AND ")} ORDER BY i.installed_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, installations: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "installations_list_failed", message: err.message } });
    }
  });

  // ── POST /permission-grants ───────────────────────────────────────────────
  router.post("/permission-grants", requireBackendApiKey, async (req, res) => {
    try {
      const { installation_id, tenant_id, permission_key, granted = true, granted_by } = req.body || {};
      if (!installation_id || !tenant_id || !permission_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "installation_id, tenant_id, and permission_key are required." } });
      }
      const grant_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`permission_grants\` (grant_id, installation_id, tenant_id, permission_key, granted, granted_at, granted_by)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [grant_id, installation_id, tenant_id, permission_key, granted ? 1 : 0, granted_by || null]
      );
      return res.status(201).json({ ok: true, grant_id, installation_id, tenant_id, permission_key, granted });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "grant_create_failed", message: err.message } });
    }
  });

  // ── GET /installations/:id/permission-grants ──────────────────────────────
  router.get("/installations/:id/permission-grants", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT grant_id, permission_key, granted, granted_at, granted_by
         FROM \`permission_grants\` WHERE installation_id = ? ORDER BY granted_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, installation_id: req.params.id, grants: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "grants_list_failed", message: err.message } });
    }
  });

  return router;
}
