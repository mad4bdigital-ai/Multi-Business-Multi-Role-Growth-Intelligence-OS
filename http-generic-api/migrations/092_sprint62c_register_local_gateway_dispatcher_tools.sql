-- Sprint 62c: register local.mad4b.com gateway dispatcher tools
-- These rows expose the local gateway registry/call surface through the governed
-- GPT/admin dispatcher so it can be tested and used without manually passing
-- backend credentials. The route itself still enforces local_gateway_tools policy.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('local_gateway_tools_list', 'List Local Gateway Tools', 'List tools exposed by local.mad4b.com from local_gateway_tools. Admin diagnostics may include planned tools.', 'GET', '/local/tools', NULL, '{"type":"object","properties":{"include_planned":{"type":"boolean"}}}', NULL, 'local_gateway,device,diagnostics,read_only', 1, 61),
  ('local_gateway_tools_call', 'Call Local Gateway Tool', 'Call a governed local.mad4b.com tool by tool_key/name. Uses local_gateway_tools policy and writes local_gateway_tool_call_log.', 'POST', '/local/tools/call', NULL, '{"type":"object","required":["name","tool_args"],"properties":{"name":{"type":"string"},"tool_args":{"type":"object"}}}', NULL, 'local_gateway,device,state_changing,audited', 1, 62)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('local_gateway_tools_list', 'List My Local Gateway Tools', 'List tenant/member-safe tools exposed through local.mad4b.com. Admin-only and planned tools are filtered by the route policy.', 'GET', '/local/tools', NULL, '{"type":"object","properties":{}}', NULL, 'local_gateway,device,tenant_safe,read_only', 1, 61),
  ('local_gateway_tools_call', 'Call My Local Gateway Tool', 'Call a tenant/member-safe local.mad4b.com tool. The route enforces device ownership, credential boundary, approval policy, and call logging.', 'POST', '/local/tools/call', NULL, '{"type":"object","required":["name","tool_args"],"properties":{"name":{"type":"string"},"tool_args":{"type":"object"}}}', NULL, 'local_gateway,device,tenant_safe,audited', 1, 62)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
