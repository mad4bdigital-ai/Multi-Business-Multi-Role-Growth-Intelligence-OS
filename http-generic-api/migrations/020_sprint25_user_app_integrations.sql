-- Sprint 25: User App Integrations — Co-Founder Account Management Layer
-- Allows users to connect their external accounts (Google Drive, Notion, GitHub,
-- Slack, any webhook/API/MCP) to workspaces, with strict + permissive agent grants.
-- All statements idempotent.

-- ─── Patch workspace_registry ────────────────────────────────────────────────
-- Add user ownership + bootstrap trigger tracking.

ALTER TABLE `workspace_registry`
  ADD COLUMN IF NOT EXISTS `created_by`               VARCHAR(36)   NULL COMMENT 'user_id who created this workspace',
  ADD COLUMN IF NOT EXISTS `bootstrap_trigger_run_id` VARCHAR(36)   NULL COMMENT 'run_id of the brand_onboarding_bootstrap workflow';

-- ─── App integration catalog ──────────────────────────────────────────────────
-- Platform-seeded list of available apps. OAuth credentials (client_id/secret)
-- are stored in env vars (GOOGLE_DRIVE_CLIENT_ID etc.), NOT in this table.

CREATE TABLE IF NOT EXISTS `app_integrations` (
  `id`                    INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `app_key`               VARCHAR(64)   NOT NULL UNIQUE COMMENT 'google_drive|notion|github|slack|webhook|api_key|mcp',
  `display_name`          VARCHAR(128)  NOT NULL,
  `description`           TEXT          NULL,
  `auth_type`             ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token') NOT NULL,
  `oauth_authorize_url`   VARCHAR(512)  NULL,
  `oauth_token_url`       VARCHAR(512)  NULL,
  `oauth_revoke_url`      VARCHAR(512)  NULL,
  `oauth_scopes_default`  TEXT          NULL COMMENT 'Space-separated default OAuth scopes',
  `mcp_server_info`       JSON          NULL COMMENT 'MCP server descriptor for MCP-type apps',
  `icon_url`              VARCHAR(512)  NULL,
  `docs_url`              VARCHAR(512)  NULL,
  `category`              VARCHAR(64)   NULL COMMENT 'files|communication|code|productivity|crm|custom',
  `default_action_grants` JSON          NULL COMMENT 'Actions auto-approved in permissive mode',
  `status`                ENUM('active','beta','deprecated') NOT NULL DEFAULT 'active',
  `created_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_app_category` (`category`),
  INDEX `idx_app_status`   (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── User app connections ─────────────────────────────────────────────────────
-- One row per connected account. All auth material stored in encrypted_credentials
-- as AES-256-GCM ciphertext (tokenEncryption.js). Never stored in plaintext.

CREATE TABLE IF NOT EXISTS `user_app_connections` (
  `id`                    INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `connection_id`         VARCHAR(36)   NOT NULL UNIQUE,
  `user_id`               VARCHAR(36)   NOT NULL,
  `tenant_id`             VARCHAR(36)   NOT NULL,
  `app_key`               VARCHAR(64)   NOT NULL,
  `display_label`         VARCHAR(128)  NULL COMMENT 'User-chosen label e.g. "My Work Drive"',
  `auth_type`             ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token') NOT NULL,
  -- Auth material — AES-256-GCM encrypted JSON blob
  -- Contains: { access_token, refresh_token, api_key, webhook_secret, mcp_bearer, ... }
  `encrypted_credentials` TEXT          NULL,
  `token_expires_at`      DATETIME      NULL COMMENT 'When the access_token expires (OAuth only)',
  `scopes_granted`        TEXT          NULL COMMENT 'Actual scopes returned by the provider',
  -- Non-sensitive account metadata (safe to display)
  `account_label`         VARCHAR(255)  NULL COMMENT 'e.g. user@gmail.com — identifier only, no tokens',
  `account_metadata`      JSON          NULL COMMENT 'avatar_url, account_id, display_name from provider',
  -- Connection-type-specific config (non-secret)
  `mcp_endpoint`          VARCHAR(512)  NULL COMMENT 'MCP server URL (auth in encrypted_credentials)',
  `webhook_url`           VARCHAR(512)  NULL COMMENT 'Webhook target URL',
  `api_base_url`          VARCHAR(512)  NULL COMMENT 'Base URL for custom API connections',
  `is_primary`            TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'Primary connection for this app per user',
  `status`                ENUM('active','expired','revoked','error') NOT NULL DEFAULT 'active',
  `connected_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at`          DATETIME      NULL,
  INDEX `idx_uac_user`    (`user_id`),
  INDEX `idx_uac_tenant`  (`tenant_id`),
  INDEX `idx_uac_app`     (`app_key`),
  INDEX `idx_uac_status`  (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Workspace ↔ app connection links ────────────────────────────────────────
-- A user can share a connection with a workspace so agents running in that
-- workspace context have access to it (subject to action grants).

CREATE TABLE IF NOT EXISTS `workspace_app_links` (
  `id`            INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `link_id`       VARCHAR(36)   NOT NULL UNIQUE,
  `workspace_id`  VARCHAR(36)   NOT NULL,
  `workspace_key` VARCHAR(128)  NULL,
  `tenant_id`     VARCHAR(36)   NOT NULL,
  `connection_id` VARCHAR(36)   NOT NULL,
  `app_key`       VARCHAR(64)   NOT NULL,
  `linked_by`     VARCHAR(36)   NULL COMMENT 'user_id who linked this connection to the workspace',
  `status`        ENUM('active','suspended','removed') NOT NULL DEFAULT 'active',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_workspace_connection` (`workspace_id`, `connection_id`),
  INDEX `idx_wal_workspace`  (`workspace_id`),
  INDEX `idx_wal_connection` (`connection_id`),
  INDEX `idx_wal_tenant`     (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent action grants (strict mode) ───────────────────────────────────────
-- User explicitly authorises a specific agent to perform a specific action
-- on a specific connection (optionally scoped to a workspace).

CREATE TABLE IF NOT EXISTS `app_action_grants` (
  `id`            INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `grant_id`      VARCHAR(36)   NOT NULL UNIQUE,
  `connection_id` VARCHAR(36)   NOT NULL,
  `workspace_id`  VARCHAR(36)   NULL COMMENT 'NULL = all workspaces this connection is linked to',
  `agent_id`      VARCHAR(36)   NULL COMMENT 'NULL = all agents',
  `app_key`       VARCHAR(64)   NOT NULL,
  `action_key`    VARCHAR(128)  NOT NULL COMMENT 'e.g. google_drive.read_file, notion.create_page',
  `grant_mode`    ENUM('explicit','default_permissive','auto_approved') NOT NULL DEFAULT 'explicit',
  `granted_by`    VARCHAR(36)   NULL COMMENT 'user_id who granted this',
  `expires_at`    DATETIME      NULL,
  `status`        ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_grant_scope` (`connection_id`, `agent_id`, `action_key`, `workspace_id`),
  INDEX `idx_aag_connection` (`connection_id`),
  INDEX `idx_aag_agent`      (`agent_id`),
  INDEX `idx_aag_status`     (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent action requests (permissive mode) ──────────────────────────────────
-- When an agent needs to use an app action it doesn't yet have a grant for,
-- it creates a request. Auto-approved if in app.default_action_grants, otherwise
-- queued for user review.

CREATE TABLE IF NOT EXISTS `app_action_requests` (
  `id`             INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `request_id`     VARCHAR(36)   NOT NULL UNIQUE,
  `connection_id`  VARCHAR(36)   NOT NULL,
  `workspace_id`   VARCHAR(36)   NULL,
  `agent_id`       VARCHAR(36)   NOT NULL,
  `run_id`         VARCHAR(36)   NULL COMMENT 'Execution run that triggered this request',
  `app_key`        VARCHAR(64)   NOT NULL,
  `action_key`     VARCHAR(128)  NOT NULL,
  `request_reason` TEXT          NULL COMMENT 'Agent-provided explanation for why it needs this',
  `auto_approve`   TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 if covered by app default_action_grants',
  `status`         ENUM('pending','approved','denied','expired') NOT NULL DEFAULT 'pending',
  `reviewed_by`    VARCHAR(36)   NULL,
  `reviewed_at`    DATETIME      NULL,
  `expires_at`     DATETIME      NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_aar_connection` (`connection_id`),
  INDEX `idx_aar_status`     (`status`),
  INDEX `idx_aar_agent`      (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Seed: app integration catalog ───────────────────────────────────────────

INSERT IGNORE INTO `app_integrations`
  (`app_key`, `display_name`, `description`, `auth_type`,
   `oauth_authorize_url`, `oauth_token_url`, `oauth_revoke_url`, `oauth_scopes_default`,
   `icon_url`, `docs_url`, `category`, `default_action_grants`, `status`)
VALUES
  -- Google Drive
  ('google_drive', 'Google Drive',
   'Read and write files, folders, and documents in Google Drive.',
   'oauth2',
   'https://accounts.google.com/o/oauth2/v2/auth',
   'https://oauth2.googleapis.com/token',
   'https://oauth2.googleapis.com/revoke',
   'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
   'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
   'https://developers.google.com/drive/api/guides/about-sdk',
   'files',
   '[{"action_key":"list_files","auto_approve":true},{"action_key":"read_file","auto_approve":true},{"action_key":"search_files","auto_approve":true}]',
   'active'),

  -- Notion
  ('notion', 'Notion',
   'Read and write pages and databases in Notion workspaces.',
   'oauth2',
   'https://api.notion.com/v1/oauth/authorize',
   'https://api.notion.com/v1/oauth/token',
   NULL,
   NULL,
   'https://www.notion.so/images/favicon.ico',
   'https://developers.notion.com/docs/getting-started',
   'productivity',
   '[{"action_key":"read_page","auto_approve":true},{"action_key":"list_databases","auto_approve":true},{"action_key":"query_database","auto_approve":true}]',
   'active'),

  -- GitHub
  ('github', 'GitHub',
   'Access repositories, read and write files, create pull requests and issues.',
   'oauth2',
   'https://github.com/login/oauth/authorize',
   'https://github.com/login/oauth/access_token',
   NULL,
   'repo read:user read:org',
   'https://github.githubassets.com/favicons/favicon.png',
   'https://docs.github.com/en/developers/apps/building-oauth-apps',
   'code',
   '[{"action_key":"list_repos","auto_approve":true},{"action_key":"read_file","auto_approve":true},{"action_key":"list_issues","auto_approve":true}]',
   'active'),

  -- Slack
  ('slack', 'Slack',
   'Send messages, read channels, and interact with Slack workspaces.',
   'oauth2',
   'https://slack.com/oauth/v2/authorize',
   'https://slack.com/api/oauth.v2.access',
   'https://slack.com/api/auth.revoke',
   'channels:read chat:write files:read users:read',
   'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
   'https://api.slack.com/authentication/oauth-v2',
   'communication',
   '[{"action_key":"list_channels","auto_approve":true},{"action_key":"read_channel","auto_approve":true}]',
   'active'),

  -- Generic webhook
  ('webhook', 'Custom Webhook',
   'Send HTTP POST payloads to any webhook endpoint (Zapier, Make, custom services).',
   'webhook',
   NULL, NULL, NULL, NULL,
   NULL,
   NULL,
   'custom',
   '[{"action_key":"call_webhook","auto_approve":true}]',
   'active'),

  -- Generic API key
  ('api_key', 'Custom API',
   'Call any REST API authenticated with an API key or bearer token.',
   'api_key',
   NULL, NULL, NULL, NULL,
   NULL,
   NULL,
   'custom',
   '[{"action_key":"call_api","auto_approve":true}]',
   'active'),

  -- MCP server
  ('mcp', 'MCP Server',
   'Connect to any Model Context Protocol server and invoke its tools.',
   'mcp',
   NULL, NULL, NULL, NULL,
   NULL,
   'https://modelcontextprotocol.io',
   'custom',
   '[{"action_key":"tools_list","auto_approve":true},{"action_key":"tools_call","auto_approve":true}]',
   'active');
