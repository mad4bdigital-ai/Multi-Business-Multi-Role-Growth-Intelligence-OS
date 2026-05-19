-- Sprint 63: Tenant/admin onboarding recovery control-plane.
-- Adds tenantless-safe escalation storage and curated tenant/admin registry tools.

CREATE TABLE IF NOT EXISTS `onboarding_escalations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `escalation_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `email` VARCHAR(255) NULL,
  `title` VARCHAR(512) NOT NULL,
  `body` TEXT NULL,
  `category` ENUM('support','review_request','escalation','managed_task','billing','general') NOT NULL DEFAULT 'escalation',
  `priority` ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'urgent',
  `status` ENUM('open','in_review','resolved','closed') NOT NULL DEFAULT 'open',
  `source` VARCHAR(64) NOT NULL DEFAULT 'connect',
  `metadata_json` TEXT NULL,
  `ticket_id` VARCHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_onboarding_escalation_id` (`escalation_id`),
  KEY `idx_onboarding_escalations_user` (`user_id`),
  KEY `idx_onboarding_escalations_tenant` (`tenant_id`),
  KEY `idx_onboarding_escalations_status` (`status`),
  KEY `idx_onboarding_escalations_ticket` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('connect_onboarding_state', 'Connect Onboarding State', 'Return explicit onboarding state for signed-in users, including signed-in/no-workspace recovery actions.', 'GET', '/connect/onboarding-state', NULL,
   '{"type":"object","properties":{}}', NULL, 'connect,onboarding,read_only,tenant_optional', 1, 31),
  ('connect_workspace_create', 'Create Connect Workspace', 'Idempotently create a workspace for a signed-in user who has no active tenant membership.', 'POST', '/connect/workspace', NULL,
   '{"type":"object","properties":{"display_name":{"type":"string"},"tenant_display_name":{"type":"string"}}}', NULL, 'connect,onboarding,state_changing,tenant_optional', 1, 32),
  ('connect_escalate', 'Escalate Connect Onboarding', 'Create a support escalation for connect/onboarding failures even when the user has no tenant yet.', 'POST', '/connect/escalate', NULL,
   '{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"},"message":{"type":"string"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"metadata_json":{"type":"object"}}}', NULL, 'connect,onboarding,escalation,tenant_optional', 1, 33),
  ('me_get', 'My Profile', 'Return the signed-in user, active tenant, memberships, and onboarding state.', 'GET', '/me', NULL,
   '{"type":"object","properties":{}}', NULL, 'tenant,identity,read_only,tenant_optional', 1, 34),
  ('me_workspaces_list', 'My Workspaces', 'List active workspaces for the signed-in user. Returns workspace_required when none exist.', 'GET', '/me/workspaces', NULL,
   '{"type":"object","properties":{}}', NULL, 'tenant,workspace,read_only,tenant_optional', 1, 35),
  ('me_workspace_create', 'Create My Workspace', 'Create a workspace for the signed-in user when no active membership exists.', 'POST', '/me/workspaces', NULL,
   '{"type":"object","properties":{"display_name":{"type":"string"},"tenant_display_name":{"type":"string"}}}', NULL, 'tenant,workspace,state_changing,tenant_optional', 1, 36),
  ('me_capabilities', 'My Capabilities', 'Return tenant capabilities or workspace_required next actions for the signed-in user.', 'GET', '/me/capabilities', NULL,
   '{"type":"object","properties":{}}', NULL, 'tenant,capabilities,read_only,tenant_optional', 1, 37)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('admin_onboarding_tenantless_users', 'List Tenantless Users', 'List active users with no active tenant membership, including open onboarding escalation counts.', 'GET', '/admin/onboarding/tenantless-users', NULL,
   '{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":500}}}', NULL, 'admin,onboarding,read_only', 1, 540),
  ('admin_onboarding_escalations', 'List Onboarding Escalations', 'List onboarding escalation rows including tenantless records.', 'GET', '/admin/onboarding/escalations', NULL,
   '{"type":"object","properties":{"status":{"type":"string","enum":["open","in_review","resolved","closed"]},"limit":{"type":"integer","minimum":1,"maximum":500}}}', NULL, 'admin,onboarding,escalation,read_only', 1, 541),
  ('admin_onboarding_create_workspace', 'Create Workspace For User', 'Create a managed-client workspace and owner membership for a tenantless active user.', 'POST', '/admin/onboarding/{user_id}/create-workspace', '["user_id"]',
   '{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"},"display_name":{"type":"string"},"tenant_display_name":{"type":"string"}}}', NULL, 'admin,onboarding,state_changing', 1, 542),
  ('admin_onboarding_repair_membership', 'Repair User Membership', 'Attach a user to an existing tenant or create a workspace when tenant_id is omitted.', 'POST', '/admin/onboarding/{user_id}/repair-membership', '["user_id"]',
   '{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"role":{"type":"string","enum":["owner","admin","member","viewer"]},"display_name":{"type":"string"}}}', NULL, 'admin,onboarding,state_changing', 1, 543),
  ('admin_onboarding_escalate_user', 'Escalate User Onboarding', 'Create an admin-originated onboarding escalation for a user, optionally linked to an existing tenant.', 'POST', '/admin/onboarding/{user_id}/escalate', '["user_id"]',
   '{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"metadata_json":{"type":"object"}}}', NULL, 'admin,onboarding,escalation,state_changing', 1, 544),
  ('admin_onboarding_link_session_archive', 'Link Onboarding Session Archive', 'Move all-zero onboarding GPT sessions for a user into the repaired tenant after membership exists.', 'POST', '/admin/onboarding/{user_id}/link-session-archive', '["user_id"]',
   '{"type":"object","required":["user_id","tenant_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"}}}', NULL, 'admin,onboarding,sessions,state_changing', 1, 545)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
