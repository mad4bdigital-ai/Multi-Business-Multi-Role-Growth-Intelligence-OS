-- Sprint 61: Local Project Path Registry
--
-- Stores the authoritative local project path for each user/device/project and
-- records move/repair events. This does not move files by itself.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS `local_project_path_registry` (
  `path_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  `user_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NOT NULL,
  `project_key` VARCHAR(128) NOT NULL DEFAULT 'growth-intelligence-os',
  `project_label` VARCHAR(191) NULL,
  `current_path` VARCHAR(1024) NOT NULL,
  `previous_path` VARCHAR(1024) NULL,
  `repo_remote` VARCHAR(512) NULL,
  `repo_branch` VARCHAR(191) NULL,
  `expected_markers_json` JSON NULL,
  `path_status` ENUM('active','pending_move','repair_required','archived') NOT NULL DEFAULT 'active',
  `validation_status` ENUM('unknown','valid','missing','partial','mismatch','inaccessible') NOT NULL DEFAULT 'unknown',
  `last_validated_at` DATETIME NULL,
  `last_repair_run_id` VARCHAR(36) NULL,
  `metadata_json` JSON NULL,
  `created_by` VARCHAR(191) NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_local_project_device_project` (`tenant_id`,`device_id`,`project_key`),
  KEY `idx_local_project_user_device` (`tenant_id`,`user_id`,`device_id`),
  KEY `idx_local_project_status` (`path_status`,`validation_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `local_project_path_events` (
  `event_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `path_id` VARCHAR(36) NOT NULL,
  `event_type` ENUM('registered','path_updated','move_planned','move_confirmed','validation','repair_dry_run','repair_apply','archived') NOT NULL,
  `old_path` VARCHAR(1024) NULL,
  `new_path` VARCHAR(1024) NULL,
  `status_before` VARCHAR(64) NULL,
  `status_after` VARCHAR(64) NULL,
  `actor` VARCHAR(191) NULL,
  `event_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_local_project_events_path` (`path_id`,`created_at`),
  CONSTRAINT `fk_local_project_events_path` FOREIGN KEY (`path_id`) REFERENCES `local_project_path_registry` (`path_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `local_project_path_repair_runs` (
  `repair_run_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `path_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  `user_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NOT NULL,
  `project_key` VARCHAR(128) NOT NULL,
  `source_path` VARCHAR(1024) NULL,
  `target_path` VARCHAR(1024) NOT NULL,
  `mode` ENUM('dry_run','apply') NOT NULL DEFAULT 'dry_run',
  `status` ENUM('planned','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'planned',
  `files_checked` INT NULL,
  `files_missing` INT NULL,
  `files_copied` INT NULL,
  `conflicts_found` INT NULL,
  `manifest_path` VARCHAR(1024) NULL,
  `checksum_manifest_json` JSON NULL,
  `error_json` JSON NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_local_project_repair_path` (`path_id`,`created_at`),
  KEY `idx_local_project_repair_device` (`tenant_id`,`device_id`,`project_key`),
  CONSTRAINT `fk_local_project_repair_path` FOREIGN KEY (`path_id`) REFERENCES `local_project_path_registry` (`path_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(input_schema,''),'{}'))
          THEN COALESCE(NULLIF(input_schema,''),'{}')
        ELSE '{"type":"object","properties":{}}'
      END,
      '$.properties.alias.description',
      'For tool=shell/action=run, use an allowlisted alias. Built-in aliases include session_archive_relink_repair_dry_run, session_archive_relink_repair_apply, local_project_path_helper_dry_run, and local_project_path_helper_apply.',
      '$.properties.extra_args.description',
      'Additional arguments passed only to allowlisted shell aliases that permit them. Use local_project_path_helper_* for DB path registry actions and session_archive_relink_repair_* for session archive relink repair.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'admin_control';
