-- Sprint 58c: Enable Cloudflare read-only endpoint execution flags.
--
-- Dynamic endpoint dispatch blocks inventory_role=runtime_inventory.
-- Normalize Cloudflare read-only endpoints to the executable endpoint_inventory
-- pattern and route transport through http_generic_api.

UPDATE `endpoints`
   SET `inventory_role` = 'endpoint_inventory',
       `inventory_source` = 'governed_endpoint_registry',
       `transport_action_key` = 'http_generic_api',
       `updated_at` = CURRENT_TIMESTAMP,
       `notes` = CONCAT(COALESCE(`notes`, ''), CASE WHEN `notes` IS NULL OR `notes` = '' THEN '' ELSE '\n' END, 'migration_070 enabled read-only endpoint execution flags')
 WHERE `parent_action_key` = 'cloudflare_api'
   AND `endpoint_key` IN ('cf_list_zones', 'cf_list_dns_records', 'cf_list_tunnels', 'cf_get_tunnel');
