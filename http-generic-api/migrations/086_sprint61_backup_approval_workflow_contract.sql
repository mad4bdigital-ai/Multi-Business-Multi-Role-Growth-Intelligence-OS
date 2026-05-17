-- Sprint 61: Backup approval workflow contract
--
-- Adds approval workflow metadata columns. This migration does not approve any
-- policy, activate any policy, execute backups, dump DBs, copy files, or run restore tests.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

ALTER TABLE platform_backup_approvals
  ADD COLUMN IF NOT EXISTS `decision_token` VARCHAR(128) NULL AFTER `approval_json`,
  ADD COLUMN IF NOT EXISTS `decision_source` ENUM('admin_session','system_policy','external_ticket','manual_record') NULL AFTER `decision_token`,
  ADD COLUMN IF NOT EXISTS `policy_snapshot_json` JSON NULL AFTER `decision_source`;

ALTER TABLE platform_backup_policies
  ADD COLUMN IF NOT EXISTS `activation_gate_status` ENUM('not_evaluated','blocked','ready','active') NOT NULL DEFAULT 'not_evaluated' AFTER `preflight_required`,
  ADD COLUMN IF NOT EXISTS `activation_gate_json` JSON NULL AFTER `activation_gate_status`;

-- Preserve current state as explicitly blocked until a real approval decision is recorded.
UPDATE platform_backup_policies
SET activation_gate_status='blocked',
    activation_gate_json=JSON_OBJECT(
      'status', 'blocked',
      'reason', 'approval_workflow_contract_added_no_approval_granted',
      'requires_approval', approval_required = 1,
      'requires_destination', destination_location_id IS NOT NULL,
      'requires_artifact_contract', artifact_format <> 'none' AND checksum_algorithm <> 'none',
      'no_backup_executed', true
    )
WHERE policy_key IN ('policy:platform-db-primary:manual-draft','policy:platform-code-main:snapshot-draft')
  AND status='draft';
