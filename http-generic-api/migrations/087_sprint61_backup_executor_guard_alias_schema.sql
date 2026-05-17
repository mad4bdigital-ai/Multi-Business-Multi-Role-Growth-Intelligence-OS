-- Sprint 61: Backup executor guard aliases schema note
--
-- Documents built-in admin_control shell aliases for backup executor guard.
-- The aliases evaluate gates and may record metadata only; they do not create
-- backup artifacts.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE
        WHEN JSON_VALID(COALESCE(NULLIF(input_schema,''),'{}'))
          THEN COALESCE(NULLIF(input_schema,''),'{}')
        ELSE '{"type":"object","properties":{}}'
      END,
      '$.properties.alias.description',
      'For tool=shell/action=run, use an allowlisted alias. Built-in aliases include session_archive_relink_repair_*, local_project_path_helper_*, backup_copy_governance_helper_*, and backup_executor_guard_*.',
      '$.properties.extra_args.description',
      'Additional arguments passed only to allowlisted shell aliases that permit them. backup_executor_guard_* evaluates execution gates and can record metadata, but does not implement backup artifact creation.'
    )
WHERE tool_key = 'admin_control';
