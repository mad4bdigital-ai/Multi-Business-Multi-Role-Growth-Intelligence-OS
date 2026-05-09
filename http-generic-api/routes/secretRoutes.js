import { Router } from "express";
import crypto from "node:crypto";
import { getPool } from "../db.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";

const SAFE_SECRET_KEY = /^[a-zA-Z0-9._:-]{3,191}$/;

function secretKey() {
  const seed = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.BACKEND_API_KEY || "";
  if (!seed) throw new Error("No secret encryption key configured.");
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function parseMetadata(row) {
  if (!row?.metadata_json) return {};
  if (typeof row.metadata_json === "object") return row.metadata_json;
  try { return JSON.parse(row.metadata_json); } catch { return {}; }
}

function sanitizeSecret(row) {
  if (!row) return null;
  return {
    tenant_id: row.tenant_id || undefined,
    secret_key: row.secret_key,
    secret_type: row.secret_type,
    metadata: parseMetadata(row),
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeUploadBody(body = {}) {
  const secretKey = String(body.secret_key || "").trim();
  const secretType = String(body.secret_type || "text").trim().toLowerCase();
  const content = body.content;
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const createdBy = body.created_by || body.user_id || null;

  if (!SAFE_SECRET_KEY.test(secretKey)) {
    const error = new Error("secret_key is required and must use safe characters.");
    error.status = 400;
    error.code = "invalid_secret_key";
    throw error;
  }
  if (!content || typeof content !== "string") {
    const error = new Error("content is required.");
    error.status = 400;
    error.code = "missing_content";
    throw error;
  }

  return { secretKey, secretType, content, metadata, createdBy };
}

async function assertTenantSecretAccess({ tenantId, userId }) {
  if (!tenantId) {
    const error = new Error("tenant_id is required for tenant-scoped secrets.");
    error.status = 400;
    error.code = "missing_tenant_id";
    throw error;
  }
  if (!userId) {
    const error = new Error("user_id is required for tenant-scoped secrets.");
    error.status = 400;
    error.code = "missing_user_id";
    throw error;
  }

  const [rows] = await getPool().query(
    "SELECT role,status FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
    [tenantId, userId]
  );
  if (!rows[0]) {
    const error = new Error("No active tenant membership for this user.");
    error.status = 403;
    error.code = "tenant_secret_access_denied";
    throw error;
  }
  return rows[0];
}

async function upsertPlatformSecret({ secretKey, secretType, content, metadata, createdBy }) {
  const pool = getPool();
  const ciphertext = encryptValue(content);
  await pool.query(
    `INSERT INTO platform_secrets (secret_key, secret_type, value_ciphertext, metadata_json, status, created_by)
     VALUES (?, ?, ?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       secret_type = VALUES(secret_type),
       value_ciphertext = VALUES(value_ciphertext),
       metadata_json = VALUES(metadata_json),
       status = 'active',
       created_by = VALUES(created_by),
       updated_at = CURRENT_TIMESTAMP ,
    [secretKey, secretType, ciphertext, JSON.stringify(metadata || {}), createdBy]
  );

  if (secretKey === "github_app_private_key.primary") {
    const [rows] = await pool.query(
      "SELECT config_json FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
      ["github_app_installation.primary"]
    );
    const current = rows[0]?.config_json ? JSON.parse(rows[0].config_json) : {};
    const next = {
      ...current,
      private_key_secret_ref: `platform_secret:${secretKey}`,
      status: "ready_for_token_test",
    };
    await pool.query(
      `INSERT INTO platform_runtime_config (config_key, config_json, status, note)
       VALUES (>, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE  config_json = VALUES(config_json), status = 'active', note = VALUES(note), updated_at = CURRENT_TIMESTAMP`,
      ["github_app_installation.primary", JSON.stringify(next), "GitHub App private key uploaded as platform secret."]
    );
  }

  const [saved] = await pool.query(
    "SELECT secret_key,secret_type,metadata_json,status,created_by,created_at,updated_at FROM platform_secrets WHERE secret_key = ? LIMIT 1",
    [secretKey]
  );
  return sanitizeSecret(saved[0]);
}

async function upsertTenantSecret({ tenantId, secretKey, secretType, content, metadata, createdBy }) {
  const pool = getPool();
  const ciphertext = encryptValue(content);
  await pool.query(
    `INSERT INTO tenant_secrets (tenant_id, secret_key, secret_type, value_ciphertext, metadata_json, status, created_by)
     VALUES (>, ?, ?, ?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       secret_type = VALUES(secret_type),
       value_ciphertext = VALUES(value_ciphertext),
       metadata_json = VALUES(metadata_json),
       status = 'active',
       created_by = VALUES(created_by),
       updated_at = CURRENT_TIMESTAMP`,
    [tenantId, secretKey, secretType, ciphertext, JSON.stringify(metadata || {}), createdBy]
  );

  const [saved] = await pool.query(
    "SELECT tenant_id,secret_key,secret_type,metadata_json,status,created_by,created_at,updated_at FROM tenant_secrets WHERE tenant_id = ? AND secret_key = ? LIMIT 1",
    [tenantId, secretKey]
  );
  return sanitizeSecret(saved[0]);
}

export function buildSecretRoutes(deps) {
  const router = Router();
  const { requireBackendApiKey } = deps;

  router.post("/admin/secrets/upload", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const upload = normalizeUploadBody(req.body || {});
      const secret = await upsertPlatformSecret(upload);
      return res.status(200).json({ ok: true, scope: "platform", secret });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        error: { code: error.code || "secret_upload_failed", message: error.message },
      });
    }
  });

  router.get("/admin/secrets/:secret_key", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT secret_key,secret_type,metadata_json,status,created_by,created_at,updated_at FROM platform_secrets WHERE secret_key = ? LIMIT 1",
        [req.params.secret_key]
      );
      if (!rows[0]) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Secret not found." } });
      return res.json({ ok: true, scope: "platform", secret: sanitizeSecret(rows[0]) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: { code: "secret_read_failed", message: error.message } });
    }
  });

  router.post("/tenant/secrets/upload", requireBackendApiKey, async (req, res) => {
    try {
      const tenantId = String(req.body?.tenant_id || "").trim();
      const userId = String(req.body?.user_id || req.body?.created_by || "").trim();
      await assertTenantSecretAccess({ tenantId, userId });

      const upload = normalizeUploadBody({ ...req.body, created_by: userId });
      const secret = await upsertTenantSecret({ tenantId, ...upload });
      return res.status(200).json({ ok: true, scope: "tenant", tenant_id: tenantId, secret });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        error: { code: error.code || "tenant_secret_upload_failed", message: error.message },
      });
    }
  });

  router.get("/tenant/secrets/:secret_key", requireBackendApiKey, async (req, res) => {
    try {
      const tenantId = String(req.query?.tenant_id || "").trim();
      const userId = String(req.query?.user_id || "").trim();
      await assertTenantSecretAccess({ tenantId, userId });

      const [rows] = await getPool().query(
        "SELECT tenant_id,secret_key,secret_type,metadata_json,status,created_by,created_at,updated_at FROM tenant_secrets WHERE tenant_id = ? AND secret_key = ? LIMIT 1",
        [tenantId, req.params.secret_key]
      );
      if (!rows[0]) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Secret not found." } });
      return res.json({ ok: true, scope: "tenant", tenant_id: tenantId, secret: sanitizeSecret(rows[0]) });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        error: { code: error.code || "tenant_secret_read_failed", message: error.message },
      });
    }
  });

  return router;
}
