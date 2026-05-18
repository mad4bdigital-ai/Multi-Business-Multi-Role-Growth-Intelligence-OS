-- Sprint 62b: credential boundary policy for local.mad4b.com tools
-- local.mad4b.com must not reuse admin/provider credentials implicitly.
-- Each exposed gateway tool declares how credentials are resolved and whether
-- cross-principal credential reuse is forbidden.

ALTER TABLE `local_gateway_tools`
  ADD COLUMN IF NOT EXISTS `credential_policy` ENUM('no_secret','device_scoped','tenant_connection_scoped','platform_admin_recovery') NOT NULL DEFAULT 'device_scoped' AFTER `dispatch_surface`,
  ADD COLUMN IF NOT EXISTS `credential_reuse_policy` ENUM('forbid_cross_principal_reuse','allow_explicit_admin_recovery','not_applicable') NOT NULL DEFAULT 'forbid_cross_principal_reuse' AFTER `credential_policy`,
  ADD COLUMN IF NOT EXISTS `credential_notes` TEXT NULL AFTER `credential_reuse_policy`;

UPDATE `local_gateway_tools`
   SET credential_policy = 'no_secret',
       credential_reuse_policy = 'not_applicable',
       credential_notes = 'Health diagnostics do not require provider credentials.'
 WHERE tool_key = 'local.connector.health';

UPDATE `local_gateway_tools`
   SET credential_policy = 'device_scoped',
       credential_reuse_policy = 'forbid_cross_principal_reuse',
       credential_notes = 'Uses the user/device local connector auth boundary. Does not reuse platform admin provider credentials.'
 WHERE tool_key IN ('local.connector.files','local.connector.shell','local.connector.apps','local.connector.browser','local.connector.n8n');

UPDATE `local_gateway_tools`
   SET credential_policy = 'platform_admin_recovery',
       credential_reuse_policy = 'allow_explicit_admin_recovery',
       credential_notes = 'Admin recovery only. May use admin break-glass connector context but must not be exposed as tenant/member default.'
 WHERE tool_key = 'local.connector.dependencies';

INSERT INTO `local_gateway_tools`
  (`tool_key`, `dispatch_tool_key`, `display_name`, `description`, `dispatch_surface`, `credential_policy`, `credential_reuse_policy`, `credential_notes`, `target_path_template`, `capability_class`, `risk_class`, `allowed_caller_types_json`, `service_modes_json`, `requires_device_id`, `requires_tenant_context`, `requires_admin`, `requires_approval`, `is_consequential`, `input_schema`, `tags`, `status`, `sort_order`, `notes`)
VALUES
  ('local.admin.powershell', 'connector_ps', 'Admin Local PowerShell', 'Admin-only recovery PowerShell through local.mad4b.com. Use only when narrower governed tools cannot complete the task.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses admin break-glass local connector context. Never exposed to tenant/member normal flows.', '/connector/{device_id}/ps', 'local_admin_powershell', 'admin_recovery', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","script"],"properties":{"device_id":{"type":"string"},"script":{"type":"string","maxLength":10000},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,powershell,admin_recovery', 'active', 100, 'Admin-only workaround surface.'),
  ('local.admin.windows', 'connector_win', 'Admin Windows Control', 'Admin-only Windows diagnostics and controlled recovery operations through local.mad4b.com.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses admin break-glass local connector context. Does not grant tenant access to OS-level operations.', '/connector/{device_id}/win', 'local_admin_windows', 'admin_recovery', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string"},"path":{"type":"string"},"url":{"type":"string"},"pattern":{"type":"string"},"filter":{"type":"string"},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,windows,admin_recovery', 'active', 110, 'Admin-only workaround surface.'),
  ('local.admin.cloudflare', 'connector_cf', 'Admin Cloudflare Recovery', 'Admin-only Cloudflare DNS/tunnel recovery through a local connector when cloud control-plane paths are degraded.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses explicitly configured admin recovery context only. Tenant Cloudflare credentials must use tenant app connections instead.', '/connector/{device_id}/cf', 'local_admin_cloudflare', 'admin_recovery', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string"},"zone_id":{"type":"string"},"record_id":{"type":"string"},"tunnel_id":{"type":"string"},"type":{"type":"string"},"name":{"type":"string"},"content":{"type":"string"},"proxied":{"type":"boolean"},"files":{"type":"array","items":{"type":"string"}},"user_id":{"type":"string"}}}', 'local,device,cloudflare,admin_recovery', 'active', 120, 'Admin-only Cloudflare recovery.'),
  ('local.admin.github_cli', 'connector_github', 'Admin GitHub CLI', 'Admin-only local GitHub CLI execution when configured on the device. Prefer GitHub App routes for repo mutations.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses local device GitHub CLI auth, not shared tenant credentials. Prefer GitHub App for normal platform repo access.', '/connector/{device_id}/github', 'local_admin_github_cli', 'admin_recovery', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,github,admin_recovery', 'active', 130, 'Admin-only CLI recovery.'),
  ('local.admin.gcloud_cli', 'connector_gcloud', 'Admin gcloud CLI', 'Admin-only local gcloud execution when configured on the device. Use governed cloud routes when available.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses local device gcloud auth, not shared tenant credentials. Tenant cloud credentials must use tenant app connections.', '/connector/{device_id}/gcloud', 'local_admin_gcloud_cli', 'admin_recovery', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}', 'local,device,gcloud,admin_recovery', 'active', 140, 'Admin-only CLI recovery.'),
  ('local.admin.fetch_upload', 'connector_fetch_upload', 'Admin Device Fetch Upload', 'Admin-only device-side fetch to platform uploads for recovery assets and public schemas.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses local connector upload path. Does not grant tenant access to admin uploads without explicit policy.', '/connector/{device_id}/fetch-upload', 'local_admin_fetch_upload', 'high', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","url","upload_type"],"properties":{"device_id":{"type":"string"},"url":{"type":"string"},"upload_type":{"type":"string","enum":["schema","skill","knowledge","repo_link","asset"]},"filename":{"type":"string"},"user_id":{"type":"string"}}}', 'local,device,fetch_upload,admin_recovery', 'active', 150, 'Admin-only upload bridge.'),
  ('local.admin.shell_fetch_upload', 'connector_shell_fetch_upload', 'Admin Device Curl Fetch Upload', 'Admin-only curl-backed fetch upload for unusual redirects or self-signed cert cases.', 'device_tools', 'platform_admin_recovery', 'allow_explicit_admin_recovery', 'Uses local connector recovery path. Normal tenant uploads should use tenant upload flows.', '/connector/{device_id}/shell-fetch-upload', 'local_admin_shell_fetch_upload', 'high', '["admin"]', '["managed"]', 1, 1, 1, 1, 1, '{"type":"object","required":["device_id","url","upload_type"],"properties":{"device_id":{"type":"string"},"url":{"type":"string"},"upload_type":{"type":"string","enum":["schema","skill","knowledge","repo_link","asset"]},"filename":{"type":"string"},"uploaded_by":{"type":"string"},"user_id":{"type":"string"}}}', 'local,device,shell_fetch_upload,admin_recovery', 'active', 160, 'Admin-only upload bridge.')
ON DUPLICATE KEY UPDATE
  dispatch_tool_key = VALUES(dispatch_tool_key),
  display_name = VALUES(display_name),
  description = VALUES(description),
  dispatch_surface = VALUES(dispatch_surface),
  credential_policy = VALUES(credential_policy),
  credential_reuse_policy = VALUES(credential_reuse_policy),
  credential_notes = VALUES(credential_notes),
  target_path_template = VALUES(target_path_template),
  capability_class = VALUES(capability_class),
  risk_class = VALUES(risk_class),
  allowed_caller_types_json = VALUES(allowed_caller_types_json),
  service_modes_json = VALUES(service_modes_json),
  requires_device_id = VALUES(requires_device_id),
  requires_tenant_context = VALUES(requires_tenant_context),
  requires_admin = VALUES(requires_admin),
  requires_approval = VALUES(requires_approval),
  is_consequential = VALUES(is_consequential),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  status = VALUES(status),
  sort_order = VALUES(sort_order),
  notes = VALUES(notes);
