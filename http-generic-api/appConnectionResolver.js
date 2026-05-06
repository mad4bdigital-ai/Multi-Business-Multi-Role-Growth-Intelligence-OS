// appConnectionResolver.js — workspace app context loader for agents.
// Resolves which app connections are available for a given workspace + agent,
// and which actions are allowed. Does NOT decrypt or expose tokens.

import { getPool } from "./db.js";

/**
 * Returns an array of safe app-connection descriptors for a workspace.
 * Each descriptor lists the app_key, connection metadata, and allowed actions.
 * Tokens are never included — they are only decrypted at executeAppAction() time.
 *
 * @param {string} workspace_key
 * @param {string} tenant_id
 * @param {string|null} agent_id  — when provided, filters to explicitly granted actions first
 * @returns {Promise<{ connected_apps: AppContextEntry[], workspace_key: string }>}
 */
export async function loadWorkspaceAppContext(workspace_key, tenant_id, agent_id = null) {
  if (!workspace_key || !tenant_id) return { connected_apps: [], workspace_key };

  // 1. Resolve workspace_id from key
  const [wsRows] = await getPool().query(
    "SELECT workspace_id FROM `workspace_registry` WHERE workspace_key = ? AND tenant_id = ? LIMIT 1",
    [workspace_key, tenant_id]
  ).catch(() => [[]]);

  const workspace_id = wsRows[0]?.workspace_id;
  if (!workspace_id) return { connected_apps: [], workspace_key };

  // 2. Load all active workspace→connection links
  const [linkRows] = await getPool().query(
    `SELECT wal.link_id, wal.connection_id, wal.permission_mode,
            uac.app_key, uac.account_label, uac.account_metadata,
            uac.is_primary, uac.status AS conn_status,
            ai.display_name AS app_name, ai.auth_type, ai.app_category
     FROM \`workspace_app_links\` wal
     JOIN \`user_app_connections\` uac ON uac.connection_id = wal.connection_id
     JOIN \`app_integrations\`     ai  ON ai.app_key = uac.app_key
     WHERE wal.workspace_id = ? AND wal.status = 'active' AND uac.status = 'active'
     ORDER BY uac.app_key ASC, uac.is_primary DESC`,
    [workspace_id]
  ).catch(() => [[]]);

  if (!linkRows.length) return { connected_apps: [], workspace_key };

  const connectionIds = linkRows.map(r => r.connection_id);

  // 3. Load explicit grants for these connections (strict-mode grants)
  const [grantRows] = await getPool().query(
    `SELECT connection_id, action_key, auto_approve
     FROM \`app_action_grants\`
     WHERE connection_id IN (${connectionIds.map(() => "?").join(",")})
       AND (expires_at IS NULL OR expires_at > NOW())`,
    connectionIds
  ).catch(() => [[]]);

  // 4. Load default_action_grants from the link (permissive-mode)
  const [linkGrantRows] = await getPool().query(
    `SELECT connection_id, default_action_grants
     FROM \`workspace_app_links\`
     WHERE workspace_id = ? AND status = 'active'`,
    [workspace_id]
  ).catch(() => [[]]);

  // Build lookup maps
  const grantMap = {};
  for (const g of grantRows) {
    if (!grantMap[g.connection_id]) grantMap[g.connection_id] = [];
    grantMap[g.connection_id].push({ action_key: g.action_key, auto_approve: Boolean(g.auto_approve) });
  }

  const defaultGrantMap = {};
  for (const lg of linkGrantRows) {
    let defaults = [];
    try { defaults = JSON.parse(lg.default_action_grants || "[]"); } catch { defaults = []; }
    defaultGrantMap[lg.connection_id] = defaults;
  }

  // 5. Build safe context entries (no tokens)
  const connected_apps = linkRows.map(row => {
    let meta = {};
    try { meta = JSON.parse(row.account_metadata || "{}"); } catch { meta = {}; }

    const explicitGrants  = grantMap[row.connection_id]        || [];
    const defaultGrants   = defaultGrantMap[row.connection_id] || [];
    const permissionMode  = row.permission_mode || "strict";

    // Merge: explicit grants take precedence; permissive mode also includes defaults
    const allAllowed = new Map();
    for (const dg of defaultGrants) {
      allAllowed.set(dg.action_key, { action_key: dg.action_key, source: "default", auto_approve: true });
    }
    for (const eg of explicitGrants) {
      allAllowed.set(eg.action_key, { action_key: eg.action_key, source: "grant", auto_approve: Boolean(eg.auto_approve) });
    }

    return {
      connection_id:   row.connection_id,
      app_key:         row.app_key,
      app_name:        row.app_name,
      app_category:    row.app_category,
      auth_type:       row.auth_type,
      account_label:   row.account_label,
      account_summary: meta,
      is_primary:      Boolean(row.is_primary),
      permission_mode: permissionMode,
      allowed_actions: [...allAllowed.values()],
    };
  });

  return { connected_apps, workspace_key };
}

/**
 * Quick check: does a specific agent have permission to call action_key on connection_id?
 * Returns { allowed: boolean, mode: "grant"|"default"|"denied", auto_approve: boolean }
 */
export async function checkActionPermission(connection_id, action_key) {
  if (!connection_id || !action_key) return { allowed: false, mode: "denied", auto_approve: false };

  // Check explicit grant first
  const [grantRows] = await getPool().query(
    `SELECT auto_approve FROM \`app_action_grants\`
     WHERE connection_id = ? AND action_key = ?
       AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [connection_id, action_key]
  ).catch(() => [[]]);

  if (grantRows[0]) {
    return { allowed: true, mode: "grant", auto_approve: Boolean(grantRows[0].auto_approve) };
  }

  // Check permissive default grants on any workspace link for this connection
  const [linkRows] = await getPool().query(
    `SELECT default_action_grants, permission_mode
     FROM \`workspace_app_links\`
     WHERE connection_id = ? AND status = 'active' LIMIT 1`,
    [connection_id]
  ).catch(() => [[]]);

  if (linkRows[0]?.permission_mode === "permissive") {
    let defaults = [];
    try { defaults = JSON.parse(linkRows[0].default_action_grants || "[]"); } catch { defaults = []; }
    const match = defaults.find(d => d.action_key === action_key);
    if (match) return { allowed: true, mode: "default", auto_approve: Boolean(match.auto_approve) };
  }

  return { allowed: false, mode: "denied", auto_approve: false };
}
