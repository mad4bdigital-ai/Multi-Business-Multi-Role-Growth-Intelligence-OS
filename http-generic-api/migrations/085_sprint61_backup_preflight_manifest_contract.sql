-- Sprint 61: Backup preflight, manifest, checksum, and encryption contract
--
-- Adds explicit backup execution contract metadata and artifact manifest records.
-- This migration does not execute backups, dump databases, copy files, encrypt
-- artifacts, or run restore tests.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

ALTER TABLE platform_backup_policies
  ADD COLUMN IF NOT EXISTS `artifact_format` ENUM('none','zip','tar_gz','sql_dump','jsonl','directory_manifest','other') NOT NULL DEFAULT 'none' AFTER `backup_kind`,
  ADD COLUMN IF NOT EXISTS `encryption_scheme` ENUM('none','age','gpg','zip_aes256','openssl_aes256','platform_managed','other') NOT NULL DEFAULT 'none' AFTER `artifact_format`,
  ADD COLUMN IF NOT EXISTS `checksum_algorithm` ENUM('none','sha256','sha512') NOT NULL DEFAULT 'sha256' AFTER `encryption_scheme`,
  ADD COLUMN IF NOT EXISTS `manifest_schema_version` VARCHAR(32) NOT NULL DEFAULT 'backup-manifest/v1' AFTER `checksum_algorithm`,
  ADD COLUMN IF NOT EXISTS `preflight_required` TINYINT(1) NOT NULL DEFAULT 1 AFTER `manifest_schema_version`;

ALTER TABLE platform_backup_runs
  ADD COLUMN IF NOT EXISTS `artifact_format` VARCHAR(64) NULL AFTER `run_mode`,
  ADD COLUMN IF NOT EXISTS `encryption_scheme` VARCHAR(64) NULL AFTER `artifact_format`,
  ADD COLUMN IF NOT EXISTS `checksum_algorithm` VARCHAR(64) NULL AFTER `encryption_scheme`,
  ADD COLUMN IF NOT EXISTS `manifest_schema_version` VARCHAR(32) NULL AFTER `checksum_algorithm`,
  ADD COLUMN IF NOT EXISTS `preflight_status` ENUM('not_run','passed','blocked','failed') NOT NULL DEFAULT 'not_run' AFTER `manifest_schema_version`,
  ADD COLUMN IF NOT EXISTS `preflight_json` JSON NULL AFTER `preflight_status`;

CREATE TABLE IF NOT EXISTS `platform_backup_artifact_manifests` (
  `manifest_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `run_id` VARCHAR(36) NOT NULL,
  `manifest_schema_version` VARCHAR(32) NOT NULL DEFAULT 'backup-manifest/v1',
  `artifact_ref` VARCHAR(1024) NULL,
  `artifact_format` VARCHAR(64) NOT NULL,
  `encryption_scheme` VARCHAR(64) NOT NULL,
  `checksum_algorithm` VARCHAR(64) NOT NULL DEFAULT 'sha256',
  `checksum_value` VARCHAR(256) NULL,
  `size_bytes` BIGINT NULL,
  `file_count` INT NULL,
  `contains_forbidden_content` TINYINT(1) NOT NULL DEFAULT 0,
  `manifest_json` JSON NOT NULL,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_platform_backup_manifest_run` (`run_id`,`created_at`),
  CONSTRAINT `fk_platform_backup_manifest_run` FOREIGN KEY (`run_id`) REFERENCES `platform_backup_runs` (`run_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Draft policy contract defaults. DB remains blocked until approved and a real
-- executor/encryption implementation is selected.
UPDATE platform_backup_policies
SET artifact_format='sql_dump',
    encryption_scheme='platform_managed',
    checksum_algorithm='sha256',
    manifest_schema_version='backup-manifest/v1',
    preflight_required=1,
    policy_json=JSON_SET(
      COALESCE(policy_json, JSON_OBJECT()),
      '$.artifact_contract.artifact_format', 'sql_dump',
      '$.artifact_contract.encryption_scheme', 'platform_managed',
      '$.artifact_contract.checksum_algorithm', 'sha256',
      '$.artifact_contract.manifest_schema_version', 'backup-manifest/v1',
      '$.artifact_contract.preflight_required', true,
      '$.execution_blocked_until_preflight_passes', true
    )
WHERE policy_key='policy:platform-db-primary:manual-draft';

UPDATE platform_backup_policies
SET artifact_format='zip',
    encryption_scheme='zip_aes256',
    checksum_algorithm='sha256',
    manifest_schema_version='backup-manifest/v1',
    preflight_required=1,
    policy_json=JSON_SET(
      COALESCE(policy_json, JSON_OBJECT()),
      '$.artifact_contract.artifact_format', 'zip',
      '$.artifact_contract.encryption_scheme', 'zip_aes256',
      '$.artifact_contract.checksum_algorithm', 'sha256',
      '$.artifact_contract.manifest_schema_version', 'backup-manifest/v1',
      '$.artifact_contract.preflight_required', true,
      '$.execution_blocked_until_preflight_passes', true
    )
WHERE policy_key='policy:platform-code-main:snapshot-draft';
