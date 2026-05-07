import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildTenantCommercialRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /tenants/:id/commercial — full commercial snapshot ────────────────
  router.get("/tenants/:id/commercial", async (req, res) => {
    try {
      const pool = getPool();
      const tid = req.params.id;

      const [[tenants], [balances], [limits], [profiles], [usageRows]] = await Promise.all([
        pool.query(
          `SELECT t.*, s.plan_id, p.plan_key, p.display_name AS plan_name, p.service_mode,
                  s.status AS subscription_status, s.started_at AS subscribed_at, s.expires_at
           FROM \`tenants\` t
           LEFT JOIN \`subscriptions\` s ON s.tenant_id = t.tenant_id AND s.status = 'active'
           LEFT JOIN \`plans\` p ON p.plan_id = s.plan_id
           WHERE t.tenant_id = ? LIMIT 1`, [tid]
        ),
        pool.query("SELECT * FROM `credit_balances` WHERE tenant_id = ? LIMIT 1", [tid]),
        pool.query("SELECT * FROM `usage_limits` WHERE tenant_id = ? LIMIT 1", [tid]),
        pool.query("SELECT * FROM `commercial_profiles` WHERE tenant_id = ? LIMIT 1", [tid]),
        pool.query(
          "SELECT * FROM `tenant_usage` WHERE tenant_id = ? ORDER BY period DESC LIMIT 12", [tid]
        ),
      ]);

      if (!tenants[0]) return res.status(404).json({ ok: false, error: "tenant_not_found" });

      const balance   = balances[0] || null;
      const lim       = limits[0] || null;
      const current   = usageRows[0] || null;

      // Compute remaining for each limited dimension
      const remaining = lim ? {
        session_minutes: lim.monthly_session_minutes != null
          ? Math.max(0, lim.monthly_session_minutes - (current?.session_minutes ?? 0)) : null,
        api_calls: lim.monthly_api_calls != null
          ? Math.max(0, lim.monthly_api_calls - (current?.api_calls ?? 0)) : null,
        uploads: lim.monthly_uploads != null
          ? Math.max(0, lim.monthly_uploads - (current?.uploads_count ?? 0)) : null,
        drive_bytes: lim.max_drive_bytes != null
          ? Math.max(0, lim.max_drive_bytes - (current?.drive_bytes_stored ?? 0)) : null,
        credits: balance
          ? Math.max(0, Number(balance.balance) - Number(balance.reserved)) : null,
      } : null;

      res.json({
        ok: true,
        tenant: tenants[0],
        credits: balance,
        limits: lim,
        remaining,
        commercial: profiles[0] || null,
        usage: { current_period: current, history: usageRows },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /tenants/:id/credits — credit balance + recent ledger ─────────────
  router.get("/tenants/:id/credits", async (req, res) => {
    try {
      const pool = getPool();
      const { limit = 50 } = req.query;
      const [[balances], [ledger]] = await Promise.all([
        pool.query("SELECT * FROM `credit_balances` WHERE tenant_id = ? LIMIT 1", [req.params.id]),
        pool.query(
          "SELECT * FROM `credit_ledger` WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
          [req.params.id, Number(limit)]
        ),
      ]);
      res.json({ ok: true, balance: balances[0] || null, ledger });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /tenants/:id/credits/topup — add credits ─────────────────────────
  router.post("/tenants/:id/credits/topup", async (req, res) => {
    try {
      const { amount, description, created_by } = req.body || {};
      if (!amount || Number(amount) <= 0)
        return res.status(400).json({ ok: false, error: "amount must be a positive number" });

      const pool = getPool();
      const tid  = req.params.id;
      const amt  = Number(amount);

      // Upsert balance row then read new balance atomically
      await pool.query(
        `INSERT INTO \`credit_balances\` (tenant_id, balance, lifetime_credited)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           balance           = balance + VALUES(balance),
           lifetime_credited = lifetime_credited + VALUES(lifetime_credited),
           last_topup_at     = NOW()`,
        [tid, amt, amt]
      );
      const [[rows]] = await pool.query(
        "SELECT balance FROM `credit_balances` WHERE tenant_id = ? LIMIT 1", [tid]
      );
      const newBalance = Number(rows[0].balance);

      await pool.query(
        `INSERT INTO \`credit_ledger\`
           (ledger_id, tenant_id, amount, balance_after, ledger_type, description, created_by)
         VALUES (?,?,?,?,'topup',?,?)`,
        [randomUUID(), tid, amt, newBalance, description || null, created_by || null]
      );

      res.json({ ok: true, tenant_id: tid, amount: amt, balance: newBalance });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /tenants/:id/credits/debit — record usage consumption ────────────
  router.post("/tenants/:id/credits/debit", async (req, res) => {
    try {
      const { amount, ledger_type = "usage_api", ref_type, ref_id, description } = req.body || {};
      if (!amount || Number(amount) <= 0)
        return res.status(400).json({ ok: false, error: "amount must be a positive number" });

      const pool = getPool();
      const tid  = req.params.id;
      const amt  = Number(amount);

      await pool.query(
        `INSERT INTO \`credit_balances\` (tenant_id, balance, lifetime_consumed)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           balance           = GREATEST(0, balance - VALUES(balance)),
           lifetime_consumed = lifetime_consumed + VALUES(lifetime_consumed),
           last_consumed_at  = NOW()`,
        [tid, amt, amt]
      );
      const [[rows]] = await pool.query(
        "SELECT balance FROM `credit_balances` WHERE tenant_id = ? LIMIT 1", [tid]
      );
      const newBalance = Number(rows[0].balance);

      await pool.query(
        `INSERT INTO \`credit_ledger\`
           (ledger_id, tenant_id, amount, balance_after, ledger_type, ref_type, ref_id, description)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(), tid, -amt, newBalance, ledger_type, ref_type || null, ref_id || null, description || null]
      );

      res.json({ ok: true, tenant_id: tid, debited: amt, balance: newBalance });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /tenants/:id/usage — usage history ────────────────────────────────
  router.get("/tenants/:id/usage", async (req, res) => {
    try {
      const { months = 6 } = req.query;
      const [rows] = await getPool().query(
        "SELECT * FROM `tenant_usage` WHERE tenant_id = ? ORDER BY period DESC LIMIT ?",
        [req.params.id, Number(months)]
      );
      res.json({ ok: true, usage: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /tenants/:id/usage — increment usage counters for current period ──
  router.post("/tenants/:id/usage", async (req, res) => {
    try {
      const {
        session_count = 0, session_minutes = 0, api_calls = 0,
        uploads_count = 0, drive_files_count = 0, drive_bytes_stored = 0,
        credits_consumed = 0,
      } = req.body || {};

      const period = new Date().toISOString().slice(0, 7); // YYYY-MM
      const pool   = getPool();
      const tid    = req.params.id;

      await pool.query(
        `INSERT INTO \`tenant_usage\`
           (tenant_id, period, session_count, session_minutes, api_calls,
            uploads_count, drive_files_count, drive_bytes_stored, credits_consumed)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           session_count      = session_count      + VALUES(session_count),
           session_minutes    = session_minutes    + VALUES(session_minutes),
           api_calls          = api_calls          + VALUES(api_calls),
           uploads_count      = uploads_count      + VALUES(uploads_count),
           drive_files_count  = drive_files_count  + VALUES(drive_files_count),
           drive_bytes_stored = drive_bytes_stored + VALUES(drive_bytes_stored),
           credits_consumed   = credits_consumed   + VALUES(credits_consumed)`,
        [tid, period, session_count, session_minutes, api_calls,
         uploads_count, drive_files_count, drive_bytes_stored, credits_consumed]
      );

      const [[rows]] = await pool.query(
        "SELECT * FROM `tenant_usage` WHERE tenant_id = ? AND period = ? LIMIT 1", [tid, period]
      );
      res.json({ ok: true, period, usage: rows[0] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /tenants/:id/limits — usage limit config ──────────────────────────
  router.get("/tenants/:id/limits", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `usage_limits` WHERE tenant_id = ? LIMIT 1", [req.params.id]
      );
      res.json({ ok: true, limits: rows[0] || null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /tenants/:id/limits — set usage limits ────────────────────────────
  router.put("/tenants/:id/limits", async (req, res) => {
    try {
      const {
        monthly_session_minutes, monthly_api_calls, monthly_uploads,
        max_drive_bytes, max_seats, credit_limit, overage_allowed, overage_rate_per_unit,
      } = req.body || {};

      const pool = getPool();
      const tid  = req.params.id;

      await pool.query(
        `INSERT INTO \`usage_limits\`
           (tenant_id, monthly_session_minutes, monthly_api_calls, monthly_uploads,
            max_drive_bytes, max_seats, credit_limit, overage_allowed, overage_rate_per_unit)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           monthly_session_minutes = COALESCE(VALUES(monthly_session_minutes), monthly_session_minutes),
           monthly_api_calls       = COALESCE(VALUES(monthly_api_calls),       monthly_api_calls),
           monthly_uploads         = COALESCE(VALUES(monthly_uploads),         monthly_uploads),
           max_drive_bytes         = COALESCE(VALUES(max_drive_bytes),         max_drive_bytes),
           max_seats               = COALESCE(VALUES(max_seats),               max_seats),
           credit_limit            = COALESCE(VALUES(credit_limit),            credit_limit),
           overage_allowed         = COALESCE(VALUES(overage_allowed),         overage_allowed),
           overage_rate_per_unit   = COALESCE(VALUES(overage_rate_per_unit),   overage_rate_per_unit)`,
        [tid, monthly_session_minutes ?? null, monthly_api_calls ?? null, monthly_uploads ?? null,
         max_drive_bytes ?? null, max_seats ?? null, credit_limit ?? null,
         overage_allowed ?? 0, overage_rate_per_unit ?? null]
      );

      const [rows] = await pool.query(
        "SELECT * FROM `usage_limits` WHERE tenant_id = ? LIMIT 1", [tid]
      );
      res.json({ ok: true, limits: rows[0] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /tenants/:id/commercial-profile — market metadata ─────────────────
  router.get("/tenants/:id/commercial-profile", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `commercial_profiles` WHERE tenant_id = ? LIMIT 1", [req.params.id]
      );
      res.json({ ok: true, profile: rows[0] || null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /tenants/:id/commercial-profile — update market metadata ──────────
  router.put("/tenants/:id/commercial-profile", async (req, res) => {
    try {
      const {
        industry, company_size, markets_json, verticals_json, contract_type,
        billing_currency, mrr_usd, arr_usd, ltv_usd, acquisition_source,
        health_score, churn_risk, notes,
      } = req.body || {};

      const pool = getPool();
      const tid  = req.params.id;

      await pool.query(
        `INSERT INTO \`commercial_profiles\`
           (tenant_id, industry, company_size, markets_json, verticals_json, contract_type,
            billing_currency, mrr_usd, arr_usd, ltv_usd, acquisition_source,
            health_score, churn_risk, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           industry           = COALESCE(VALUES(industry),           industry),
           company_size       = COALESCE(VALUES(company_size),       company_size),
           markets_json       = COALESCE(VALUES(markets_json),       markets_json),
           verticals_json     = COALESCE(VALUES(verticals_json),     verticals_json),
           contract_type      = COALESCE(VALUES(contract_type),      contract_type),
           billing_currency   = COALESCE(VALUES(billing_currency),   billing_currency),
           mrr_usd            = COALESCE(VALUES(mrr_usd),            mrr_usd),
           arr_usd            = COALESCE(VALUES(arr_usd),            arr_usd),
           ltv_usd            = COALESCE(VALUES(ltv_usd),            ltv_usd),
           acquisition_source = COALESCE(VALUES(acquisition_source), acquisition_source),
           health_score       = COALESCE(VALUES(health_score),       health_score),
           churn_risk         = COALESCE(VALUES(churn_risk),         churn_risk),
           notes              = COALESCE(VALUES(notes),              notes)`,
        [tid, industry ?? null, company_size ?? null,
         markets_json  ? JSON.stringify(markets_json)  : null,
         verticals_json ? JSON.stringify(verticals_json) : null,
         contract_type ?? null, billing_currency ?? 'USD',
         mrr_usd ?? null, arr_usd ?? null, ltv_usd ?? null,
         acquisition_source ?? null, health_score ?? null, churn_risk ?? null, notes ?? null]
      );

      const [rows] = await pool.query(
        "SELECT * FROM `commercial_profiles` WHERE tenant_id = ? LIMIT 1", [tid]
      );
      res.json({ ok: true, profile: rows[0] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
