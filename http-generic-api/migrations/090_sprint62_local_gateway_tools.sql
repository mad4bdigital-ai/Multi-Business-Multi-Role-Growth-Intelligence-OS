-- Sprint 62: local.mad4b.com governed tool registry and call log
-- Purpose:
--   local.mad4b.com is the public Hostinger/Auth gateway for tenants and members.
--   connector.mad4b.com remains admin/break-glass tunnel access only.
--
-- These tables separate the public local gateway surface from admin_platform_endpoint_tools
-- and tenant_platform_endpoint_tools. Runtime dispatch may still reuse governed device
-- tools, but visibility, eligibility, and call audit are controlled here.

CREATE TABLE IF NOT EXISTS `local_gateway_tools` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tool_key` VARCHAR(128) NOT NULL,
  `dispatch_tool_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `public_host` VARCHAR(255) NOT NULL DEFAULT 'local.mad4b.com',
  `public_path` VARCHAR(255) NOT NULL DEFAULT '/local/tools/call',
  `dispatch_surface` ENUM('device_tools','gpt_tools','auth_route') NOT NULL DEFAULT 'device_tools',
  `target_path_template` VARCHAR(512) NULL,
  `capability_class` VARCHAR(64) NOT NULL DEFAULT 'local_device',
  `risk_class` ENUM('low','medium','high','admin_recovery') NOT NULL DEFAULT 'medium',
  `allowed_caller_types_json` LONGTEXT NULL,
  `service_modes_json` LONGTEXT NULL,
  `requires_device_id` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_tenant_context` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `is_consequential` TINYINT(1) NOT NULL DEFAULT 0,
  `input_schema` LONGTEXT NULL,
  `fixed_args_json` LONGTEXT NULL,
  `tags` VARCHAR(255) NULL,
  `status` ENUM('active','planned','disabled','archived') NOT NULL DEFAULT 'active',
  `sort_order` INT NOT NULL DEFAULT 100,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_local_gateway_tool_key` (`tool_key`),
  KEY `idx_local_gateway_dispatch` (`dispatch_tool_key`, `status`),
  KEY `idx_local_gateway_public_host` (`public_host`, `status`),
  KEY `idx_local_gateway_risk` (`risk_class`, `requires_admin`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `local_gateway_tool_call_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `call_id` VARCHAR(36) NOT NULL,
  `tool_key` VARCHAR(128) NOT NULL,
  `dispatch_tool_key` VARCHAR(128) NULL,
  `public_host` VARCHAR(255) NOT NULL DEFAULT 'local.mad4b.com',
  `public_path` VARCHAR(255) NULL,
  `user_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `device_id` VARCHAR(128) NULL,
  `config_id` VARCHAR(36) NULL,
  `route_id` INT UNSIGNED NULL,
  `auth_mode` VARCHAR(64) NULL,
  `caller_type` VARCHAR(32) NULL,
  `service_mode` VARCHAR(32) NULL,
  `request_args_hash` VARCHAR(64) NULL,
  `request_args_json` LONGTEXT NULL,
  `redaction_status` ENUM('redacted','not_required','failed') NOT NULL DEFAULT 'redacted',
  `status` ENUM('started','ok','failed','blocked','denied','timeout') NOT NULL DEFAULT 'started',
  `http_status` INT NULL,
  `error_code` VARCHAR(128) NULL,
  `error_message` TEXT NULL,
  `duration_ms` INT UNSIGNED NULL,
  `trace_id` VARCHAR(128) NULL,
  `metadata_json` LONGTEXT NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_local_gateway_call_id` (`call_id`),
  KEY `idx_local_gateway_call_tool` (`tool_key`, `started_at`),
  KEY `idx_local_gateway_call_user` (`tenant_id`, `user_id`, `started_at`),
  KEY `idx_local_gateway_call_device` (`device_id`, `started_at`),
  KEY `idx_local_gateway_call_status` (`status`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `local_gateway_tools`
  (`tool_key`, `dispatch_tool_key`, `display_name`, `description`, `target_path_template`, `capability_class`, `risk_class`, `allowed_caller_types_json`, `service_modes_json`, `requires_device_id`, `requires_tenant_context`, `requires_admin`, `requires_approval`, `is_consequential`, `input_schema`, `tags`, `status`, `sort_order`, `notes`)
VALUES
  ('local.connector.health', 'connector_health', 'Local Device Health', 'Check whether a tenant or member local connector is reachable through the governed local gateway.', '/connector/{device_id}/health', 'local_device_health', 'low', '["tenant","admin"]', '["self_serve","assisted","managed"]', 1, 1, 0, 0, 0, '{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"},"user_id":{"type":"string"}}}', 'local,device,health,tenant_safe', 'active', 10, 'Tenant-safe diagnostic. Does not expose secrets.'),
  ('local.connector.files', 'connector_files', 'Local Device Files', 'List, locate, read, or write allowlisted local files through the governed local gateway.', '/connector/{device_id}/files', 'local_device_filesystem', 'high', '["tenant","admin"]', '["assisted","managed"]', 1, 1, 0, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["list","list_drives","locate_repo","read","write"]},"path":{"type":"string"},"content":{"type":"string"},"max_entries":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,filesystem,approval', 'active', 20, 'Read/write is constrained by connector allowlist and should be policy-gated.'),
  ('local.connector.shell', 'connector_shell', 'Local Device Shell', 'Run allowlisted shell aliases only. Arbitrary shell is not allowed.', '/connector/{device_id}/shell', 'local_device_shell', 'high', '["tenant","admin"]', '["assisted","managed"]', 1, 1, 0, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","list","run"]},"alias":{"type":"string"},"extra_args":{"type":"array","items":{"type":"string"}},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,shell,approval,allowlist', 'active', 30, 'Allowed only for registry-approved aliases.'),
  ('local.connector.apps', 'connector_apps', 'Local Device Apps', 'List or launch allowlisted local desktop applications with capability and risk metadata.', '/connector/{device_id}/apps', 'local_device_app', 'medium', '["tenant","admin"]', '["self_serve","assisted","managed"]', 1, 1, 0, 0, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","list","launch","status_app","close"]},"app_alias":{"type":"string"},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,apps,interactive', 'active', 40, 'Interactive actions may require UI-level confirmation in managed products.'),
  ('local.connector.browser', 'connector_browser', 'Local Device Browser', 'Open allowlisted browsers or capture screenshots through the governed local gateway.', '/connector/{device_id}/browser', 'local_device_browser', 'medium', '["tenant","admin"]', '["self_serve","assisted","managed"]', 1, 1, 0, 0, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["list","open_url","screenshot"]},"browser_alias":{"type":"string"},"url":{"type":"string"},"scale":{"type":"number"},"user_id":{"type":"string"}}}', 'local,device,browser,interactive', 'active', 50, 'URLs remain restricted to http and https by the connector.'),
  ('local.connector.n8n', 'connector_n8n', 'Local n8n Control', 'Operate tenant local n8n lifecycle and workflow inspection through the governed local gateway.', '/connector/{device_id}/n8n', 'local_device_n8n', 'high', '["tenant","admin"]', '["assisted","managed"]', 1, 1, 0, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string"},"workflow_id":{"type":"string"},"input_data":{"type":"object"},"limit":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,n8n,approval', 'active', 60, 'Workflow activation and execution should use entitlement and approval policy.'),
  ('local.connector.dependencies', 'connector_dependencies', 'Local Dependency Recovery', 'Inspect or install allowlisted local recovery dependencies only.', '/connector/{device_id}/dependencies', 'local_device_dependency_recovery', 'high', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","list","install"]},"package_key":{"type":"string","enum":["gh","googlecloudsdk"]},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,dependencies,admin_recovery', 'planned', 90, 'Listed here for governance but not exposed as normal tenant self-serve.' )
ON DUPLICATE KEY UPDATE
  `dispatch_tool_key` = VALUES(`dispatch_tool_key`),
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `public_host` = VALUES(`public_host`),
  `public_path` = VALUES(`public_path`),
  `dispatch_surface` = VALUES(`dispatch_surface`),
  `target_path_template` = VALUES(`target_path_template`),
  `capability_class` = VALUES(`capability_class`),
  `risk_class` = VALUES(`risk_class`),
  `allowed_caller_types_json` = VALUES(`allowed_caller_types_json`),
  `service_modes_json` = VALUES(`service_modes_json`),
  `requires_device_id` = VALUES(`requires_device_id`),
  `requires_tenant_context` = VALUES(`requires_tenant_context`),
  `requires_admin` = VALUES(`requires_admin`),
  `requires_approval` = VALUES(`requires_approval`),
  `is_consequential` = VALUES(`is_consequential`),
  `input_schema` = VALUES(`input_schema`),
  `tags` = VALUES(`tags`),
  `status` = VALUES(`status`),
  `sort_order` = VALUES(`sort_order`),
  `notes` = VALUES(`notes`);
