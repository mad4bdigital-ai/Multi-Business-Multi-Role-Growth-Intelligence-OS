-- Sprint 61: Backup approval and restore-test gates
--
-- Adds approval tracking and creates planned restore-test rows for existing
-- dry-run governance records. This migration does not execute backups or restore tests.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS `platform_backup_approvals` (
  `approval_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `policy_id` VARCHAR(36) NOT NULL,
  `approval_type` ENUM('policy_activation','backup_apply','restore_test','destination_change') NOT NULL,
  `status` ENUM('requested','approved','rejected','revoked','expired') NOT NULL DEFAULT 'requested',
  `requested_by` VARCHAR(191) NULL,
  `approved_by` VARCHAR(191) NULL,
  `rejected_by` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `approval_json` JSON NULL,
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  KEY `idx_platform_backup_approval_policy` (`policy_id`,`status`,`approval_type`),
  CONSTRAINT `fk_platform_backup_approval_policy` FOREIGN KEY (`policy_id`) REFERENCES `platform_backup_policies` (`policy_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Planned restore targets are only plans. A restore test remains `planned` until
-- a backup artifact exists and is restored into a safe target.
INSERT INTO platform_restore_tests
  (`test_id`, `backup_run_id`, `restore_target`, `status`, `notes`, `tested_by`)
SELECT UUID(), r.run_id,
       CASE
         WHEN p.backup_kind='database' THEN 'pending://isolated-restore-db-target'
         WHEN p.backup_kind='code' THEN 'pending://clean-checkout-or-release-restore-target'
         ELSE 'pending://restore-target'
       END,
       'planned',
       CONCAT('Restore-test plan only for draft policy ', p.policy_key, '. No restore executed.'),
       'migration_083'
FROM platform_backup_runs r
JOIN platform_backup_policies p ON p.policy_id=r.policy_id
LEFT JOIN platform_restore_tests existing ON existing.backup_run_id=r.run_id
WHERE r.run_mode='dry_run'
  AND existing.test_id IS NULL;

-- Request approval records for current draft policies without approving them.
INSERT INTO platform_backup_approvals
  (`approval_id`, `policy_id`, `approval_type`, `status`, `requested_by`, `reason`, `approval_json`)
SELECT UUID(), p.policy_id, 'policy_activation', 'requested', 'migration_083',
       'Draft policy requires explicit admin approval before activation or apply-mode backup.',
       JSON_OBJECT(
         'phase', 'approval_requested_only',
         'policy_key', p.policy_key,
         'requires_destination_validation', p.destination_location_id IS NOT NULL,
         'requires_restore_test_target', p.restore_test_required = 1,
         'requires_checksum', p.checksum_required = 1,
         'requires_encryption', p.encryption_required = 1
       )
FROM platform_backup_policies p
LEFT JOIN platform_backup_approvals a
  ON a.policy_id=p.policy_id
 AND a.approval_type='policy_activation'
 AND a.status IN ('requested','approved')
WHERE p.status='draft'
  AND a.approval_id IS NULL;
