-- Sprint 60b: Expose owner-scoped n8n device tool to tenants.
--
-- Admin callers can pass user_id to operate any registered user/device.
-- Tenant/user callers can operate only their own device because connectorProxyRoutes
-- resolves user_id from the authenticated principal when no admin identity is present.

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('connector_n8n',
   'Device n8n Control',
   'Tenant/user-scoped local n8n control for the signed-in user’s own registered device: status, diagnose, start, open, stop, restart, workflow inspection, execution, and execution history.',
   'POST', '/connector/{device_id}/n8n',
   '["device_id"]',
   '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","diagnose","start","open","stop","restart","health","list_workflows","get_workflow","activate_workflow","deactivate_workflow","run_workflow","list_executions"]},"browser_alias":{"type":"string"},"url":{"type":"string"},"workflow_id":{"type":"string"},"input_data":{"type":"object","additionalProperties":true},"limit":{"type":"integer"},"timeout_ms":{"type":"integer"}}}',
   NULL,
   'device,n8n,state_changing,owner_scoped',
   1,
   269)
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
