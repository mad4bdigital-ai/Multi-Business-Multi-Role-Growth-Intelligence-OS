-- Sprint 56d: Normalize legacy connector_family rows.
--
-- This migration closes diagnostic-only connector-family gaps discovered after
-- adding connector_family_registry and v_connector_family_coverage.
--
-- It keeps legacy alias rows in connector_family_registry for historical
-- reporting, but normalizes active runtime rows to their parent action family.

UPDATE `actions`
   SET `connector_family` = 'http_generic_api_connector',
       `runtime_capability_class` = COALESCE(`runtime_capability_class`, 'external_action_only'),
       `runtime_callable` = COALESCE(`runtime_callable`, 'TRUE'),
       `primary_executor` = COALESCE(`primary_executor`, 'http_client_backend'),
       `api_key_mode` = COALESCE(`api_key_mode`, 'delegated_per_target'),
       `action_class` = COALESCE(`action_class`, 'tool'),
       `action_scope` = COALESCE(`action_scope`, 'connector_family'),
       `endpoint_group` = COALESCE(`endpoint_group`, 'admin_smoke'),
       `admin_only` = COALESCE(`admin_only`, 'TRUE'),
       `client_allowed` = COALESCE(`client_allowed`, 'FALSE'),
       `team_allowed` = COALESCE(`team_allowed`, 'TRUE'),
       `notes` = CONCAT(COALESCE(`notes`, ''), CASE WHEN `notes` IS NULL OR `notes` = '' THEN '' ELSE '\n' END, 'migration_064 normalized admin smoke-test connector taxonomy'),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `action_key` = 'admin_smoke_test_api'
   AND `status` = 'active';

UPDATE `endpoints` e
JOIN `actions` a
  ON a.action_key = e.parent_action_key
   SET e.connector_family = a.connector_family,
       e.updated_at = CURRENT_TIMESTAMP,
       e.notes = CONCAT(COALESCE(e.notes, ''), CASE WHEN e.notes IS NULL OR e.notes = '' THEN '' ELSE '\n' END, 'migration_064 normalized connector_family from parent action')
 WHERE e.status = 'active'
   AND e.parent_action_key IN ('admin_smoke_test_api', 'gcloud_api', 'http_generic_api_github_apply')
   AND (e.connector_family IS NULL OR e.connector_family = '');

UPDATE `endpoints`
   SET `connector_family` = 'github_com_connector',
       `updated_at` = CURRENT_TIMESTAMP,
       `notes` = CONCAT(COALESCE(`notes`, ''), CASE WHEN `notes` IS NULL OR `notes` = '' THEN '' ELSE '\n' END, 'migration_064 normalized legacy GitHub connector alias')
 WHERE `status` = 'active'
   AND `connector_family` IN ('github', 'github_actions_connector')
   AND `parent_action_key` IN ('github_api_mcp', 'github_actions_status');
