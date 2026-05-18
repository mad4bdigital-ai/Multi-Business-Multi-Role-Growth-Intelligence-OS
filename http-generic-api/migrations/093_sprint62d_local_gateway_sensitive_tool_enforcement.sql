-- Sprint 62d: local.mad4b.com sensitive tool production enforcement
-- Adds approval, entitlement, service-mode, and consent policy fields.

ALTER TABLE `local_gateway_tools`
  ADD COLUMN IF NOT EXISTS `required_entitlement_key` VARCHAR(128) NULL AFTER `service_modes_json`,
  ADD COLUMN IF NOT EXISTS `default_service_mode` ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve' AFTER `required_entitlement_key`,
  ADD COLUMN IF NOT EXISTS `consent_required` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_consequential`,
  ADD COLUMN IF NOT EXISTS `risk_label` VARCHAR(128) NULL AFTER `consent_required`,
  ADD COLUMN IF NOT EXISTS `consent_text` TEXT NULL AFTER `risk_label`,
  ADD COLUMN IF NOT EXISTS `approval_hold_type` ENUM('review','supervisor_approval','managed_handoff','legal_hold') NOT NULL DEFAULT 'review' AFTER `consent_text`,
  ADD COLUMN IF NOT EXISTS `approval_required_role` VARCHAR(64) NULL AFTER `approval_hold_type`,
  ADD COLUMN IF NOT EXISTS `approval_ttl_minutes` INT UNSIGNED NOT NULL DEFAULT 1440 AFTER `approval_required_role`;

ALTER TABLE `local_gateway_tool_call_log`
  MODIFY COLUMN `status` ENUM('started','ok','failed','blocked','denied','timeout','approval_pending') NOT NULL DEFAULT 'started',
  ADD COLUMN IF NOT EXISTS `approval_hold_id` VARCHAR(36) NULL AFTER `route_id`,
  ADD COLUMN IF NOT EXISTS `entitlement_key` VARCHAR(128) NULL AFTER `service_mode`,
  ADD COLUMN IF NOT EXISTS `consent_status` ENUM('not_required','accepted','missing') NOT NULL DEFAULT 'not_required' AFTER `redaction_status`,
  ADD KEY IF NOT EXISTS `idx_local_gateway_call_approval` (`approval_hold_id`),
  ADD KEY IF NOT EXISTS `idx_local_gateway_call_entitlement` (`tenant_id`, `entitlement_key`, `started_at`);

UPDATE `local_gateway_tools`
   SET default_service_mode = 'self_serve',
       consent_required = 0,
       risk_label = 'Low risk diagnostic',
       consent_text = 'This action checks whether your local connector is reachable and does not modify local files or applications.',
       approval_hold_type = 'review',
       approval_required_role = NULL,
       approval_ttl_minutes = 1440,
       required_entitlement_key = NULL
 WHERE tool_key = 'local.connector.health';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'assisted',
       required_entitlement_key = 'local_gateway.sensitive_tools',
       consent_required = 1,
       risk_label = 'Sensitive local filesystem access',
       consent_text = 'This action can read or modify allowlisted files on your local device. Review the path and operation before approving.',
       approval_hold_type = 'review',
       approval_required_role = 'reviewer',
       approval_ttl_minutes = 480
 WHERE tool_key = 'local.connector.files';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'assisted',
       required_entitlement_key = 'local_gateway.sensitive_tools',
       consent_required = 1,
       risk_label = 'Sensitive local shell execution',
       consent_text = 'This action runs an allowlisted shell alias on your local device. It may affect local files or services depending on the alias.',
       approval_hold_type = 'supervisor_approval',
       approval_required_role = 'supervisor',
       approval_ttl_minutes = 240
 WHERE tool_key = 'local.connector.shell';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'self_serve',
       required_entitlement_key = NULL,
       consent_required = 1,
       risk_label = 'Interactive local application control',
       consent_text = 'This action may open or close an allowlisted desktop application on your device.',
       approval_hold_type = 'review',
       approval_required_role = 'reviewer',
       approval_ttl_minutes = 480
 WHERE tool_key = 'local.connector.apps';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'self_serve',
       required_entitlement_key = NULL,
       consent_required = 1,
       risk_label = 'Interactive browser control',
       consent_text = 'This action may open a URL or capture a browser screenshot on your local device.',
       approval_hold_type = 'review',
       approval_required_role = 'reviewer',
       approval_ttl_minutes = 480
 WHERE tool_key = 'local.connector.browser';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'assisted',
       required_entitlement_key = 'local_gateway.automation_tools',
       consent_required = 1,
       risk_label = 'Local automation workflow control',
       consent_text = 'This action can inspect or operate local n8n workflows. Workflow execution or activation may change connected automations.',
       approval_hold_type = 'supervisor_approval',
       approval_required_role = 'supervisor',
       approval_ttl_minutes = 240
 WHERE tool_key = 'local.connector.n8n';

UPDATE `local_gateway_tools`
   SET default_service_mode = 'managed',
       required_entitlement_key = 'local_gateway.admin_recovery',
       consent_required = 1,
       risk_label = 'Admin recovery operation',
       consent_text = 'This action is restricted to admin recovery and may change local or platform infrastructure state.',
       approval_hold_type = 'supervisor_approval',
       approval_required_role = 'platform_admin',
       approval_ttl_minutes = 120
 WHERE tool_key LIKE 'local.admin.%' OR tool_key = 'local.connector.dependencies';
