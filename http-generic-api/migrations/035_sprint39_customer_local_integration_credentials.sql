-- Sprint 39: Customer-owned local integration credential catalog
-- Enables non-owner API clients to create local connector routing using DB-stored
-- Cloudflare and Hostinger credentials instead of platform root env secrets.

INSERT IGNORE INTO `app_integrations`
  (`app_key`, `display_name`, `description`, `auth_type`,
   `oauth_authorize_url`, `oauth_token_url`, `oauth_revoke_url`, `oauth_scopes_default`,
   `icon_url`, `docs_url`, `category`, `default_action_grants`, `status`)
VALUES
  ('cloudflare', 'Cloudflare',
   'Provision customer-owned Cloudflare tunnels for local connector routing.',
   'api_key',
   NULL, NULL, NULL, NULL,
   NULL,
   'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
   'infrastructure',
   '[{"action_key":"local_connector.install","auto_approve":true},{"action_key":"local_connector.manage","auto_approve":true}]',
   'active'),

  ('hostinger', 'Hostinger DNS',
   'Manage customer-owned Hostinger DNS records for local connector routing.',
   'api_key',
   NULL, NULL, NULL, NULL,
   NULL,
   'https://developers.hostinger.com/',
   'infrastructure',
   '[{"action_key":"dns.upsert","auto_approve":true},{"action_key":"local_connector.install","auto_approve":true}]',
   'active');
