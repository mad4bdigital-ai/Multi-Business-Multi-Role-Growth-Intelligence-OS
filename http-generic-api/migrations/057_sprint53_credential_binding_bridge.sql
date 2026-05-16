-- Sprint 53: Credential Binding Bridge
-- Bridges platform/tenant secret references, user app connections, actions,
-- targets, installations, and connected systems without duplicating user-owned
-- app credentials. Secret values remain in env/vault/encrypted connection blobs;
-- SQL stores ownership, pointers, binding metadata, and validation status only.

ALTER TABLE `secret_references`
  ADD COLUMN IF NOT EXISTS `owner_type` ENUM('platform','tenant','user','member','installation','device','service_account') NOT NULL DEFAULT 'tenant' AFTER `tenant_id`,
  ADD COLUMN IF NOT EXISTS `owner_id` VARCHAR(64) NULL AFTER `owner_type`,
  ADD COLUMN IF NOT EXISTS `system_id` VARCHAR(36) NULL AFTER `owner_id`,
  ADD COLUMN IF NOT EXISTS `installation_id` VARCHAR(36) NULL AFTER `system_id`,
  ADD COLUMN IF NOT EXISTS `action_key` VARCHAR(128) NULL AFTER `installation_id`,
  ADD COLUMN IF NOT EXISTS `provider_family` VARCHAR(64) NULL AFTER `action_key`,
  ADD COLUMN IF NOT EXISTS `connector_family` VARCHAR(64) NULL AFTER `provider_family`,
  ADD COLUMN IF NOT EXISTS `credential_type` VARCHAR(64) NULL AFTER `connector_family`,
  ADD COLUMN IF NOT EXISTS `scope_json` TEXT NULL AFTER `credential_type`,
  ADD COLUMN IF NOT EXISTS `consent_status` ENUM('not_required','pending','granted','revoked','expired') NOT NULL DEFAULT 'not_required' AFTER `scope_json`,
  ADD COLUMN IF NOT EXISTS `rotation_status` VARCHAR(64) NULL AFTER `consent_status`,
  ADD COLUMN IF NOT EXISTS `last_validated_at` DATETIME NULL AFTER `rotation_status`,
  ADD COLUMN IF NOT EXISTS `validation_status` VARCHAR(64) NULL AFTER `last_validated_at`,
  ADD COLUMN IF NOT EXISTS `status` ENUM('active','disabled','revoked','expired','deleted') NOT NULL DEFAULT 'active' AFTER `validation_status`;

CREATE TABLE IF NOT EXISTS `credential_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `binding_id` VARCHAR(36) NOT NULL UNIQUE,
  `tenant_id` VARCHAR(36) NOT NULL,
  `owner_type` ENUM('platform','tenant','user','member','installation','connection','service_account') NOT NULL,
  `owner_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(36) NULL,
  `system_id` VARCHAR(36) NULL,
  `installation_id` VARCHAR(36) NULL,
  `connection_id` VARCHAR(36) NULL,
  `action_key` VARCHAR(128) NULL,
  `target_key` VARCHAR(128) NULL,
  `credential_role` VARCHAR(64) NOT NULL,
  `credential_ref` VARCHAR(255) NULL,
  `provider_family` VARCHAR(64) NULL,
  `connector_family` VARCHAR(64) NULL,
  `resolution_priority` INT NOT NULL DEFAULT 100,
  `status` ENUM('active','disabled','revoked','expired') NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_credential_bindings_tenant` (`tenant_id`),
  KEY `idx_credential_bindings_action` (`action_key`),
  KEY `idx_credential_bindings_target` (`target_key`),
  KEY `idx_credential_bindings_connection` (`connection_id`),
  KEY `idx_credential_bindings_role` (`credential_role`),
  KEY `idx_credential_bindings_status` (`status`),
  UNIQUE KEY `uq_credential_binding_runtime_scope` (
    `tenant_id`, `owner_type`, `owner_id`, `user_id`, `system_id`,
    `installation_id`, `connection_id`, `action_key`, `target_key`, `credential_role`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `workspace_app_links`
  ADD COLUMN IF NOT EXISTS `permission_mode` ENUM('strict','permissive') NOT NULL DEFAULT 'strict' AFTER `status`;

ALTER TABLE `user_app_connections`
  ADD COLUMN IF NOT EXISTS `credential_ref` VARCHAR(255) NULL AFTER `encrypted_credentials`,
  ADD COLUMN IF NOT EXISTS `validation_status` VARCHAR(64) NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `last_validated_at` DATETIME NULL AFTER `validation_status`;

INSERT INTO `secret_references`
  (`ref_id`, `tenant_id`, `owner_type`, `owner_id`, `secret_key`, `store_type`, `env_var_name`, `description`, `provider_family`, `connector_family`, `credential_type`, `consent_status`, `status`, `created_at`)
SELECT UUID(), '4bc39fca-270e-4daa-b373-db75e1f36ccd', 'tenant', '4bc39fca-270e-4daa-b373-db75e1f36ccd',
       'ALLROYALEGYPT_WP_APP_PASSWORD', 'env', 'ALLROYALEGYPT_WP_APP_PASSWORD',
       'AllRoyalEgypt WordPress application password for basic_auth_app_password runtime execution; value must be provisioned as service env secret, never stored inline.',
       'wordpress', 'wordpress_rest', 'basic_auth_app_password', 'not_required', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM `secret_references` WHERE `secret_key` = 'ALLROYALEGYPT_WP_APP_PASSWORD');

INSERT INTO `secret_references`
  (`ref_id`, `tenant_id`, `owner_type`, `owner_id`, `secret_key`, `store_type`, `env_var_name`, `description`, `provider_family`, `connector_family`, `credential_type`, `consent_status`, `status`, `created_at`)
SELECT UUID(), 'f2795a7f-8d06-4053-8bee-35ca9af8b460', 'platform', 'platform',
       'MAKE_MCP_TOKEN', 'env', 'MAKE_MCP_TOKEN',
       'Make.com MCP bearer token for action makecom_mcp_client; value must be provisioned as service env secret.',
       'make', 'makecom_mcp_connector', 'mcp_token', 'not_required', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM `secret_references` WHERE `secret_key` = 'MAKE_MCP_TOKEN');

UPDATE `secret_references`
SET owner_type = 'tenant',
    owner_id = tenant_id,
    provider_family = 'wordpress',
    connector_family = 'wordpress_rest',
    credential_type = 'basic_auth_app_password',
    consent_status = 'not_required',
    status = 'active'
WHERE secret_key = 'ALLROYALEGYPT_WP_APP_PASSWORD';

UPDATE `secret_references`
SET owner_type = 'platform',
    owner_id = 'platform',
    provider_family = 'make',
    connector_family = 'makecom_mcp_connector',
    credential_type = 'mcp_token',
    consent_status = 'not_required',
    status = 'active'
WHERE secret_key = 'MAKE_MCP_TOKEN';

INSERT INTO `credential_bindings`
  (`binding_id`, `tenant_id`, `owner_type`, `owner_id`, `action_key`, `target_key`, `credential_role`, `credential_ref`, `provider_family`, `connector_family`, `resolution_priority`, `status`, `created_by`)
SELECT UUID(), sr.tenant_id, 'tenant', sr.tenant_id, NULL, 'allroyalegypt_wp',
       'wordpress_app_password', 'ref:secret:ALLROYALEGYPT_WP_APP_PASSWORD', 'wordpress', 'wordpress_rest', 50, 'active', 'migration_057'
FROM `secret_references` sr
WHERE sr.secret_key = 'ALLROYALEGYPT_WP_APP_PASSWORD'
  AND NOT EXISTS (
    SELECT 1 FROM `credential_bindings` cb
    WHERE cb.target_key = 'allroyalegypt_wp'
      AND cb.credential_role = 'wordpress_app_password'
      AND cb.status = 'active'
  )
LIMIT 1;

INSERT INTO `credential_bindings`
  (`binding_id`, `tenant_id`, `owner_type`, `owner_id`, `action_key`, `credential_role`, `credential_ref`, `provider_family`, `connector_family`, `resolution_priority`, `status`, `created_by`)
SELECT UUID(), sr.tenant_id, 'platform', 'platform', 'makecom_mcp_client',
       'mcp_bearer_token', 'ref:secret:MAKE_MCP_TOKEN', 'make', 'makecom_mcp_connector', 80, 'active', 'migration_057'
FROM `secret_references` sr
WHERE sr.secret_key = 'MAKE_MCP_TOKEN'
  AND NOT EXISTS (
    SELECT 1 FROM `credential_bindings` cb
    WHERE cb.action_key = 'makecom_mcp_client'
      AND cb.credential_role = 'mcp_bearer_token'
      AND cb.status = 'active'
  )
LIMIT 1;
