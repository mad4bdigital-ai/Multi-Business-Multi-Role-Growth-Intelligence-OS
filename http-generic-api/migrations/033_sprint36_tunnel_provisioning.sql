-- Sprint 36: Per-user Cloudflare tunnel provisioning columns

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN `cf_tunnel_id`   VARCHAR(64)   NULL COMMENT 'Cloudflare tunnel UUID provisioned for this device',
  ADD COLUMN `cf_tunnel_name` VARCHAR(128)  NULL COMMENT 'Cloudflare tunnel name (e.g. mohammedlap-connector)',
  ADD COLUMN `cf_token`       TEXT          NULL COMMENT 'cloudflared connector token — returned once at install, stored for re-issuance';
