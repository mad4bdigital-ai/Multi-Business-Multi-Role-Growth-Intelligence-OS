-- Sprint 45: Remove false admin.connector@mad4b.com user (migration 036 artifact).
-- Reset dead tunnel configs so re-provisioning stores private cfargotunnel.com URLs.

-- ── 1. Remove false connector admin user ──────────────────────────────────────

DELETE FROM `local_connector_shell_allowlists`
  WHERE config_id = '00000000-0000-4000-b000-000000000002';

DELETE FROM `local_connector_file_access_rules`
  WHERE config_id = '00000000-0000-4000-b000-000000000002';

DELETE FROM `local_connector_user_configs`
  WHERE config_id = '00000000-0000-4000-b000-000000000002';

DELETE FROM `memberships`
  WHERE user_id = '00000000-0000-4000-a000-000000000005';

DELETE FROM `users`
  WHERE user_id = '00000000-0000-4000-a000-000000000005';

-- ── 2. Reset dead tunnel URLs so /install re-provisions with private CF URLs ──
-- connector.mad4b.com was never a real tunnel — null it out to force re-provision.

UPDATE `local_connector_user_configs`
  SET tunnel_url = NULL,
      cf_tunnel_id = NULL,
      cf_tunnel_name = NULL,
      cf_token = NULL
  WHERE tunnel_url = 'https://connector.mad4b.com';
