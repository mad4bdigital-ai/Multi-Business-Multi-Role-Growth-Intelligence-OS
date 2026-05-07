-- Sprint 21: Output Sink Router
-- Adds the missing downstream layer: routes agent output_json into typed sink tables
-- instead of leaving it stranded in workflow_runs.output_json.
-- All statements idempotent.

-- ─── Universal artifact store ─────────────────────────────────────────────────
-- Every agent execution writes one row here regardless of class or artifact type.

CREATE TABLE IF NOT EXISTS `output_artifacts` (
  `id`             INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `artifact_id`    VARCHAR(36)   NOT NULL UNIQUE,
  `run_id`         VARCHAR(36)   NOT NULL,
  `agent_id`       VARCHAR(36)   NULL,
  `tenant_id`      VARCHAR(36)   NOT NULL,
  `brand_key`      VARCHAR(128)  NULL,
  `workflow_key`   VARCHAR(128)  NULL,
  `artifact_type`  VARCHAR(64)   NOT NULL COMMENT 'From workflows.output_artifact_type',
  `primary_output` VARCHAR(255)  NULL     COMMENT 'Human label from workflows.primary_output',
  `content_text`   LONGTEXT      NULL     COMMENT 'Raw text / markdown output',
  `content_json`   JSON          NULL     COMMENT 'Structured JSON output',
  `sink_targets`   JSON          NULL     COMMENT 'Which sinks received this artifact',
  `status`         ENUM('pending','delivered','failed') NOT NULL DEFAULT 'pending',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_artifact_run`    (`run_id`),
  INDEX `idx_artifact_tenant` (`tenant_id`),
  INDEX `idx_artifact_agent`  (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Sink dispatch audit trail ────────────────────────────────────────────────
-- One row per sink write attempt — observability for the router itself.

CREATE TABLE IF NOT EXISTS `sink_dispatch_log` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `dispatch_id` VARCHAR(36)  NOT NULL UNIQUE,
  `run_id`      VARCHAR(36)  NOT NULL,
  `agent_id`    VARCHAR(36)  NULL,
  `tenant_id`   VARCHAR(36)  NULL,
  `sink_type`   VARCHAR(64)  NOT NULL COMMENT 'output_artifact|adaptation_record|reporting_view|chain_event|audit_log',
  `sink_ref_id` VARCHAR(36)  NULL COMMENT 'ID of the record created in the target sink',
  `status`      ENUM('ok','failed','skipped') NOT NULL DEFAULT 'ok',
  `error_msg`   VARCHAR(255) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sink_run`    (`run_id`),
  INDEX `idx_sink_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent chain events ───────────────────────────────────────────────────────
-- Event bus for chaining agents. When a workflow completes and has linked_workflows,
-- chain events are emitted here for the chain dispatcher to pick up and execute.

CREATE TABLE IF NOT EXISTS `agent_chain_events` (
  `id`                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `event_id`             VARCHAR(36)  NOT NULL UNIQUE,
  `source_run_id`        VARCHAR(36)  NOT NULL,
  `source_agent_id`      VARCHAR(36)  NULL,
  `target_workflow_key`  VARCHAR(128) NOT NULL,
  `target_agent_id`      VARCHAR(36)  NULL,
  `tenant_id`            VARCHAR(36)  NOT NULL,
  `trigger_condition`    ENUM('on_pass','on_fail','always') NOT NULL DEFAULT 'always',
  `payload_json`         JSON         NULL,
  `status`               ENUM('pending','dispatched','failed','skipped') NOT NULL DEFAULT 'pending',
  `dispatched_at`        DATETIME     NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_chain_tenant` (`tenant_id`),
  INDEX `idx_chain_status` (`status`),
  INDEX `idx_chain_source` (`source_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Extend reporting_views with data storage ─────────────────────────────────
-- reporting_views was a view-definition table with no actual data columns.
-- Add columns to store agent-generated report snapshots.

ALTER TABLE `reporting_views`
  ADD COLUMN IF NOT EXISTS `source_run_id` VARCHAR(36)  NULL AFTER `view_key`,
  ADD COLUMN IF NOT EXISTS `agent_id`      VARCHAR(36)  NULL AFTER `source_run_id`,
  ADD COLUMN IF NOT EXISTS `snapshot_json` LONGTEXT     NULL AFTER `columns_json`,
  ADD COLUMN IF NOT EXISTS `updated_at`    DATETIME     NULL;

-- ─── 5. Local Connector Governance ───────────────────────────────────────────
-- Tables for user-scoped authentication, authorization, and dynamic allowlists

CREATE TABLE IF NOT EXISTS `local_connector_user_configs` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `config_id`             VARCHAR(36)  NOT NULL UNIQUE,
  `user_id`               VARCHAR(36)  NOT NULL COMMENT 'FK to users.user_id',
  `tenant_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to tenants.tenant_id',
  `device_id`             VARCHAR(36)  NULL COMMENT 'Unique identifier for the user''s local device',
  `is_enabled`            BOOLEAN      NOT NULL DEFAULT FALSE,
  `last_seen_at`          DATETIME     NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_tenant` (`user_id`, `tenant_id`),
  INDEX `idx_device_id`   (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `local_connector_shell_allowlists` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `allowlist_id`          VARCHAR(36)  NOT NULL UNIQUE,
  `config_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to local_connector_user_configs.config_id',
  `alias`                 VARCHAR(128) NOT NULL,
  `command_template`      TEXT         NOT NULL COMMENT 'Template for the allowed command, e.g., "git {args}"',
  `allow_extra_args`      BOOLEAN      NOT NULL DEFAULT FALSE,
  `description`           TEXT         NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_config_alias` (`config_id`, `alias`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `local_connector_file_access_rules` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `rule_id`               VARCHAR(36)  NOT NULL UNIQUE,
  `config_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to local_connector_user_configs.config_id',
  `path_pattern`          VARCHAR(255) NOT NULL COMMENT 'Glob pattern for allowed file paths, e.g., "/Users/user/Documents/*.txt"',
  `access_mode`           ENUM('read','write','read_write') NOT NULL DEFAULT 'read',
  `description`           TEXT         NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_config_path` (`config_id`, `path_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- ─── 5. Local Connector Governance ───────────────────────────────────────────
-- Tables for user-scoped authentication, authorization, and dynamic allowlists

CREATE TABLE IF NOT EXISTS `local_connector_user_configs` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `config_id`             VARCHAR(36)  NOT NULL UNIQUE,
  `user_id`               VARCHAR(36)  NOT NULL COMMENT 'FK to users.user_id',
  `tenant_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to tenants.tenant_id',
  `device_id`             VARCHAR(36)  NULL COMMENT 'Unique identifier for the user''s local device',
  `is_enabled`            BOOLEAN      NOT NULL DEFAULT FALSE,
  `last_seen_at`          DATETIME     NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_tenant` (`user_id`, `tenant_id`),
  INDEX `idx_device_id`   (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `local_connector_shell_allowlists` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `allowlist_id`          VARCHAR(36)  NOT NULL UNIQUE,
  `config_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to local_connector_user_configs.config_id',
  `alias`                 VARCHAR(128) NOT NULL,
  `command_template`      TEXT         NOT NULL COMMENT 'Template for the allowed command, e.g., "git {args}"',
  `allow_extra_args`      BOOLEAN      NOT NULL DEFAULT FALSE,
  `description`           TEXT         NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_config_alias` (`config_id`, `alias`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `local_connector_file_access_rules` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `rule_id`               VARCHAR(36)  NOT NULL UNIQUE,
  `config_id`             VARCHAR(36)  NOT NULL COMMENT 'FK to local_connector_user_configs.config_id',
  `path_pattern`          VARCHAR(255) NOT NULL COMMENT 'Glob pattern for allowed file paths, e.g., "/Users/user/Documents/*.txt"',
  `access_mode`           ENUM('read','write','read_write') NOT NULL DEFAULT 'read',
  `description`           TEXT         NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_config_path` (`config_id`, `path_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
