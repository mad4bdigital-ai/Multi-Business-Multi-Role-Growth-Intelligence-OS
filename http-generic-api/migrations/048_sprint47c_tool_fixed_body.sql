-- Sprint 47c: fixed_body support for system-tool wrapper entries
-- Allows tool rows to pre-fill body fields (e.g. name) before forwarding to
-- the underlying endpoint, enabling direct tool aliases like
-- activation_provider_bootstrap_validate → POST /admin/system/tools/call.

ALTER TABLE `admin_platform_endpoint_tools`
  ADD COLUMN `fixed_body` JSON NULL
  AFTER `input_schema`;

ALTER TABLE `tenant_platform_endpoint_tools`
  ADD COLUMN `fixed_body` JSON NULL
  AFTER `input_schema`;

-- ─── Bootstrap / activation system-tool wrappers (admin) ──────────────────────
-- These route to POST /admin/system/tools/call with fixed_body injecting the
-- sub-tool name. The GPT passes additional `arguments` as needed.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES

('activation_provider_bootstrap_validate',
 'Validate Activation Bootstrap',
 'Validate Drive, GitHub, Sheets, and provider bootstrap. Confirms all activation evidence is reachable.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object"}}}',
 '{"name":"activation_provider_bootstrap_validate"}',
 'activation', 42),

('activation_drive_probe',
 'Probe Google Drive',
 'Check Google Drive connectivity and verify the configured upload folder is accessible.',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"activation_drive_probe"}',
 'activation', 43),

('activation_sheets_bootstrap_read',
 'Read Sheets Bootstrap',
 'Read the activation bootstrap row from Google Sheets (diagnostic only).',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"activation_sheets_bootstrap_read"}',
 'activation', 44),

('activation_github_validate',
 'Validate GitHub',
 'Validate GitHub token and verify repo access for the configured activation binding.',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"activation_github_validate"}',
 'activation', 45),

('activation_bootstrap_config_upsert',
 'Upsert Bootstrap Config',
 'Upsert the GitHub activation binding. Pass arguments with github_owner, github_repo, github_branch.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object","properties":{"github_owner":{"type":"string"},"github_repo":{"type":"string"},"github_branch":{"type":"string"}}}}}',
 '{"name":"activation_bootstrap_config_upsert"}',
 'activation', 46),

('tenant_gpt_oauth_client_upsert',
 'Upsert Tenant GPT OAuth Client',
 'Upsert the OAuth client configuration for the Tenant GPT.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object"}}}',
 '{"name":"tenant_gpt_oauth_client_upsert"}',
 'system', 178),

('credential_client_config_upsert',
 'Upsert Credential Client Config',
 'Upsert a credential client config record.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object"}}}',
 '{"name":"credential_client_config_upsert"}',
 'system', 179),

('credential_client_config_list',
 'List Credential Client Configs',
 'List all credential client config records.',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"credential_client_config_list"}',
 'system', 180),

('connector_registry_list_tool',
 'List Connector Registry (tool)',
 'List all connected systems via the system tool registry.',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"connector_registry_list"}',
 'system', 181),

('connector_registry_get_tool',
 'Get Connector Registry Entry (tool)',
 'Get one connected system. Pass arguments.system_id.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object","properties":{"system_id":{"type":"string"}},"required":["system_id"]}}}',
 '{"name":"connector_registry_get"}',
 'system', 182),

('google_auth_platform_config_upsert',
 'Upsert Google Auth Platform Config',
 'Upsert the Google Auth Platform configuration record.',
 'POST', '/admin/system/tools/call', NULL,
 '{"type":"object","properties":{"arguments":{"type":"object"}}}',
 '{"name":"google_auth_platform_config_upsert"}',
 'admin', 225),

('google_auth_platform_config_get',
 'Get Google Auth Platform Config',
 'Read the current Google Auth Platform configuration record.',
 'POST', '/admin/system/tools/call', NULL, NULL,
 '{"name":"google_auth_platform_config_get"}',
 'admin', 226);
