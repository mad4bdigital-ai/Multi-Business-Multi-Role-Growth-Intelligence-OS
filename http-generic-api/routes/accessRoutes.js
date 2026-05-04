import { Router } from "express";
import { resolveAccess, DECISIONS } from "../accessDecisionEngine.js";
import { getPool } from "../db.js";

export function buildAccessRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /access/resolve ───────────────────────────────────────────────────
  // Resolves the 6-outcome access decision for a given tenant/user/operation.
  //
  // Body: { tenant_id, user_id?, risk_level?, intent_flags?, persist? }
  // Response: { ok, decision, reason, service_mode, plan_key, ... }
  router.post("/access/resolve", requireBackendApiKey, async (req, res) => {
    try {
      const {
        tenant_id,
        user_id,
        risk_level = "low",
        intent_flags = {},
        persist = false,
      } = req.body || {};

      if (!tenant_id) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_tenant_id", message: "tenant_id is required." }
        });
      }

      const VALID_RISK = ["low", "medium", "high", "critical"];
      if (!VALID_RISK.includes(risk_level)) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_risk_level", message: `risk_level must be one of: ${VALID_RISK.join(", ")}` }
        });
      }

      const result = await resolveAccess({ tenant_id, user_id, risk_level, intent_flags, persist });

      const allows_execution = result.decision === DECISIONS.ALLOW_SELF_SERVE ||
                               result.decision === DECISIONS.ALLOW_WITH_OPTIONAL_ASSISTANCE;

      return res.status(200).json({
        ok: true,
        allows_execution,
        ...result,
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "access_resolve_failed", message: err.message || "Access resolution failed." }
      });
    }
  });

  // ── GET /access/envelopes ─────────────────────────────────────────────────
  // Returns recent resolved request envelopes for audit / debugging.
  router.get("/access/envelopes", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, decision, limit = 50 } = req.query;
      const params = [];
      const conditions = [];

      if (tenant_id) { conditions.push("tenant_id = ?"); params.push(tenant_id); }
      if (decision) { conditions.push("access_decision = ?"); params.push(decision); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const cap = Math.min(Number(limit) || 50, 200);

      const [rows] = await getPool().query(
        `SELECT envelope_id, tenant_id, user_id, risk_level, access_decision, decision_reason,
                service_mode, resolved_at, created_at
         FROM \`request_envelopes\` ${where}
         ORDER BY created_at DESC LIMIT ${cap}`,
        params
      );

      return res.status(200).json({ ok: true, envelopes: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "envelopes_read_failed", message: err.message || "Failed to read request envelopes." }
      });
    }
  });

  return router;
}
