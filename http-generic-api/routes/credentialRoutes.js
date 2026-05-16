import { Router } from "express";
import { createHash } from "node:crypto";
import { getEffectiveCredentialStatus } from "../credentialResolver.js";
import { getPool } from "../db.js";
import { encryptToken } from "../tokenEncryption.js";

function str(value) {
  return String(value ?? "").trim();
}

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function metadataJson(input = {}) {
  return JSON.stringify({
    provisioning_status: "stored",
    stored_at: new Date().toISOString(),
    provider_family: str(input.provider_family),
    connector_family: str(input.connector_family),
    credential_type: str(input.credential_type || input.secret_type),
    source: "credential_routes.upsert"
  });
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

  // Store a platform or tenant secret as AES-256-GCM ciphertext in SQL. This is
  // backend/admin only. It never echoes the provided value and updates the
  // pointer registry to store_type=db_encrypted.
  router.post("/credentials/secrets/upsert", async (req, res) => {
    try {
      const body = req.body || {};
      const ownerType = str(body.owner_type || body.ownerType || "tenant");
      const tenantId = str(body.tenant_id || body.tenantId);
      const secretKey = str(body.secret_key || body.secretKey);
      const secretType = str(body.secret_type || body.secretType || body.credential_type || "text");
      const value = str(body.value || body.secret || body.secret_value);
      const providerFamily = str(body.provider_family || body.providerFamily);
      const connectorFamily = str(body.connector_family || body.connectorFamily);
      const credentialType = str(body.credential_type || body.credentialType || secretType);
      const createdBy = str(body.created_by || body.createdBy || "credential_routes.upsert");

      if (!["platform", "tenant"].includes(ownerType)) {
        return res.status(400).json({ ok: false, error: { code: "unsupported_owner_type", message: "owner_type must be platform or tenant" } });
      }
      if (ownerType === "tenant" && !tenantId) {
        return res.status(400).json({ ok: false, error: { code: "tenant_id_required", message: "tenant_id is required for tenant secrets" } });
      }
      if (!secretKey || !value) {
        return res.status(400).json({ ok: false, error: { code: "secret_key_and_value_required", message: "secret_key and value are required" } });
      }

      const ciphertext = encryptToken(value);
      const hash = sha256(value);
      const pool = getPool();

      if (ownerType === "platform") {
        await pool.query(
          `INSERT INTO \`platform_secrets\`
             (secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
           VALUES (?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
           ON DUPLICATE KEY UPDATE
             secret_type = VALUES(secret_type),
             storage_backend = 'db_encrypted',
             secret_ref = NULL,
             value_sha256 = VALUES(value_sha256),
             value_ciphertext = VALUES(value_ciphertext),
             metadata_json = VALUES(metadata_json),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
          [secretKey, secretType, hash, ciphertext, metadataJson(body), createdBy]
        );
      } else {
        await pool.query(
          `INSERT INTO \`tenant_secrets\`
             (tenant_id, secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
           VALUES (?, ?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
           ON DUPLICATE KEY UPDATE
             secret_type = VALUES(secret_type),
             storage_backend = 'db_encrypted',
             secret_ref = NULL,
             value_sha256 = VALUES(value_sha256),
             value_ciphertext = VALUES(value_ciphertext),
             metadata_json = VALUES(metadata_json),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
          [tenantId, secretKey, secretType, hash, ciphertext, metadataJson(body), createdBy]
        );
      }

      await pool.query(
        `INSERT INTO \`secret_references\`
           (ref_id, tenant_id, owner_type, owner_id, secret_key, store_type, env_var_name, vault_path,
            description, provider_family, connector_family, credential_type, consent_status, validation_status, status, created_at)
         VALUES (UUID(), ?, ?, ?, ?, 'db_encrypted', NULL, NULL, ?, ?, ?, ?, 'not_required', 'stored', 'active', NOW())
         ON DUPLICATE KEY UPDATE
           owner_type = VALUES(owner_type),
           owner_id = VALUES(owner_id),
           store_type = 'db_encrypted',
           env_var_name = NULL,
           vault_path = NULL,
           provider_family = VALUES(provider_family),
           connector_family = VALUES(connector_family),
           credential_type = VALUES(credential_type),
           validation_status = 'stored',
           status = 'active'`,
        [
          ownerType === "tenant" ? tenantId : "f2795a7f-8d06-4053-8bee-35ca9af8b460",
          ownerType,
          ownerType === "tenant" ? tenantId : "platform",
          secretKey,
          str(body.description) || `${ownerType} ${secretKey} stored as db_encrypted credential`,
          providerFamily,
          connectorFamily,
          credentialType
        ]
      );

      res.json({
        ok: true,
        owner_type: ownerType,
        tenant_id: ownerType === "tenant" ? tenantId : null,
        secret_key: secretKey,
        storage_backend: "db_encrypted",
        value_sha256: hash,
        status: "active"
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_secret_upsert_failed", message: err.message } });
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
