-- Sprint 61: Platform Backup & Copy Governance Registry
--
-- Adds governance tables for code/runtime/local copy locations, backup policies,
-- backup run records, and restore tests. This migration does not execute backups.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS `platform_copy_locations` (
  `location_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `location_key` VARCHAR(191) NOT NULL,
  `location_type` ENUM('repo_branch','hostinger_runtime','local_device_path','drive_folder','object_storage','database','other') NOT NULL,
  `owner_scope` ENUM('platform','tenant','user','device') NOT NULL DEFAULT 'platform',
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NULL,
  `provider` VARCHAR(64) NULL,
  `path_or_ref` VARCHAR(1024) NOT NULL,
  `branch_name` VARCHAR(191) NULL,
  `host_name` VARCHAR(191) NULL,
  `is_source_of_truth` TINYINT(1) NOT NULL DEFAULT 0,
  `allowed_operations_json` JSON NULL,
  `risk_level` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `status` ENUM('active','pending_validation','degraded','archived') NOT NULL DEFAULT 'pending_validation',
  `last_validated_at` DATETIME NULL,
  `validation_json` JSON NULL,
  `notes` TEXT NULL,
  `created_by` VARCHAR(191) NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_platform_copy_location_key` (`location_key`),
  KEY `idx_platform_copy_location_scope` (`owner_scope`,`tenant_id`,`user_id`,`device_id`),
  KEY `idx_platform_copy_location_type` (`location_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_backup_policies` (
  `policy_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `policy_key` VARCHAR(191) NOT NULL,
  `policy_label` VARCHAR(191) NULL,
  `scope` ENUM('platform','tenant','user','device') NOT NULL DEFAULT 'platform',
  `source_location_id` VARCHAR(36) NOT NULL,
  `destination_location_id` VARCHAR(36) NULL,
  `backup_kind` ENUM('code','database','env_manifest','artifacts','drive_archive','full_bundle','metadata_only','other') NOT NULL,
  `mode` ENUM('manual','scheduled','event_driven') NOT NULL DEFAULT 'manual',
  `frequency_cron` VARCHAR(191) NULL,
  `retention_days` INT NULL,
  `encryption_required` TINYINT(1) NOT NULL DEFAULT 1,
  `checksum_required` TINYINT(1) NOT NULL DEFAULT 1,
  `approval_required` TINYINT(1) NOT NULL DEFAULT 1,
  `restore_test_required` TINYINT(1) NOT NULL DEFAULT 1,
  `allowed_executor` ENUM('none','admin_tool','hostinger_ssh','local_connector','github_actions','manual') NOT NULL DEFAULT 'none',
  `forbidden_content_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
  `approved_by` VARCHAR(191) NULL,
  `approved_at` DATETIME NULL,
  `created_by` VARCHAR(191) NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_platform_backup_policy_key` (`policy_key`),
  KEY `idx_platform_backup_policy_scope` (`scope`,`status`),
  KEY `idx_platform_backup_policy_source` (`source_location_id`),
  KEY `idx_platform_backup_policy_destination` (`destination_location_id`),
  CONSTRAINT `fk_platform_backup_policy_source` FOREIGN KEY (`source_location_id`) REFERENCES `platform_copy_locations` (`location_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_platform_backup_policy_destination` FOREIGN KEY (`destination_location_id`) REFERENCES `platform_copy_locations` (`location_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_backup_runs` (
  `run_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `policy_id` VARCHAR(36) NOT NULL,
  `run_mode` ENUM('dry_run','apply') NOT NULL DEFAULT 'dry_run',
  `status` ENUM('planned','running','succeeded','failed','cancelled','verification_failed') NOT NULL DEFAULT 'planned',
  `approval_ref` VARCHAR(191) NULL,
  `source_snapshot_ref` VARCHAR(1024) NULL,
  `destination_ref` VARCHAR(1024) NULL,
  `checksum_sha256` VARCHAR(128) NULL,
  `size_bytes` BIGINT NULL,
  `manifest_json` JSON NULL,
  `error_json` JSON NULL,
  `initiated_by` VARCHAR(191) NULL,
  `verified_by` VARCHAR(191) NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_platform_backup_run_policy` (`policy_id`,`created_at`),
  KEY `idx_platform_backup_run_status` (`status`,`run_mode`),
  CONSTRAINT `fk_platform_backup_run_policy` FOREIGN KEY (`policy_id`) REFERENCES `platform_backup_policies` (`policy_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_restore_tests` (
  `test_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `backup_run_id` VARCHAR(36) NOT NULL,
  `restore_target` VARCHAR(1024) NOT NULL,
  `status` ENUM('planned','running','passed','failed','cancelled') NOT NULL DEFAULT 'planned',
  `validated_commit_sha` VARCHAR(64) NULL,
  `validated_tables_count` INT NULL,
  `validated_healthcheck_json` JSON NULL,
  `validated_checksum_sha256` VARCHAR(128) NULL,
  `notes` TEXT NULL,
  `error_json` JSON NULL,
  `tested_by` VARCHAR(191) NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_platform_restore_test_run` (`backup_run_id`,`created_at`),
  KEY `idx_platform_restore_test_status` (`status`),
  CONSTRAINT `fk_platform_restore_test_run` FOREIGN KEY (`backup_run_id`) REFERENCES `platform_backup_runs` (`run_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed known copy locations as draft/pending records only. These are governance
-- records, not backup executions.
INSERT INTO platform_copy_locations
  (location_id, location_key, location_type, owner_scope, tenant_id, user_id, device_id, provider,
   path_or_ref, branch_name, host_name, is_source_of_truth, allowed_operations_json, risk_level,
   status, notes, created_by, updated_by)
VALUES
  (UUID(), 'repo:main:growth-intelligence-os', 'repo_branch', 'platform', NULL, NULL, NULL, 'github',
   'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os', 'main', NULL, 1,
   JSON_ARRAY('source_code','migrations','docs','ci_history'), 'high', 'active',
   'Authoritative source for code, migrations, docs, and CI. Must not store DB dumps or plaintext secrets.',
   'migration_080', 'migration_080'),
  (UUID(), 'hostinger:auth.mad4b.com:runtime', 'hostinger_runtime', 'platform', NULL, NULL, NULL, 'hostinger',
   'auth.mad4b.com/nodejs', NULL, 'auth.mad4b.com', 0,
   JSON_ARRAY('runtime_health','logs','env_manifest','controlled_deploy_verification'), 'critical', 'pending_validation',
   'Runtime host. Not code source of truth. DB backups require separate approved policy.',
   'migration_080', 'migration_080'),
  (UUID(), 'local:Essam:growth-intelligence-os', 'local_device_path', 'platform', '00000000-0000-0000-0000-000000000000', NULL, 'Essam', 'local_connector',
   'D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS', 'main', 'Essam', 0,
   JSON_ARRAY('validate','repo_status','controlled_repair'), 'high', 'active',
   'Platform/admin local working copy. Not tenant-accessible and not a certified backup.',
   'migration_080', 'migration_080'),
  (UUID(), 'local:Essam:local-connector', 'local_device_path', 'device', '00000000-0000-0000-0000-000000000000', NULL, 'Essam', 'local_connector',
   'C:\\mad4b-connector', NULL, 'Essam', 0,
   JSON_ARRAY('health','validate','connector_status','connector_repair','bounded_dir_list','bounded_file_search'), 'medium', 'active',
   'Device connector runtime path. Bounded tenant/user operations only when ownership rules allow.',
   'migration_080', 'migration_080')
ON DUPLICATE KEY UPDATE
  location_type=VALUES(location_type), owner_scope=VALUES(owner_scope), tenant_id=VALUES(tenant_id),
  user_id=VALUES(user_id), device_id=VALUES(device_id), provider=VALUES(provider), path_or_ref=VALUES(path_or_ref),
  branch_name=VALUES(branch_name), host_name=VALUES(host_name), is_source_of_truth=VALUES(is_source_of_truth),
  allowed_operations_json=VALUES(allowed_operations_json), risk_level=VALUES(risk_level), status=VALUES(status),
  notes=VALUES(notes), updated_by=VALUES(updated_by);
