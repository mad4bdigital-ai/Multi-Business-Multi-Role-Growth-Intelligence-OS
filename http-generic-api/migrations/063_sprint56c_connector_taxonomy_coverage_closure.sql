-- Sprint 56c: Connector taxonomy coverage closure.
--
-- Adds legacy connector aliases and an unclassified diagnostic bucket.
-- Updates the coverage view to count NULL connector_family rows without
-- mutating runtime action or endpoint records.

INSERT INTO `connector_family_registry`
  (`connector_family`, `provider_family`, `display_name`, `protocol_type`, `provider_domain_mode`, `connection_scope`, `runtime_layer`, `default_auth_mode`, `status`, `source`, `notes`)
VALUES
  ('github_actions_connector', 'github_com_connector', 'GitHub Actions legacy endpoint connector alias', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'bearer_token', 'active', 'migration_063', 'Legacy endpoint connector_family alias observed on GitHub Actions endpoints'),
  ('github', 'github_com_connector', 'GitHub legacy endpoint connector alias', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'github_app_or_bearer_token', 'active', 'migration_063', 'Legacy endpoint connector_family alias observed on one GitHub endpoint'),
  ('_unclassified', NULL, 'Unclassified connector family diagnostic bucket', 'unknown', 'unknown', 'mixed', 'unknown', NULL, 'pending', 'migration_063', 'Diagnostic bucket for rows where connector_family is NULL or empty')
ON DUPLICATE KEY UPDATE
  `provider_family` = VALUES(`provider_family`),
  `display_name` = VALUES(`display_name`),
  `protocol_type` = VALUES(`protocol_type`),
  `provider_domain_mode` = VALUES(`provider_domain_mode`),
  `connection_scope` = VALUES(`connection_scope`),
  `runtime_layer` = VALUES(`runtime_layer`),
  `default_auth_mode` = VALUES(`default_auth_mode`),
  `status` = VALUES(`status`),
  `source` = VALUES(`source`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_connector_family_coverage` AS
SELECT
  r.connector_family,
  r.provider_family,
  r.display_name,
  r.protocol_type,
  r.provider_domain_mode,
  r.connection_scope,
  r.runtime_layer,
  r.default_auth_mode,
  r.status AS registry_status,
  COALESCE(ac.action_count, 0) AS action_count,
  COALESCE(ac.active_action_count, 0) AS active_action_count,
  COALESCE(ep.endpoint_count, 0) AS endpoint_count,
  COALESCE(ep.active_endpoint_count, 0) AS active_endpoint_count,
  COALESCE(cs.system_count, 0) AS connected_system_count,
  COALESCE(cs.active_system_count, 0) AS active_connected_system_count
FROM `connector_family_registry` r
LEFT JOIN (
  SELECT COALESCE(NULLIF(connector_family, ''), '_unclassified') AS connector_family, COUNT(*) AS action_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_action_count
  FROM `actions`
  GROUP BY COALESCE(NULLIF(connector_family, ''), '_unclassified')
) ac
  ON CONVERT(ac.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT COALESCE(NULLIF(connector_family, ''), '_unclassified') AS connector_family, COUNT(*) AS endpoint_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_endpoint_count
  FROM `endpoints`
  GROUP BY COALESCE(NULLIF(connector_family, ''), '_unclassified')
) ep
  ON CONVERT(ep.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT COALESCE(NULLIF(connector_family, ''), '_unclassified') AS connector_family, COUNT(*) AS system_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_system_count
  FROM `connected_systems`
  GROUP BY COALESCE(NULLIF(connector_family, ''), '_unclassified')
) cs
  ON CONVERT(cs.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci;
