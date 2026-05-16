-- Sprint 60: Expand governed n8n device tool lifecycle actions.
--
-- Adds status/diagnose/start/open/stop/restart to connector_n8n so the
-- platform can start and open a local n8n instance through a specialized
-- governed tool rather than generic PowerShell.

UPDATE `admin_platform_endpoint_tools`
   SET `description` = 'Admin/user-scoped local n8n control for status, diagnose, start, open, stop, restart, workflow inspection, activation, deactivation, execution, and execution history. Specialized n8n actions do not require generic PowerShell to be enabled on the connector.',
       `input_schema` = '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","diagnose","start","open","stop","restart","health","list_workflows","get_workflow","activate_workflow","deactivate_workflow","run_workflow","list_executions"]},"browser_alias":{"type":"string","description":"Browser alias for action=open, e.g. edge or chrome."},"url":{"type":"string","description":"Optional URL for action=open. Defaults to N8N_PUBLIC_URL."},"workflow_id":{"type":"string"},"input_data":{"type":"object","additionalProperties":true},"limit":{"type":"integer"},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}'
 WHERE `tool_key` = 'connector_n8n';
