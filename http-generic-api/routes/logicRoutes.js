import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildLogicRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /logic-definitions ───────────────────────────────────────────────
  router.post("/logic-definitions", requireBackendApiKey, async (req, res) => {
    try {
      const { logic_key, display_name, logic_type = "execution", parent_logic_id, tenant_id, body_json, version = "1.0" } = req.body || {};
      if (!logic_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "logic_key and display_name are required." } });
      }
      const logic_id = randomUUID();
      const body = body_json ? JSON.stringify(body_json) : null;
      await getPool().query(
        `INSERT INTO \`logic_definitions\` (logic_id, logic_key, display_name, logic_type, parent_logic_id, tenant_id, body_json, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [logic_id, logic_key, display_name, logic_type, parent_logic_id || null, tenant_id || null, body, version]
      );
      return res.status(201).json({ ok: true, logic_id, logic_key, logic_type, status: "draft" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "logic_create_failed", message: err.message } });
    }
  });

  // ── GET /logic-definitions ────────────────────────────────────────────────
  router.get("/logic-definitions", requireBackendApiKey, async (req, res) => {
    try {
      const { type, tenant_id, status } = req.query;
      const conditions = [];
      const params = [];
      if (type) { conditions.push("logic_type = ?"); params.push(type); }
      if (tenant_id) { conditions.push("(tenant_id = ? OR tenant_id IS NULL)"); params.push(tenant_id); }
      if (status) { conditions.push("status = ?"); params.push(status); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [rows] = await getPool().query(
        `SELECT logic_id, logic_key, display_name, logic_type, parent_logic_id, version, status, created_at
         FROM \`logic_definitions\` ${where} ORDER BY logic_key LIMIT 500`,
        params
      );
      return res.status(200).json({ ok: true, definitions: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "logic_list_failed", message: err.message } });
    }
  });

  // ── GET /logic-definitions/:id/children ───────────────────────────────────
  router.get("/logic-definitions/:id/children", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT logic_id, logic_key, display_name, logic_type, version, status
         FROM \`logic_definitions\` WHERE parent_logic_id = ? ORDER BY logic_key`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, parent_logic_id: req.params.id, children: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "logic_children_failed", message: err.message } });
    }
  });

  // ── PUT /logic-definitions/:id ───────────────────────────────────────────
  router.put("/logic-definitions/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { logic_key, display_name, logic_type, body_json, version, status } = req.body || {};
      if (!logic_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "logic_key and display_name are required." } });
      }
      const body = body_json != null ? JSON.stringify(body_json) : null;
      await getPool().query(
        `UPDATE \`logic_definitions\`
         SET logic_key=?, display_name=?, logic_type=COALESCE(?,logic_type),
             body_json=COALESCE(?,body_json), version=COALESCE(?,version), status=COALESCE(?,status)
         WHERE logic_id=?`,
        [logic_key, display_name, logic_type || null, body, version || null, status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, logic_id: req.params.id, logic_key, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "logic_update_failed", message: err.message } });
    }
  });

  // ── PATCH /logic-definitions/:id/status ──────────────────────────────────
  router.patch("/logic-definitions/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status } = req.body || {};
      const VALID = ["active", "draft", "deprecated", "archived"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      await getPool().query("UPDATE `logic_definitions` SET status = ? WHERE logic_id = ?", [status, req.params.id]);
      return res.status(200).json({ ok: true, logic_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "logic_update_failed", message: err.message } });
    }
  });

  // ── POST /logic-packs ─────────────────────────────────────────────────────
  router.post("/logic-packs", requireBackendApiKey, async (req, res) => {
    try {
      const { pack_key, display_name, pack_type = "operational", service_mode = "self_serve", parent_pack_id, tenant_id, contents_json } = req.body || {};
      if (!pack_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "pack_key and display_name are required." } });
      }
      const pack_id = randomUUID();
      const contents = contents_json ? JSON.stringify(contents_json) : null;
      await getPool().query(
        `INSERT INTO \`logic_packs\` (pack_id, pack_key, display_name, pack_type, service_mode, parent_pack_id, tenant_id, contents_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [pack_id, pack_key, display_name, pack_type, service_mode, parent_pack_id || null, tenant_id || null, contents]
      );
      return res.status(201).json({ ok: true, pack_id, pack_key, pack_type, service_mode, status: "draft" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "pack_create_failed", message: err.message } });
    }
  });

  // ── PUT /logic-packs/:id ─────────────────────────────────────────────────
  router.put("/logic-packs/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { pack_key, display_name, pack_type, service_mode, contents_json, status } = req.body || {};
      if (!pack_key || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "pack_key and display_name are required." } });
      }
      const contents = contents_json != null ? JSON.stringify(contents_json) : null;
      await getPool().query(
        `UPDATE \`logic_packs\`
         SET pack_key=?, display_name=?, pack_type=COALESCE(?,pack_type),
             service_mode=COALESCE(?,service_mode), contents_json=COALESCE(?,contents_json), status=COALESCE(?,status)
         WHERE pack_id=?`,
        [pack_key, display_name, pack_type || null, service_mode || null, contents, status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, pack_id: req.params.id, pack_key, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "pack_update_failed", message: err.message } });
    }
  });

  // ── POST /logic-packs/:id/attach ─────────────────────────────────────────
  router.post("/logic-packs/:id/attach", requireBackendApiKey, async (req, res) => {
    try {
      const pack_id = req.params.id;
      const { target_type, target_id, attached_by } = req.body || {};
      const VALID_TARGETS = ["tenant", "workflow", "logic", "action", "brand"];
      if (!target_type || !target_id || !VALID_TARGETS.includes(target_type)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_attachment", message: `target_type must be one of: ${VALID_TARGETS.join(", ")}` } });
      }
      const attachment_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`pack_attachments\` (attachment_id, pack_id, target_type, target_id, attached_by) VALUES (?, ?, ?, ?, ?)`,
        [attachment_id, pack_id, target_type, target_id, attached_by || null]
      );
      return res.status(201).json({ ok: true, attachment_id, pack_id, target_type, target_id });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "pack_attach_failed", message: err.message } });
    }
  });

  // ── POST /adaptation-records ──────────────────────────────────────────────
  router.post("/adaptation-records", requireBackendApiKey, async (req, res) => {
    try {
      const { logic_id, tenant_id, adapted_by, adaptation_type = "override", original_json, adapted_json, reason } = req.body || {};
      if (!logic_id || !tenant_id || !adapted_json) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "logic_id, tenant_id, and adapted_json are required." } });
      }
      const adaptation_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`adaptation_records\` (adaptation_id, logic_id, tenant_id, adapted_by, adaptation_type, original_json, adapted_json, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [adaptation_id, logic_id, tenant_id, adapted_by || null, adaptation_type,
         original_json ? JSON.stringify(original_json) : null,
         typeof adapted_json === "string" ? adapted_json : JSON.stringify(adapted_json),
         reason || null]
      );
      return res.status(201).json({ ok: true, adaptation_id, logic_id, tenant_id, adaptation_type, status: "pending" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "adaptation_create_failed", message: err.message } });
    }
  });

  // ── PATCH /adaptation-records/:id/approve ────────────────────────────────
  router.patch("/adaptation-records/:id/approve", requireBackendApiKey, async (req, res) => {
    try {
      const { approved_by, status = "approved" } = req.body || {};
      const VALID = ["approved", "rejected"];
      if (!VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: "status must be 'approved' or 'rejected'." } });
      }
      await getPool().query(
        "UPDATE `adaptation_records` SET status = ?, approved_by = ? WHERE adaptation_id = ?",
        [status, approved_by || null, req.params.id]
      );
      return res.status(200).json({ ok: true, adaptation_id: req.params.id, status, approved_by: approved_by || null });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "adaptation_approve_failed", message: err.message } });
    }
  });

  return router;
}
