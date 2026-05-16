import { Router } from "express";
import { getEffectiveCredentialStatus } from "../credentialResolver.js";
import { getPool } from "../db.js";

function str(value) {
  return String(value ?? "").trim();
}

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

export function buildCredentialRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // Safe status-only resolver. Never returns secret values; used by admin/GPT,
  // /connect wrappers, and governance diagnostics.
  router.post("/credentials/effective/status", async (req, res) => {
    try {
      const credential = await getEffectiveCredentialStatus(req.body || {});
      res.json({ ok: true, credential });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_status_failed", message: err.message } });
    }
  });

  // Read-only binding inventory. This exposes pointers and ownership metadata,
  // never secret values.
  router.get("/credentials/bindings", async (req, res) => {
    try {
      const {
        tenant_id,
        owner_type,
        action_key,
        target_key,
        credential_role,
        status = "active",
        limit = 100
      } = req.query || {};

      const clauses = [];
      const params = [];
      if (tenant_id) { clauses.push("tenant_id = ?"); params.push(str(tenant_id)); }
      if (owner_type) { clauses.push("owner_type = ?"); params.push(str(owner_type)); }
      if (action_key) { clauses.push("action_key = ?"); params.push(str(action_key)); }
      if (target_key) { clauses.push("target_key = ?"); params.push(str(target_key)); }
      if (credential_role) { clauses.push("credential_role = ?"); params.push(str(credential_role)); }
      if (status) { clauses.push("status = ?"); params.push(str(status)); }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [rows] = await getPool().query(
        `SELECT binding_id, tenant_id, owner_type, owner_id, user_id, system_id,
                installation_id, connection_id, action_key, target_key,
                credential_role, credential_ref, provider_family, connector_family,
                resolution_priority, status, created_by, created_at, updated_at
           FROM \`credential_bindings\`
          ${where}
          ORDER BY resolution_priority ASC, updated_at DESC
          LIMIT ${parseLimit(limit)}`,
        params
      );

      res.json({ ok: true, bindings: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_bindings_failed", message: err.message } });
    }
  });

  return router;
}
