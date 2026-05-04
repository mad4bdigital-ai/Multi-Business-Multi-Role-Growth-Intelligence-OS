import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { runReadinessChecks } from "../bootstrapReadiness.js";

export function buildBootstrapRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── GET /bootstrap/readiness/:tenant_id ──────────────────────────────────
  // Runs all 8 first-execution readiness checks and returns full report.
  router.get("/bootstrap/readiness/:tenant_id", requireBackendApiKey, async (req, res) => {
    try {
      const { persist = "false" } = req.query;
      const result = await runReadinessChecks(req.params.tenant_id, {
        persist: persist === "true" || persist === "1",
      });
      return res.status(result.ready ? 200 : 422).json({ ok: result.ready, ...result });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "readiness_check_failed", message: err.message }
      });
    }
  });

  // ── POST /bootstrap/onboarding ────────────────────────────────────────────
  // Creates or retrieves the onboarding state for a tenant.
  router.post("/bootstrap/onboarding", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, service_mode = "self_serve", connector_first = false, managed_launch = false } = req.body || {};
      if (!tenant_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_tenant_id", message: "tenant_id is required." } });
      }

      // Upsert — one onboarding state per tenant
      const [existing] = await getPool().query(
        "SELECT onboarding_id, current_step, overall_status FROM `onboarding_states` WHERE tenant_id = ? LIMIT 1",
        [tenant_id]
      );
      if (existing.length) {
        return res.status(200).json({ ok: true, onboarding: existing[0], created: false });
      }

      const onboarding_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`onboarding_states\`
           (onboarding_id, tenant_id, service_mode, connector_first, managed_launch, overall_status)
         VALUES (?, ?, ?, ?, ?, 'not_started')`,
        [onboarding_id, tenant_id, service_mode, connector_first ? 1 : 0, managed_launch ? 1 : 0]
      );

      return res.status(201).json({
        ok: true,
        onboarding: { onboarding_id, tenant_id, current_step: "start", overall_status: "not_started" },
        created: true,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "onboarding_create_failed", message: err.message } });
    }
  });

  // ── PATCH /bootstrap/onboarding/:tenant_id/step ──────────────────────────
  router.patch("/bootstrap/onboarding/:tenant_id/step", requireBackendApiKey, async (req, res) => {
    try {
      const { step, overall_status } = req.body || {};
      if (!step) {
        return res.status(400).json({ ok: false, error: { code: "missing_step", message: "step is required." } });
      }

      const [existing] = await getPool().query(
        "SELECT onboarding_id, completed_steps FROM `onboarding_states` WHERE tenant_id = ? LIMIT 1",
        [req.params.tenant_id]
      );
      if (!existing.length) {
        return res.status(404).json({ ok: false, error: { code: "onboarding_not_found", message: "Onboarding state not found." } });
      }

      const completed = existing[0].completed_steps
        ? JSON.parse(existing[0].completed_steps)
        : [];
      if (!completed.includes(step)) completed.push(step);

      const sets = ["current_step = ?", "completed_steps = ?"];
      const vals = [step, JSON.stringify(completed)];
      if (overall_status) { sets.push("overall_status = ?"); vals.push(overall_status); }
      vals.push(req.params.tenant_id);

      await getPool().query(
        `UPDATE \`onboarding_states\` SET ${sets.join(", ")} WHERE tenant_id = ?`,
        vals
      );

      return res.status(200).json({ ok: true, tenant_id: req.params.tenant_id, current_step: step, completed_steps: completed });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "onboarding_step_update_failed", message: err.message } });
    }
  });

  // ── GET /bootstrap/onboarding/:tenant_id ─────────────────────────────────
  router.get("/bootstrap/onboarding/:tenant_id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `onboarding_states` WHERE tenant_id = ? LIMIT 1",
        [req.params.tenant_id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "onboarding_not_found", message: "Onboarding state not found." } });
      const s = rows[0];
      if (s.completed_steps) try { s.completed_steps = JSON.parse(s.completed_steps); } catch {}
      return res.status(200).json({ ok: true, onboarding: s });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "onboarding_read_failed", message: err.message } });
    }
  });

  return router;
}
