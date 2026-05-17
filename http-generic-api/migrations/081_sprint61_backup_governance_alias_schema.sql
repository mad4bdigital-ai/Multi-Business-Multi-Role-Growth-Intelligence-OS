-- Sprint 61: Backup governance helper aliases schema note
--
-- Documents the built-in admin_control shell aliases for backup governance.
-- The aliases themselves are implemented in routes/adminCliRoutes.js:
--   - backup_copy_governance_helper_dry_run
--   - backup_copy_governance_helper_apply
--
-- These helpers record governance metadata only and do not execute backups.
-- Idempotent. No DELETE/TRUNCATE/DROP.

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(input_schema,''),'{}'))
          THEN COALESCE(NULLIF(input_schema,''),'{}')
        ELSE '{"type":"object","properties":{}}'
      END,
      '$.properties.alias.description',
      'For tool=shell/action=run, use an allowlisted alias. Built-in aliases include session_archive_relink_repair_*, local_project_path_helper_*, and backup_copy_governance_helper_*.',
      '$.properties.extra_args.description',
      'Additional arguments passed only to allowlisted shell aliases that permit them. backup_copy_governance_helper_* records governance metadata only and never copies files, dumps DBs, or uploads artifacts.'
    )
WHERE tool_key = 'admin_control';
