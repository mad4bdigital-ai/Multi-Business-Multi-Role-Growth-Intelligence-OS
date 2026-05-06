// routes/appIntegrationRoutes.js — Sprint 25: User App Integrations
//
// Covers:
//   App catalog       GET /app-integrations, GET /app-integrations/:app_key
//   OAuth flow        GET /app-integrations/:app_key/authorize
//                     GET /app-integrations/:app_key/callback
//   Manual connect    POST /app-connections  (api_key, webhook, mcp, bearer_token)
//   User connections  GET /users/:id/connections
//                     GET /users/:id/connections/:cid
//                     POST /users/:id/connections/:cid/test
//                     DELETE /users/:id/connections/:cid
//   Workspace links   POST /workspaces/:id/app-links
//                     GET  /workspaces/:id/app-links
//                     DELETE /workspaces/:id/app-links/:link_id
//   Action grants     POST /app-connections/:id/grants
//   (strict mode)     GET  /app-connections/:id/grants
//                     DELETE /app-connections/:id/grants/:gid
//   Action requests   POST /app-connections/:id/grant-requests  (agent permissive path)
//   (permissive)      GET  /app-connections/:id/grant-requests
//                     PATCH /app-connections/:id/grant-requests/:rid
//   Agent execution   POST /app-connections/:id/execute

import { Router }       from "express";
import { randomUUID }   from "node:crypto";
import { createHmac }   from "node:crypto";
import { getPool }      from "../db.js";
import { encryptCredentials, decryptCredentials } from "../tokenEncryption.js";
import { getAdapter, getOAuthConfig, executeAppAction } from "../appAdapters/index.js";
import { writeAuditLog } from "../auditLogger.js";

// ── OAuth state helpers (HMAC-signed, no DB needed) ───────────────────────────

function buildOAuthState(payload) {
  const json  = JSON.stringify({ ...payload, nonce: randomUUID() });
  const b64   = Buffer.from(json).toString("base64url");
  const sig   = createHmac("sha256", process.env.TOKEN_ENCRYPTION_KEY || "fallback")
                  .update(b64).digest("hex");
  return `${b64}.${sig}`;
}

function parseOAuthState(state) {
  const [b64, sig] = (state || "").split(".");
  if (!b64 || !sig) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", process.env.TOKEN_ENCRYPTION_KEY || "fallback")
                     .update(b64).digest("hex");
  if (expected !== sig) throw new Error("OAuth state signature invalid — possible CSRF");
  return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadConnection(connection_id) {
  const [rows] = await getPool().query(
    "SELECT * FROM `user_app_connections` WHERE connection_id = ? LIMIT 1",
    [connection_id]
  );
  return rows[0] || null;
}

async function loadAppIntegration(app_key) {
  const [rows] = await getPool().query(
    "SELECT * FROM `app_integrations` WHERE app_key = ? LIMIT 1", [app_key]
  );
  return rows[0] || null;
}

// Checks if an action is in the app's default_action_grants (permissive auto-approve)
function isDefaultGrant(appIntegration, action_key) {
  if (!appIntegration?.default_action_grants) return false;
  let grants = appIntegration.default_action_grants;
  if (typeof grants === "string") try { grants = JSON.parse(grants); } catch { return false; }
  return Array.isArray(grants) && grants.some(g => g.action_key === action_key && g.auto_approve);
}

// ── Route builder ─────────────────────────────────────────────────────────────

export function buildAppIntegrationRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── GET /app-integrations — catalog ────────────────────────────────────────
  router.get("/app-integrations", async (req, res) => {
    try {
      const { category, auth_type, status = "active" } = req.query;
      let sql = "SELECT app_key, display_name, description, auth_type, icon_url, docs_url, category, default_action_grants, status FROM `app_integrations` WHERE status = ?";
      const params = [status];
      if (category)  { sql += " AND category = ?";  params.push(category); }
      if (auth_type) { sql += " AND auth_type = ?";  params.push(auth_type); }
      sql += " ORDER BY category, display_name";
      const [rows] = await getPool().query(sql, params);
      res.json({ integrations: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /app-integrations/:app_key ─────────────────────────────────────────
  router.get("/app-integrations/:app_key", async (req, res) => {
    try {
      const app = await loadAppIntegration(req.params.app_key);
      if (!app) return res.status(404).json({ error: "app_not_found" });
      const adapter = getAdapter(req.params.app_key);
      const { oauth_authorize_url: _, ...safe } = app;
      res.json({ integration: safe, default_grants: adapter?.getDefaultGrants() || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /app-integrations/:app_key/authorize — start OAuth flow ────────────
  // Returns { authorize_url } for the frontend to redirect the user to.
  // Query: user_id, tenant_id, workspace_id? (workspace to auto-link after connect)
  router.get("/app-integrations/:app_key/authorize", async (req, res) => {
    try {
      const { user_id, tenant_id, workspace_id, redirect_back } = req.query;
      if (!user_id || !tenant_id) return res.status(400).json({ error: "user_id and tenant_id required" });

      const app = await loadAppIntegration(req.params.app_key);
      if (!app) return res.status(404).json({ error: "app_not_found" });
      if (app.auth_type !== "oauth2") return res.status(400).json({ error: "app does not use OAuth2", auth_type: app.auth_type });

      const adapter = getAdapter(req.params.app_key);
      if (!adapter?.buildAuthUrl) return res.status(400).json({ error: "no OAuth handler for this app" });

      const config = getOAuthConfig(req.params.app_key);
      if (!config.client_id) return res.status(503).json({ error: `${req.params.app_key.toUpperCase().replace(/-/g,"_")}_CLIENT_ID not configured` });

      const state = buildOAuthState({ user_id, tenant_id, workspace_id: workspace_id || null, redirect_back: redirect_back || null });
      const authorize_url = adapter.buildAuthUrl(config, state);

      res.json({ authorize_url, app_key: req.params.app_key, state_preview: { user_id, tenant_id, workspace_id } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /app-integrations/:app_key/callback — OAuth callback ───────────────
  // Called by the OAuth provider after user approval.
  // Stores encrypted tokens. Redirects to redirect_back if provided.
  router.get("/app-integrations/:app_key/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;
      if (oauthError) return res.status(400).json({ error: `OAuth denied: ${oauthError}` });
      if (!code || !state) return res.status(400).json({ error: "code and state required" });

      let stateData;
      try { stateData = parseOAuthState(state); } catch (e) {
        return res.status(400).json({ error: e.message });
      }

      const { user_id, tenant_id, workspace_id, redirect_back } = stateData;
      const app_key = req.params.app_key;

      const app     = await loadAppIntegration(app_key);
      const adapter = getAdapter(app_key);
      if (!app || !adapter) return res.status(404).json({ error: "app_not_found" });

      const config  = getOAuthConfig(app_key);
      const tokens  = await adapter.exchangeCode(code, config);

      // Test connection to get account label + metadata
      const creds = {
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        scope:         tokens.scope         || null,
        ...tokens,
      };
      let testResult = { ok: false, account_label: null, account_metadata: {} };
      try { testResult = await adapter.testConnection(creds, {}); } catch {}

      const connection_id = randomUUID();
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString().slice(0, 19).replace("T", " ")
        : null;

      await getPool().query(
        `INSERT INTO \`user_app_connections\`
           (connection_id, user_id, tenant_id, app_key, auth_type, encrypted_credentials,
            token_expires_at, scopes_granted, account_label, account_metadata, is_primary, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(is_primary),0)=0 FROM \`user_app_connections\` uac WHERE uac.user_id=? AND uac.app_key=? FOR UPDATE),'active')
         ON DUPLICATE KEY UPDATE
           encrypted_credentials = VALUES(encrypted_credentials),
           token_expires_at      = VALUES(token_expires_at),
           scopes_granted        = VALUES(scopes_granted),
           account_label         = VALUES(account_label),
           account_metadata      = VALUES(account_metadata),
           status                = 'active'`,
        [
          connection_id, user_id, tenant_id, app_key, "oauth2",
          encryptCredentials(creds), expiresAt,
          tokens.scope || null,
          testResult.account_label || null,
          JSON.stringify(testResult.account_metadata || {}),
          user_id, app_key,
        ]
      );

      // Auto-link to workspace if workspace_id was in state
      if (workspace_id) {
        const [wr] = await getPool().query(
          "SELECT workspace_key, tenant_id FROM `workspace_registry` WHERE workspace_id = ? LIMIT 1",
          [workspace_id]
        );
        if (wr[0]) {
          await getPool().query(
            `INSERT IGNORE INTO \`workspace_app_links\`
               (link_id, workspace_id, workspace_key, tenant_id, connection_id, app_key, linked_by, status)
             VALUES (?,?,?,?,?,?,?,'active')`,
            [randomUUID(), workspace_id, wr[0].workspace_key, wr[0].tenant_id, connection_id, app_key, user_id]
          );
        }
      }

      await writeAuditLog({
        actor_id: user_id, tenant_id, action: "app_connection.created",
        resource_type: "user_app_connection", resource_id: connection_id,
        meta: { app_key, account_label: testResult.account_label },
      }).catch(() => {});

      if (redirect_back) {
        const redir = new URL(redirect_back);
        redir.searchParams.set("connection_id", connection_id);
        redir.searchParams.set("app_key",       app_key);
        redir.searchParams.set("status",         "connected");
        return res.redirect(302, redir.toString());
      }
      res.json({ ok: true, connection_id, app_key, account_label: testResult.account_label, status: "active" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /app-connections — manual connect (api_key, webhook, mcp, bearer) ─
  router.post("/app-connections", async (req, res) => {
    try {
      const {
        user_id, tenant_id, app_key, auth_type, display_label,
        credentials,         // { api_key?, bearer_token?, mcp_bearer?, webhook_secret?, username?, password? }
        mcp_endpoint, webhook_url, api_base_url,
        workspace_id,
      } = req.body;

      if (!user_id || !tenant_id || !app_key || !auth_type)
        return res.status(400).json({ error: "user_id, tenant_id, app_key, auth_type required" });
      if (!credentials || typeof credentials !== "object")
        return res.status(400).json({ error: "credentials object required" });

      const app = await loadAppIntegration(app_key);
      if (!app) return res.status(404).json({ error: "app_not_found" });

      const adapter = getAdapter(app_key);
      const connection_stub = { mcp_endpoint, webhook_url, api_base_url };

      let testResult = { ok: true, account_label: null, account_metadata: {} };
      if (adapter?.testConnection) {
        try { testResult = await adapter.testConnection(credentials, connection_stub); } catch {}
      }

      const connection_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`user_app_connections\`
           (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
            encrypted_credentials, account_label, account_metadata,
            mcp_endpoint, webhook_url, api_base_url, is_primary, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active')`,
        [
          connection_id, user_id, tenant_id, app_key, display_label || null, auth_type,
          encryptCredentials(credentials),
          testResult.account_label || api_base_url || mcp_endpoint || webhook_url || null,
          JSON.stringify(testResult.account_metadata || {}),
          mcp_endpoint || null, webhook_url || null, api_base_url || null,
        ]
      );

      // Auto-link to workspace
      if (workspace_id) {
        const [wr] = await getPool().query(
          "SELECT workspace_key, tenant_id FROM `workspace_registry` WHERE workspace_id = ? LIMIT 1",
          [workspace_id]
        );
        if (wr[0]) {
          await getPool().query(
            `INSERT IGNORE INTO \`workspace_app_links\`
               (link_id, workspace_id, workspace_key, tenant_id, connection_id, app_key, linked_by, status)
             VALUES (?,?,?,?,?,?,?,'active')`,
            [randomUUID(), workspace_id, wr[0].workspace_key, wr[0].tenant_id, connection_id, app_key, user_id]
          );
        }
      }

      res.status(201).json({ ok: true, connection_id, app_key, auth_type, account_label: testResult.account_label, status: "active" });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "connection_already_exists" });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /users/:id/connections ─────────────────────────────────────────────
  router.get("/users/:id/connections", async (req, res) => {
    try {
      const { app_key, status = "active", tenant_id } = req.query;
      let sql = `SELECT connection_id, app_key, display_label, auth_type, account_label,
                        account_metadata, mcp_endpoint, webhook_url, api_base_url,
                        is_primary, status, connected_at, last_used_at
                 FROM \`user_app_connections\` WHERE user_id = ?`;
      const params = [req.params.id];
      if (status)    { sql += " AND status = ?";    params.push(status); }
      if (app_key)   { sql += " AND app_key = ?";   params.push(app_key); }
      if (tenant_id) { sql += " AND tenant_id = ?"; params.push(tenant_id); }
      sql += " ORDER BY app_key, connected_at DESC";
      const [rows] = await getPool().query(sql, params);
      res.json({ connections: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /users/:id/connections/:cid ────────────────────────────────────────
  router.get("/users/:id/connections/:cid", async (req, res) => {
    try {
      const conn = await loadConnection(req.params.cid);
      if (!conn || conn.user_id !== req.params.id)
        return res.status(404).json({ error: "connection_not_found" });
      const { encrypted_credentials: _, ...safe } = conn;  // never expose ciphertext
      res.json({ connection: safe });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /users/:id/connections/:cid/test ──────────────────────────────────
  router.post("/users/:id/connections/:cid/test", async (req, res) => {
    try {
      const conn = await loadConnection(req.params.cid);
      if (!conn || conn.user_id !== req.params.id)
        return res.status(404).json({ error: "connection_not_found" });

      const adapter = getAdapter(conn.app_key);
      if (!adapter?.testConnection)
        return res.status(400).json({ error: "no test handler for this app" });

      const creds = decryptCredentials(conn.encrypted_credentials);
      const result = await adapter.testConnection(creds, conn);

      if (result.ok && (result.account_label || result.account_metadata)) {
        await getPool().query(
          "UPDATE `user_app_connections` SET account_label = ?, account_metadata = ?, last_used_at = NOW() WHERE connection_id = ?",
          [result.account_label || conn.account_label, JSON.stringify(result.account_metadata || {}), conn.connection_id]
        ).catch(() => {});
      }

      res.json({ ok: result.ok, connection_id: conn.connection_id, app_key: conn.app_key, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /users/:id/connections/:cid — revoke ────────────────────────────
  router.delete("/users/:id/connections/:cid", async (req, res) => {
    try {
      const conn = await loadConnection(req.params.cid);
      if (!conn || conn.user_id !== req.params.id)
        return res.status(404).json({ error: "connection_not_found" });

      await getPool().query(
        "UPDATE `user_app_connections` SET status = 'revoked', encrypted_credentials = NULL WHERE connection_id = ?",
        [conn.connection_id]
      );
      await getPool().query(
        "UPDATE `workspace_app_links` SET status = 'removed' WHERE connection_id = ?",
        [conn.connection_id]
      );
      res.json({ ok: true, connection_id: conn.connection_id, status: "revoked" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /workspaces/:id/app-links — link a connection to a workspace ──────
  router.post("/workspaces/:id/app-links", async (req, res) => {
    try {
      const { connection_id, linked_by } = req.body;
      if (!connection_id) return res.status(400).json({ error: "connection_id required" });

      const conn = await loadConnection(connection_id);
      if (!conn) return res.status(404).json({ error: "connection_not_found" });

      const [wr] = await getPool().query(
        "SELECT workspace_id, workspace_key, tenant_id FROM `workspace_registry` WHERE workspace_id = ? LIMIT 1",
        [req.params.id]
      );
      if (!wr[0]) return res.status(404).json({ error: "workspace_not_found" });

      const link_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`workspace_app_links\`
           (link_id, workspace_id, workspace_key, tenant_id, connection_id, app_key, linked_by, status)
         VALUES (?,?,?,?,?,?,?,'active')
         ON DUPLICATE KEY UPDATE status = 'active'`,
        [link_id, wr[0].workspace_id, wr[0].workspace_key, wr[0].tenant_id,
         connection_id, conn.app_key, linked_by || null]
      );

      // Seed default_permissive grants from app catalog
      const app = await loadAppIntegration(conn.app_key);
      let defaults = [];
      if (app?.default_action_grants) {
        try {
          defaults = typeof app.default_action_grants === "string"
            ? JSON.parse(app.default_action_grants) : app.default_action_grants;
        } catch {}
      }
      for (const dg of (defaults || [])) {
        if (!dg.auto_approve) continue;
        await getPool().query(
          `INSERT IGNORE INTO \`app_action_grants\`
             (grant_id, connection_id, workspace_id, agent_id, app_key, action_key, grant_mode, granted_by, status)
           VALUES (?,?,?,NULL,?,?,'default_permissive',NULL,'active')`,
          [randomUUID(), connection_id, wr[0].workspace_id, conn.app_key, dg.action_key]
        );
      }

      res.status(201).json({ ok: true, link_id, workspace_id: wr[0].workspace_id, connection_id, app_key: conn.app_key });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "already_linked" });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /workspaces/:id/app-links ──────────────────────────────────────────
  router.get("/workspaces/:id/app-links", async (req, res) => {
    try {
      const { status = "active" } = req.query;
      const [rows] = await getPool().query(
        `SELECT wal.link_id, wal.connection_id, wal.app_key, wal.linked_by, wal.status, wal.created_at,
                uac.display_label, uac.account_label, uac.account_metadata,
                uac.mcp_endpoint, uac.webhook_url, uac.api_base_url,
                uac.auth_type, uac.last_used_at,
                ai.display_name AS app_display_name, ai.icon_url, ai.category
         FROM \`workspace_app_links\` wal
         JOIN \`user_app_connections\` uac ON uac.connection_id = wal.connection_id
         LEFT JOIN \`app_integrations\` ai ON ai.app_key = wal.app_key
         WHERE wal.workspace_id = ? AND wal.status = ?
         ORDER BY ai.category, wal.app_key`,
        [req.params.id, status]
      );
      res.json({ links: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /workspaces/:id/app-links/:link_id ──────────────────────────────
  router.delete("/workspaces/:id/app-links/:link_id", async (req, res) => {
    try {
      await getPool().query(
        "UPDATE `workspace_app_links` SET status = 'removed' WHERE link_id = ? AND workspace_id = ?",
        [req.params.link_id, req.params.id]
      );
      res.json({ ok: true, link_id: req.params.link_id, status: "removed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /app-connections/:id/grants — explicit agent grant ────────────────
  router.post("/app-connections/:id/grants", async (req, res) => {
    try {
      const { agent_id, action_key, workspace_id, granted_by, expires_at } = req.body;
      if (!action_key) return res.status(400).json({ error: "action_key required" });

      const conn = await loadConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: "connection_not_found" });

      const grant_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`app_action_grants\`
           (grant_id, connection_id, workspace_id, agent_id, app_key, action_key, grant_mode, granted_by, expires_at, status)
         VALUES (?,?,?,?,?,?,'explicit',?,?,'active')
         ON DUPLICATE KEY UPDATE grant_mode='explicit', status='active', granted_by=VALUES(granted_by), expires_at=VALUES(expires_at)`,
        [grant_id, conn.connection_id, workspace_id || null, agent_id || null,
         conn.app_key, action_key, granted_by || null, expires_at || null]
      );
      res.status(201).json({ ok: true, grant_id, connection_id: conn.connection_id, agent_id: agent_id || null, action_key });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /app-connections/:id/grants ────────────────────────────────────────
  router.get("/app-connections/:id/grants", async (req, res) => {
    try {
      const { agent_id, status = "active" } = req.query;
      let sql = "SELECT * FROM `app_action_grants` WHERE connection_id = ? AND status = ?";
      const params = [req.params.id, status];
      if (agent_id) { sql += " AND (agent_id = ? OR agent_id IS NULL)"; params.push(agent_id); }
      sql += " ORDER BY action_key";
      const [rows] = await getPool().query(sql, params);
      res.json({ grants: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /app-connections/:id/grants/:gid ────────────────────────────────
  router.delete("/app-connections/:id/grants/:gid", async (req, res) => {
    try {
      await getPool().query(
        "UPDATE `app_action_grants` SET status = 'revoked' WHERE grant_id = ? AND connection_id = ?",
        [req.params.gid, req.params.id]
      );
      res.json({ ok: true, grant_id: req.params.gid, status: "revoked" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /app-connections/:id/grant-requests — agent requests access ───────
  // Agent-initiated: "I need google_drive.write_file to complete this task."
  // Auto-approved if in app.default_action_grants; otherwise pending for user review.
  router.post("/app-connections/:id/grant-requests", async (req, res) => {
    try {
      const { agent_id, action_key, workspace_id, run_id, request_reason, expires_at } = req.body;
      if (!agent_id || !action_key) return res.status(400).json({ error: "agent_id and action_key required" });

      const conn = await loadConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: "connection_not_found" });

      // Check existing active grant first
      const [existing] = await getPool().query(
        `SELECT grant_id FROM \`app_action_grants\`
         WHERE connection_id = ? AND action_key = ? AND status = 'active'
           AND (agent_id IS NULL OR agent_id = ?)
           AND (workspace_id IS NULL OR workspace_id = ?)
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [conn.connection_id, action_key, agent_id, workspace_id || null]
      );
      if (existing[0]) {
        return res.json({ ok: true, already_granted: true, grant_id: existing[0].grant_id, action_key });
      }

      const app = await loadAppIntegration(conn.app_key);
      const auto_approve = isDefaultGrant(app, action_key) ? 1 : 0;

      const request_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`app_action_requests\`
           (request_id, connection_id, workspace_id, agent_id, run_id, app_key, action_key, request_reason, auto_approve, status, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,IF(?=1,'approved','pending'),?)`,
        [request_id, conn.connection_id, workspace_id || null, agent_id, run_id || null,
         conn.app_key, action_key, request_reason || null, auto_approve,
         auto_approve, expires_at || null]
      );

      // If auto-approved, also create the grant
      let grant_id = null;
      if (auto_approve) {
        grant_id = randomUUID();
        await getPool().query(
          `INSERT IGNORE INTO \`app_action_grants\`
             (grant_id, connection_id, workspace_id, agent_id, app_key, action_key, grant_mode, expires_at, status)
           VALUES (?,?,?,?,?,?,'auto_approved',?,'active')`,
          [grant_id, conn.connection_id, workspace_id || null, agent_id, conn.app_key, action_key, expires_at || null]
        );
      }

      res.status(auto_approve ? 200 : 202).json({
        ok:           true,
        request_id,
        action_key,
        status:       auto_approve ? "approved" : "pending",
        auto_approved: !!auto_approve,
        grant_id,
        message:      auto_approve
          ? "Auto-approved via app default grants"
          : "Request queued for user review",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /app-connections/:id/grant-requests ────────────────────────────────
  router.get("/app-connections/:id/grant-requests", async (req, res) => {
    try {
      const { status, agent_id } = req.query;
      let sql = "SELECT * FROM `app_action_requests` WHERE connection_id = ?";
      const params = [req.params.id];
      if (status)   { sql += " AND status = ?";   params.push(status); }
      if (agent_id) { sql += " AND agent_id = ?"; params.push(agent_id); }
      sql += " ORDER BY created_at DESC LIMIT 200";
      const [rows] = await getPool().query(sql, params);
      res.json({ requests: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /app-connections/:id/grant-requests/:rid — user reviews request ──
  router.patch("/app-connections/:id/grant-requests/:rid", async (req, res) => {
    try {
      const { status, reviewed_by } = req.body;
      if (!["approved", "denied"].includes(status))
        return res.status(400).json({ error: "status must be approved or denied" });

      const [rows] = await getPool().query(
        "SELECT * FROM `app_action_requests` WHERE request_id = ? AND connection_id = ? LIMIT 1",
        [req.params.rid, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "request_not_found" });
      const req_ = rows[0];

      await getPool().query(
        "UPDATE `app_action_requests` SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE request_id = ?",
        [status, reviewed_by || null, req_.request_id]
      );

      let grant_id = null;
      if (status === "approved") {
        grant_id = randomUUID();
        await getPool().query(
          `INSERT IGNORE INTO \`app_action_grants\`
             (grant_id, connection_id, workspace_id, agent_id, app_key, action_key, grant_mode, granted_by, status)
           VALUES (?,?,?,?,?,?,'explicit',?,'active')`,
          [grant_id, req_.connection_id, req_.workspace_id, req_.agent_id,
           req_.app_key, req_.action_key, reviewed_by || null]
        );
      }

      res.json({ ok: true, request_id: req_.request_id, status, grant_id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /app-connections/:id/execute — agent executes an action ───────────
  // The token is retrieved at execution time, never stored in context.
  // Checks: connection active + agent has grant for action_key.
  router.post("/app-connections/:id/execute", async (req, res) => {
    try {
      const { agent_id, action_key, args = {}, workspace_id, run_id } = req.body;
      if (!action_key) return res.status(400).json({ error: "action_key required" });

      const conn = await loadConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: "connection_not_found" });
      if (conn.status !== "active") return res.status(403).json({ error: "connection_not_active", status: conn.status });

      // Grant check: must have explicit, default_permissive, or auto_approved grant
      const [grants] = await getPool().query(
        `SELECT grant_id FROM \`app_action_grants\`
         WHERE connection_id = ? AND action_key = ? AND status = 'active'
           AND (agent_id IS NULL OR agent_id = ?)
           AND (workspace_id IS NULL OR workspace_id = ?)
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [conn.connection_id, action_key, agent_id || null, workspace_id || null]
      );
      if (!grants[0]) {
        return res.status(403).json({
          error:      "action_not_granted",
          action_key,
          hint:       "POST /app-connections/:id/grant-requests to request access",
        });
      }

      const result = await executeAppAction(conn, action_key, args);

      await writeAuditLog({
        actor_id:      agent_id || "system",
        actor_type:    "agent",
        action:        `app.${conn.app_key}.${action_key}`,
        resource_type: "user_app_connection",
        resource_id:   conn.connection_id,
        tenant_id:     conn.tenant_id,
        outcome:       result.ok ? "success" : "failure",
        metadata:      { run_id, workspace_id, action_key },
      }).catch(() => {});

      res.json({ ok: result.ok, connection_id: conn.connection_id, app_key: conn.app_key, action_key, result: result.result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
