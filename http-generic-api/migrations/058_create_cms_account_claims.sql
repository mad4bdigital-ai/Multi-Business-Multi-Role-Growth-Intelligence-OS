-- Migration: create CMS account claim workflow
-- Purpose:
--   Track a user-owned CMS credential verification/claim without exposing secrets.
--   This is additive and safe to run repeatedly.
--
-- Apply after the credential binding bridge migrations.

CREATE TABLE IF NOT EXISTS cms_account_claims (
  claim_id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  connection_id varchar(36) NULL,
  app_key varchar(64) NOT NULL DEFAULT 'wordpress_rest',
  site_url varchar(512) NOT NULL,
  wp_json_base varchar(512) NOT NULL,
  normalized_domain varchar(255) NOT NULL,
  claimed_username varchar(191) NULL,
  claimed_email varchar(191) NULL,
  cms_user_id varchar(128) NULL,
  cms_roles_json longtext NULL,
  matched_brand_key varchar(128) NULL,
  matched_target_key varchar(128) NULL,
  match_confidence enum('none','low','medium','high','verified') NOT NULL DEFAULT 'none',
  verification_status enum('pending','verified','failed','approved','rejected','revoked') NOT NULL DEFAULT 'pending',
  verification_error varchar(512) NULL,
  requested_scope enum('personal','workspace','tenant_brand') NOT NULL DEFAULT 'personal',
  approval_required tinyint(1) NOT NULL DEFAULT 1,
  approved_by varchar(64) NULL,
  approved_at datetime NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  KEY idx_cms_claims_user (user_id),
  KEY idx_cms_claims_tenant (tenant_id),
  KEY idx_cms_claims_domain (normalized_domain),
  KEY idx_cms_claims_status (verification_status),
  KEY idx_cms_claims_connection (connection_id)
);

-- Optional but recommended if missing from earlier credential bridge patches.
-- Keep this guarded because deployments may already have the column.
SET @has_cb_connection_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'credential_bindings'
    AND column_name = 'connection_id'
);

SET @ddl_cb_connection_id := IF(
  @has_cb_connection_id = 0,
  'ALTER TABLE credential_bindings ADD COLUMN connection_id varchar(36) NULL AFTER installation_id',
  'SELECT 1'
);

PREPARE stmt FROM @ddl_cb_connection_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional status metadata for user app connections. Guarded for idempotency.
SET @has_uac_last_validated := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'user_app_connections'
    AND column_name = 'last_validated_at'
);

SET @ddl_uac_last_validated := IF(
  @has_uac_last_validated = 0,
  'ALTER TABLE user_app_connections ADD COLUMN last_validated_at datetime NULL',
  'SELECT 1'
);

PREPARE stmt FROM @ddl_uac_last_validated;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_uac_validation_status := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'user_app_connections'
    AND column_name = 'validation_status'
);

SET @ddl_uac_validation_status := IF(
  @has_uac_validation_status = 0,
  'ALTER TABLE user_app_connections ADD COLUMN validation_status varchar(64) NULL',
  'SELECT 1'
);

PREPARE stmt FROM @ddl_uac_validation_status;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
