-- Sprint 46: Seed Tenant GPT OAuth client config with a generated secret.
-- INSERT IGNORE is safe to re-run and will not overwrite if already configured.
-- After running, retrieve the secret with the query below and paste it into the Custom GPT OAuth panel:
--   SELECT JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.client_secret')) FROM platform_runtime_config WHERE config_key = 'tenant_gpt.oauth.client'

INSERT IGNORE INTO `platform_runtime_config` (`config_key`, `config_json`, `status`, `note`)
VALUES (
  'tenant_gpt.oauth.client',
  JSON_OBJECT(
    'client_id',    'mad4b-tenant-gpt',
    'client_secret', CONCAT('m4b_tgpt_', LOWER(HEX(RANDOM_BYTES(32)))),
    'callback_urls_to_allow', JSON_ARRAY(
      'https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback',
      'https://chat.openai.com/aip/{g-GPT-ID}/oauth/callback',
      'https://chatgpt.com/aip/{g-GPT-ID}/oauth/callback'
    ),
    'created_at', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%sZ')
  ),
  'active',
  'auto_seeded_sprint46'
);
