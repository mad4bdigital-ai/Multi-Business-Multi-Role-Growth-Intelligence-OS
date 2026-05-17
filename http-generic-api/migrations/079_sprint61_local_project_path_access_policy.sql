-- Sprint 61: Local Project Path Access Policy
--
-- Makes local path ownership explicit. Tenant/user access is allowed only for
-- separately registered tenant-owned/user-owned/device-owned paths, never for
-- the platform admin repo path.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

ALTER TABLE local_project_path_registry
  ADD COLUMN IF NOT EXISTS owner_scope ENUM('platform','tenant','user','device') NOT NULL DEFAULT 'platform' AFTER project_label,
  ADD COLUMN IF NOT EXISTS allowed_subject_scope ENUM('admin','tenant_admin','user_owner','none') NOT NULL DEFAULT 'admin' AFTER owner_scope,
  ADD COLUMN IF NOT EXISTS allowed_operations_json JSON NULL AFTER allowed_subject_scope;

-- Platform source repo stays admin-only.
UPDATE local_project_path_registry
SET owner_scope = 'platform',
    allowed_subject_scope = 'admin',
    allowed_operations_json = JSON_ARRAY('validate','repo_status','controlled_repair')
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND user_id IS NULL
  AND project_key = 'growth-intelligence-os';

-- Local connector runtime can be exposed to the owning user/device with bounded operations only.
UPDATE local_project_path_registry
SET owner_scope = 'device',
    allowed_subject_scope = 'user_owner',
    allowed_operations_json = JSON_ARRAY('health','validate','connector_status','connector_repair','bounded_dir_list','bounded_file_search')
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND user_id IS NULL
  AND project_key = 'local-connector';
