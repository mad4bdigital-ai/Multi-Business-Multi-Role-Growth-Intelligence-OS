-- Sprint 58d: Bind Cloudflare API action to runtime secret reference.
--
-- The Cloudflare token already exists as CLOUDFLARE_API_TOKEN in the runtime
-- environment. This migration stores only the secret reference name, never the
-- token value.

UPDATE `actions`
   SET `api_key_storage_mode` = 'secret_reference',
       `secret_store_ref` = 'ref:secret:CLOUDFLARE_API_TOKEN',
       `api_key_value` = NULL,
       `updated_at` = CURRENT_TIMESTAMP,
       `notes` = CONCAT(COALESCE(`notes`, ''), CASE WHEN `notes` IS NULL OR `notes` = '' THEN '' ELSE '\n' END, 'migration_071 bound Cloudflare API to CLOUDFLARE_API_TOKEN secret reference')
 WHERE `action_key` = 'cloudflare_api';
