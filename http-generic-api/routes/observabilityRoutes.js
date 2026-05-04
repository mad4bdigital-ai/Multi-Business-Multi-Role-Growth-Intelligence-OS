import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildObservabilityRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /telemetry/spans ─────────────────────────────────────────────────
  router.post("/telemetry/spans", requireBackendApiKey, async (req, res) => {
    try {
      const {
        trace_id, tenant_id, run_id, span_name, span_type = "internal",
        service_mode = "self_serve", status = "ok", duration_ms, attributes_json, error_message,
      } = req.body || {};
      if (!trace_id || !span_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "trace_id and span_name are required." } });
      }
      const span_id = randomUUID();
      const attrs = attributes_json ? JSON.stringify(attributes_json) : null;
      await getPool().query(
        `INSERT INTO \`telemetry_spans\`
           (span_id, trace_id, tenant_id, run_id, span_name, span_type, service_mode, status, duration_ms, attributes_json, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [span_id, trace_id, tenant_id || null, run_id || null, span_name, span_type,
         service_mode, status, duration_ms || null, attrs, error_message || null]
      );
      return res.status(201).json({ ok: true, span_id, trace_id });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "span_create_failed", message: err.message } });
    }
  });

  // ── GET /telemetry/traces/:trace_id ───────────────────────────────────────
  router.get("/telemetry/traces/:trace_id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT span_id, span_name, span_type, service_mode, status, duration_ms, error_message, started_at
         FROM \`telemetry_spans\` WHERE trace_id = ? ORDER BY started_at ASC`,
        [req.params.trace_id]
      );
      const total_ms = rows.reduce((sum, r) => sum + (r.duration_ms || 0), 0);
      return res.status(200).json({ ok: true, trace_id: req.params.trace_id, spans: rows, span_count: rows.length, total_ms });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "trace_read_failed", message: err.message } });
    }
  });

  // ── POST /usage/record ────────────────────────────────────────────────────
  // Increment a usage meter for a tenant (upserts daily bucket by default).
  router.post("/usage/record", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, meter_key, quantity = 1, service_mode = "self_serve", cost_usd, period_start, period_end } = req.body || {};
      if (!tenant_id || !meter_key) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and meter_key are required." } });
      }

      const today = (period_start || new Date().toISOString().slice(0, 10));
      const end   = (period_end   || today);

      // Upsert: increment quantity for existing period bucket
      const [existing] = await getPool().query(
        "SELECT meter_id FROM `usage_meters` WHERE tenant_id = ? AND meter_key = ? AND period_start = ? LIMIT 1",
        [tenant_id, meter_key, today]
      );

      if (existing.length) {
        await getPool().query(
          "UPDATE `usage_meters` SET quantity = quantity + ?, cost_usd = COALESCE(cost_usd, 0) + ? WHERE meter_id = ?",
          [quantity, cost_usd || 0, existing[0].meter_id]
        );
        return res.status(200).json({ ok: true, meter_id: existing[0].meter_id, incremented: quantity });
      }

      const meter_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`usage_meters\` (meter_id, tenant_id, meter_key, period_start, period_end, quantity, service_mode, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [meter_id, tenant_id, meter_key, today, end, quantity, service_mode, cost_usd || null]
      );
      return res.status(201).json({ ok: true, meter_id, tenant_id, meter_key, quantity });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "usage_record_failed", message: err.message } });
    }
  });

  // ── GET /usage/:tenant_id ─────────────────────────────────────────────────
  router.get("/usage/:tenant_id", requireBackendApiKey, async (req, res) => {
    try {
      const { meter_key, from, to } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.tenant_id];
      if (meter_key) { conditions.push("meter_key = ?"); params.push(meter_key); }
      if (from) { conditions.push("period_start >= ?"); params.push(from); }
      if (to)   { conditions.push("period_end <= ?"); params.push(to); }
      const [rows] = await getPool().query(
        `SELECT meter_key, period_start, period_end, quantity, unit, service_mode, cost_usd
         FROM \`usage_meters\` WHERE ${conditions.join(" AND ")} ORDER BY period_start DESC LIMIT 500`,
        params
      );
      const totals = {};
      for (const r of rows) {
        totals[r.meter_key] = (totals[r.meter_key] || 0) + Number(r.quantity);
      }
      return res.status(200).json({ ok: true, tenant_id: req.params.tenant_id, meters: rows, totals, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "usage_read_failed", message: err.message } });
    }
  });

  // ── POST /quota-rules ─────────────────────────────────────────────────────
  router.post("/quota-rules", requireBackendApiKey, async (req, res) => {
    try {
      const { plan_key, tenant_id, meter_key, limit_value, period = "monthly", action = "warn" } = req.body || {};
      if (!meter_key) return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "meter_key is required." } });
      const rule_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`quota_rules\` (rule_id, plan_key, tenant_id, meter_key, limit_value, period, action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [rule_id, plan_key || null, tenant_id || null, meter_key, limit_value || null, period, action]
      );
      return res.status(201).json({ ok: true, rule_id, meter_key, limit_value, period, action });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "quota_create_failed", message: err.message } });
    }
  });

  // ── GET /quota-check/:tenant_id/:meter_key ────────────────────────────────
  // Returns whether the tenant is within quota for the given meter.
  router.get("/quota-check/:tenant_id/:meter_key", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, meter_key } = req.params;

      // Get tenant's plan
      const [[subRow]] = await getPool().query(
        `SELECT p.plan_key FROM \`subscriptions\` s JOIN \`plans\` p ON p.plan_id = s.plan_id
         WHERE s.tenant_id = ? AND s.status = 'active' LIMIT 1`,
        [tenant_id]
      );
      const plan_key = subRow?.plan_key || null;

      // Find applicable rule (tenant-specific overrides plan-level)
      const [rules] = await getPool().query(
        `SELECT limit_value, period, action FROM \`quota_rules\`
         WHERE meter_key = ? AND active = 1
           AND (tenant_id = ? OR (tenant_id IS NULL AND plan_key = ?) OR (tenant_id IS NULL AND plan_key IS NULL))
         ORDER BY tenant_id IS NOT NULL DESC, plan_key IS NOT NULL DESC LIMIT 1`,
        [meter_key, tenant_id, plan_key]
      );
      if (!rules.length) {
        return res.status(200).json({ ok: true, within_quota: true, reason: "no_rule_defined" });
      }

      const rule = rules[0];
      const today = new Date().toISOString().slice(0, 10);
      const period_start = rule.period === "daily" ? today :
                           rule.period === "monthly" ? today.slice(0, 7) + "-01" :
                           today.slice(0, 4) + "-01-01";

      const [[usage]] = await getPool().query(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM `usage_meters` WHERE tenant_id = ? AND meter_key = ? AND period_start >= ?",
        [tenant_id, meter_key, period_start]
      );
      const used = Number(usage.total);
      const limit = rule.limit_value !== null ? Number(rule.limit_value) : null;
      const within_quota = limit === null || used < limit;

      return res.status(200).json({
        ok: true, within_quota, used, limit, period: rule.period, action: rule.action,
        tenant_id, meter_key, plan_key,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "quota_check_failed", message: err.message } });
    }
  });

  return router;
}
