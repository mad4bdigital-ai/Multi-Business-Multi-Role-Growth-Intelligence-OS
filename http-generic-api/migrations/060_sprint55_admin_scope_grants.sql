-- Sprint 55: Admin scope-sharing controller.
--
-- admin_scope_grants lets a platform admin lend a tenant user time-bounded,
-- scope-bounded access to a normally admin-only DB tool. The dispatcher in
-- /gpt/tools/call consults this table when a tenant requests a tool that does
-- not exist in tenant_platform_endpoint_tools but does exist in
-- admin_platform_endpoint_tools. A matching active grant authorises the call;
-- every dispatch through a granted scope is written to audit_log with the
-- grant_id as resource_id.
--
-- Backend-only sprint. UI for grant management is deferred. The matching
-- tenant per-user token controller (Controller #2 in the admin guide
-- architecture roadmap) is also deferred until UI mockups land.
--
-- Important: this file contains no semicolons inside any string literal,
-- per the migrator parser constraint recorded in migration 055.

CREATE TABLE IF NOT EXISTS `admin_scope_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `grant_id` VARCHAR(36) NOT NULL UNIQUE,
  `tenant_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `source_tool_key` VARCHAR(128) NOT NULL,
  `allowed_actions` JSON NULL,
  `allowed_args` JSON NULL,
  `reason` TEXT NULL,
  `granted_by` VARCHAR(64) NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `revoked_by` VARCHAR(64) NULL,
  `last_used_at` DATETIME NULL,
  `use_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_scope_grants_tenant_user` (`tenant_id`, `user_id`),
  KEY `idx_scope_grants_tool` (`source_tool_key`),
  KEY `idx_scope_grants_active_lookup` (`tenant_id`, `user_id`, `source_tool_key`, `revoked_at`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('admin_scope_grant_create',
 'Create Admin Scope Grant',
 'Admin issues a time-bounded scope grant that lets a tenant user invoke a normally admin-only DB tool through /gpt/tools/call. Validates the source tool exists in admin_platform_endpoint_tools.',
 'POST', '/admin/scope-grants',
 '[]',
 '{"type":"object","required":["tenant_id","user_id","source_tool_key"],"properties":{"tenant_id":{"type":"string","format":"uuid"},"user_id":{"type":"string","format":"uuid"},"source_tool_key":{"type":"string"},"allowed_actions":{"type":"array","items":{"type":"string"},"description":"Optional whitelist of action enum values inside the called tool. Empty array or omitted means all actions."},"allowed_args":{"type":"object","additionalProperties":true,"description":"Optional pinned arg constraints. Keys with scalar values pin that exact value. Keys with array values whitelist any of those values."},"reason":{"type":"string"},"expires_at":{"type":"string","format":"date-time"}}}',
 NULL,
 'admin,scope_grant,state_changing',
 510,
 1),
('admin_scope_grant_list',
 'List Admin Scope Grants',
 'Admin lists scope grants. Filter by tenant_id, user_id, source_tool_key, or active_only.',
 'GET', '/admin/scope-grants',
 '[]',
 '{"type":"object","properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"source_tool_key":{"type":"string"},"active_only":{"type":"boolean","default":true},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}}}',
 NULL,
 'admin,scope_grant',
 511,
 1),
('admin_scope_grant_revoke',
 'Revoke Admin Scope Grant',
 'Admin revokes an active scope grant. Sets revoked_at and revoked_by. Does not delete the row so audit history stays intact.',
 'DELETE', '/admin/scope-grants/{grant_id}',
 '["grant_id"]',
 '{"type":"object","required":["grant_id"],"properties":{"grant_id":{"type":"string","format":"uuid"},"reason":{"type":"string"}}}',
 NULL,
 'admin,scope_grant,state_changing',
 512,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body   = VALUES(fixed_body),
  tags         = VALUES(tags),
  sort_order   = VALUES(sort_order),
  is_enabled   = VALUES(is_enabled);

INSERT INTO `tenant_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('me_scope_grants_list',
 'My Scope Grants',
 'Tenant user reads scope grants that have been issued to them. Returns only active, non-expired, non-revoked grants by default.',
 'GET', '/me/scope-grants',
 '[]',
 '{"type":"object","properties":{"active_only":{"type":"boolean","default":true}}}',
 NULL,
 'tenant,scope_grant,read_only',
 410,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body   = VALUES(fixed_body),
  tags         = VALUES(tags),
  sort_order   = VALUES(sort_order),
  is_enabled   = VALUES(is_enabled);
