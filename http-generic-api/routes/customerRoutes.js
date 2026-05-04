import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildCustomerRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /customers ────────────────────────────────────────────────────────
  router.post("/customers", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, display_name, email, phone, company, metadata_json } = req.body || {};
      if (!tenant_id || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and display_name are required." } });
      }
      const customer_id = randomUUID();
      const meta = metadata_json ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `INSERT INTO \`customers\` (customer_id, tenant_id, display_name, email, phone, company, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [customer_id, tenant_id, display_name, email || null, phone || null, company || null, meta]
      );
      return res.status(201).json({ ok: true, customer_id, tenant_id, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_create_failed", message: err.message } });
    }
  });

  // ── GET /customers/:id ─────────────────────────────────────────────────────
  router.get("/customers/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `customers` WHERE customer_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "customer_not_found", message: `Customer ${req.params.id} not found.` } });
      const c = rows[0];
      if (c.metadata_json) try { c.metadata_json = JSON.parse(c.metadata_json); } catch {}
      return res.status(200).json({ ok: true, customer: c });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_read_failed", message: err.message } });
    }
  });

  // ── POST /tickets ──────────────────────────────────────────────────────────
  router.post("/tickets", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, title, customer_id, thread_id, category = "general", priority = "normal", service_mode = "self_serve", metadata_json } = req.body || {};
      if (!tenant_id || !title) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and title are required." } });
      }
      const ticket_id = randomUUID();
      const meta = metadata_json ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `INSERT INTO \`tickets\` (ticket_id, tenant_id, title, customer_id, thread_id, category, priority, service_mode, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticket_id, tenant_id, title, customer_id || null, thread_id || null, category, priority, service_mode, meta]
      );
      return res.status(201).json({ ok: true, ticket_id, tenant_id, title, category, priority, status: "open" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_create_failed", message: err.message } });
    }
  });

  // ── GET /tickets/:id ───────────────────────────────────────────────────────
  router.get("/tickets/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query("SELECT * FROM `tickets` WHERE ticket_id = ? LIMIT 1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "ticket_not_found", message: `Ticket ${req.params.id} not found.` } });
      return res.status(200).json({ ok: true, ticket: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_read_failed", message: err.message } });
    }
  });

  // ── PATCH /tickets/:id/status ─────────────────────────────────────────────
  router.patch("/tickets/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status, assigned_to } = req.body || {};
      const VALID = ["open", "in_review", "awaiting_approval", "resolved", "closed"];
      if (!status || !VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      const sets = ["status = ?"];
      const vals = [status];
      if (assigned_to !== undefined) { sets.push("assigned_to = ?"); vals.push(assigned_to || null); }
      vals.push(req.params.id);
      await getPool().query(`UPDATE \`tickets\` SET ${sets.join(", ")} WHERE ticket_id = ?`, vals);
      return res.status(200).json({ ok: true, ticket_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_update_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/tickets ───────────────────────────────────────────────
  router.get("/tenants/:id/tickets", requireBackendApiKey, async (req, res) => {
    try {
      const { status, category } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (category) { conditions.push("category = ?"); params.push(category); }
      const [rows] = await getPool().query(
        `SELECT ticket_id, title, category, priority, status, service_mode, customer_id, assigned_to, created_at
         FROM \`tickets\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, tickets: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tickets_list_failed", message: err.message } });
    }
  });

  // ── POST /timeline-events ─────────────────────────────────────────────────
  router.post("/timeline-events", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, event_type, customer_id, ticket_id, thread_id, actor_id, actor_type, summary, payload_json } = req.body || {};
      if (!tenant_id || !event_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and event_type are required." } });
      }
      const event_id = randomUUID();
      const payload = payload_json ? JSON.stringify(payload_json) : null;
      await getPool().query(
        `INSERT INTO \`timeline_events\` (event_id, tenant_id, event_type, customer_id, ticket_id, thread_id, actor_id, actor_type, summary, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event_id, tenant_id, event_type, customer_id || null, ticket_id || null, thread_id || null, actor_id || null, actor_type || null, summary || null, payload]
      );
      return res.status(201).json({ ok: true, event_id, event_type, tenant_id });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "event_create_failed", message: err.message } });
    }
  });

  // ── GET /customers/:id/timeline ───────────────────────────────────────────
  router.get("/customers/:id/timeline", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT event_id, event_type, actor_id, actor_type, summary, occurred_at
         FROM \`timeline_events\` WHERE customer_id = ? ORDER BY occurred_at DESC LIMIT 200`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, customer_id: req.params.id, events: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "timeline_read_failed", message: err.message } });
    }
  });

  return router;
}
