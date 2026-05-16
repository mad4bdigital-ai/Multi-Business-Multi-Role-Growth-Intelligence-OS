-- Sprint 53b: Non-env secret storage
-- Moves credential bindings away from env-var dependency. Secret values may live
-- in tenant_secrets/platform_secrets as AES-256-GCM ciphertext, or later in GCP
-- Secret Manager / external vault references. Env remains legacy fallback only.

ALTER TABLE `tenant_secrets`
  MODIFY COLUMN `storage_backend` ENUM('gcp_secret_manager','mounted_file','external_vault','env_ref','manual','db_encrypted') NOT NULL DEFAULT 'manual';

ALTER TABLE `platform_secrets`
  MODIFY COLUMN `storage_backend` ENUM('gcp_secret_manager','mounted_file','external_vault','env_ref','manual','db_encrypted') NOT NULL DEFAULT 'manual';

INSERT INTO `tenant_secrets`
  (`tenant_id`, `secret_key`, `secret_type`, `storage_backend`, `secret_ref`, `value_sha256`, `value_ciphertext`, `metadata_json`, `status`, `created_by`)
SELECT '4bc39fca-270e-4daa-b373-db75e1f36ccd', 'ALLROYALEGYPT_WP_APP_PASSWORD', 'basic_auth_app_password',
       'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending','required_for','allroyalegypt_wp'), 'disabled', 'migration_058'
WHERE NOT EXISTS (
  SELECT 1 FROM `tenant_secrets`
  WHERE tenant_id = '4bc39fca-270e-4daa-b373-db75e1f36ccd'
    AND secret_key = 'ALLROYALEGYPT_WP_APP_PASSWORD'
);

INSERT INTO `platform_secrets`
  (`secret_key`, `secret_type`, `storage_backend`, `secret_ref`, `value_sha256`, `value_ciphertext`, `metadata_json`, `status`, `created_by`)
SELECT 'MAKE_MCP_TOKEN', 'mcp_token', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending','required_for','makecom_mcp_client'), 'disabled', 'migration_058'
WHERE NOT EXISTS (
  SELECT 1 FROM `platform_secrets`
  WHERE secret_key = 'MAKE_MCP_TOKEN'
);

UPDATE `secret_references`
SET store_type = 'db_encrypted',
    env_var_name = NULL,
    vault_path = NULL,
    validation_status = 'pending_secret_value',
    status = 'active'
WHERE secret_key = 'ALLROYALEGYPT_WP_APP_PASSWORD';

UPDATE `secret_references`
SET store_type = 'db_encrypted',
    env_var_name = NULL,
    vault_path = NULL,
    validation_status = 'pending_secret_value',
    status = 'active'
WHERE secret_key = 'MAKE_MCP_TOKEN';

UPDATE `credential_bindings`
SET credential_ref = 'tenant_secret:4bc39fca-270e-4daa-b373-db75e1f36ccd:ALLROYALEGYPT_WP_APP_PASSWORD',
    created_by = COALESCE(created_by, 'migration_058')
WHERE target_key = 'allroyalegypt_wp'
  AND credential_role = 'wordpress_app_password'
  AND credential_ref = 'ref:secret:ALLROYALEGYPT_WP_APP_PASSWORD';

UPDATE `credential_bindings`
SET credential_ref = 'platform_secret:MAKE_MCP_TOKEN',
    created_by = COALESCE(created_by, 'migration_058')
WHERE action_key = 'makecom_mcp_client'
  AND credential_role = 'mcp_bearer_token'
  AND credential_ref = 'ref:secret:MAKE_MCP_TOKEN';
