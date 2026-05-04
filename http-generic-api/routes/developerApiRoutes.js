import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { getPool } from "../db.js";
import { writeAuditLogAsync } from "../auditLogger.js";

// API key format: pk_<8-char-prefix>_<32-char-random>
function generateApiKey() {
  const random = randomUUID().replace(/-/g, "");
  const prefix = random.slice(0, 8);
  const full = `pk_${prefix}_${random.slice(8, 40)}`;
  const hash = createHash("sha256").update(full).digest("hex");
  return { full, prefix, hash };
}

export function buildDeveloperApiRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /developer-apps ──────────────────────────────────────────────────
  router.post("/developer-apps", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, app_name, app_type = "server", scopes, redirect_uris, created_by } = req.body || {};
      if (!tenant_id || !app_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and app_name are required." } });
      }
      const app_id = randomUUID();
      const scopeStr = Array.isArray(scopes) ? scopes.join(",") : (scopes || null);
      const uriStr = Array.isArray(redirect_uris) ? redirect_uris.join(",") : (redirect_uris || null);
      await getPool().query(
        `INSERT INTO \`developer_apps\` (app_id, tenant_id, app_name, app_type, scopes, redirect_uris, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [app_id, tenant_id, app_name, app_type, scopeStr, uriStr, created_by || null]
      );
      writeAuditLogAsync({ tenant_id, actor_id: created_by, action: "developer_app.created", resource_type: "developer_app", resource_id: app_id });
      return res.status(201).json({ ok: true, app_id, tenant_id, app_name, app_type, status: "active" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "app_create_failed", message: err.message } });
    }
  });

  // ── PUT /developer-apps/:id ───────────────────────────────────────────────
  router.put("/developer-apps/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { app_name, app_type, scopes, redirect_uris, status } = req.body || {};
      if (!app_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "app_name is required." } });
      }
      const scopeStr = Array.isArray(scopes) ? scopes.join(",") : (scopes || null);
      const uriStr   = Array.isArray(redirect_uris) ? redirect_uris.join(",") : (redirect_uris || null);
      await getPool().query(
        `UPDATE \`developer_apps\`
         SET app_name=?, app_type=COALESCE(?,app_type), scopes=COALESCE(?,scopes),
             redirect_uris=COALESCE(?,redirect_uris), status=COALESCE(?,status)
         WHERE app_id=?`,
        [app_name, app_type || null, scopeStr, uriStr, status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, app_id: req.params.id, app_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "app_update_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/developer-apps ───────────────────────────────────────
  router.get("/tenants/:id/developer-apps", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT app_id, app_name, app_type, status, created_at FROM `developer_apps` WHERE tenant_id = ? ORDER BY created_at DESC",
        [req.params.id]
      );
      return res.status(200).json({ ok: true, apps: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "apps_list_failed", message: err.message } });
    }
  });

  // ── POST /developer-apps/:id/credentials ──────────────────────────────────
  // Generate a new API key for the app. The full key is returned ONCE — only
  // the hash is stored. After this response the key cannot be recovered.
  router.post("/developer-apps/:id/credentials", requireBackendApiKey, async (req, res) => {
    try {
      const { label, scopes, expires_at } = req.body || {};
      const [appRows] = await getPool().query(
        "SELECT tenant_id FROM `developer_apps` WHERE app_id = ? AND status = 'active' LIMIT 1",
        [req.params.id]
      );
      if (!appRows.length) {
        return res.status(404).json({ ok: false, error: { code: "app_not_found", message: "App not found or inactive." } });
      }

      const { full, prefix, hash } = generateApiKey();
      const credential_id = randomUUID();
      const tenant_id = appRows[0].tenant_id;
      const scopeStr = Array.isArray(scopes) ? scopes.join(",") : (scopes || null);

      await getPool().query(
        `INSERT INTO \`api_credentials\` (credential_id, app_id, tenant_id, key_prefix, key_hash, label, scopes, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [credential_id, req.params.id, tenant_id, prefix, hash, label || null, scopeStr, expires_at || null]
      );
      writeAuditLogAsync({ tenant_id, action: "api_credential.created", resource_type: "api_credential", resource_id: credential_id });

      return res.status(201).json({
        ok: true,
        credential_id,
        app_id: req.params.id,
        api_key: full,
        key_prefix: prefix,
        warning: "Store this key securely. It will not be shown again.",
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "credential_create_failed", message: err.message } });
    }
  });

  // ── DELETE /api-credentials/:id ───────────────────────────────────────────
  router.delete("/api-credentials/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query(
        "UPDATE `api_credentials` SET status = 'revoked' WHERE credential_id = ?",
        [req.params.id]
      );
      writeAuditLogAsync({ action: "api_credential.revoked", resource_type: "api_credential", resource_id: req.params.id });
      return res.status(200).json({ ok: true, credential_id: req.params.id, status: "revoked" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "credential_revoke_failed", message: err.message } });
    }
  });

  // ── POST /webhooks ────────────────────────────────────────────────────────
  router.post("/webhooks", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, app_id, url, events, secret } = req.body || {};
      if (!tenant_id || !url || !events) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id, url, and events are required." } });
      }
      const webhook_id = randomUUID();
      const eventStr = Array.isArray(events) ? events.join(",") : events;
      const secret_hash = secret ? createHash("sha256").update(secret).digest("hex") : null;
      await getPool().query(
        `INSERT INTO \`webhooks\` (webhook_id, tenant_id, app_id, url, events, secret_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [webhook_id, tenant_id, app_id || null, url, eventStr, secret_hash]
      );
      return res.status(201).json({ ok: true, webhook_id, tenant_id, url, events: eventStr.split(","), status: "active" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "webhook_create_failed", message: err.message } });
    }
  });

  // ── PUT /webhooks/:id ─────────────────────────────────────────────────────
  router.put("/webhooks/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { url, events, status } = req.body || {};
      if (!url || !events) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "url and events are required." } });
      }
      const eventStr = Array.isArray(events) ? events.join(",") : events;
      await getPool().query(
        `UPDATE \`webhooks\` SET url=?, events=?, status=COALESCE(?,status) WHERE webhook_id=?`,
        [url, eventStr, status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, webhook_id: req.params.id, url, events: eventStr.split(",") });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "webhook_update_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/webhooks ─────────────────────────────────────────────
  router.get("/tenants/:id/webhooks", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT webhook_id, url, events, status, failure_count, last_fired_at, created_at
         FROM \`webhooks\` WHERE tenant_id = ? ORDER BY created_at DESC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, webhooks: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "webhooks_list_failed", message: err.message } });
    }
  });

  // ── POST /rate-limit-rules ────────────────────────────────────────────────
  router.post("/rate-limit-rules", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, plan_key, app_id, route_pattern, window_sec = 60, max_requests = 100, action = "block" } = req.body || {};
      if (!route_pattern) return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "route_pattern is required." } });
      const rule_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`rate_limit_rules\` (rule_id, tenant_id, plan_key, app_id, route_pattern, window_sec, max_requests, action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [rule_id, tenant_id || null, plan_key || null, app_id || null, route_pattern, window_sec, max_requests, action]
      );
      return res.status(201).json({ ok: true, rule_id, route_pattern, window_sec, max_requests, action });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "rate_limit_create_failed", message: err.message } });
    }
  });

  return router;
}
