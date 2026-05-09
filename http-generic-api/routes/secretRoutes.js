import { Router } from "express";
import crypto from "node:crypto";
import { getPool } from "../db.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";

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

function sanitizeSecret(row) {
  if (!row) return null;
  return {
    secret_key: row.secret_key,
    secret_type: row.secret_type,
    metadata: typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json || "{}") : row.metadata_json,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function buildSecretRoutes(deps) {
  const router = Router();
  const { requireBackendApiKey } = deps;

  router.post("/admin/secrets/upload", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { secret_key, secret_type = "text", content, metadata = {}, created_by = null } = req.body || {};
    if (!secret_key || typeof secret_key !== "string" || !/^[a-zA-Z0-9._:-]{3,191}$/.test(secret_key)) {
      return res.status(400).json({ ok: false, error: { code: "invalid_secret_key", message: "secret_key is required and must use safe characters." } });
    }
    if (!content || typeof content !== "string") {
      return res.status(400).json({ ok: false, error: { code: "missing_content", message: "content is required." } });
    }

    try {
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
           updated_at = CURRENT_TIMESTAMP`,
        [secret_key, secret_type, ciphertext, JSON.stringify(metadata || {}), created_by]
      );

      if (secret_key === "github_app_private_key.primary") {
        const [rows] = await pool.query("SELECT config_json FROM platform_runtime_config WHERE config_key = ? LIMIT 1", ["github_app_installation.primary"]);
        const current = rows[0]?.config_json ? JSON.parse(rows[0].config_json) : {};
        const next = { ...current, private_key_secret_ref: `platform_secret:${secret_key}`, status: "ready_for_token_test" };
        await pool.query(
          `INSERT INTO platform_runtime_config (config_key, config_json, status, note)
           VALUES (?, ?, 'active', ?)
           ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), status = 'active', note = VALUES(note), updated_at = CURRENT_TIMESTAMP`,
          ["github_app_installation.primary", JSON.stringify(next), "GitHub App private key uploaded as platform secret."]
        );
      }

      const [saved] = await pool.query("SELECT secret_key, secret_type, metadata_json, status, created_by, created_at, updated_at FROM platform_secrets WHERE secret_key = ? LIMIT 1", [secret_key]);
      return res.status(200).json({ ok: true, secret: sanitizeSecret(saved[0]) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: { code: "secret_upload_failed", message: error.message } });
    }
  });

  router.get("/admin/secrets/:secret_key", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const [rows] = await getPool().query("SELECT secret_key, secret_type, metadata_json, status, created_by, created_at, updated_at FROM platform_secrets WHERE secret_key = ? LIMIT 1", [req.params.secret_key]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: { code: "not_found", message: "Secret not found." } });
      return res.json({ ok: true, secret: sanitizeSecret(rows[0]) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: { code: "secret_read_failed", message: error.message } });
    }
  });

  return router;
}
