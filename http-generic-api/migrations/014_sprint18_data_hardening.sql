-- Sprint 18: Data Hardening and Release Readiness

-- Entity classification: tracks which tables are canonical vs derived,
-- source of truth, and migration status.
CREATE TABLE IF NOT EXISTS `data_migration_inventory` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_class`     VARCHAR(128) NOT NULL,
  `table_name`       VARCHAR(128) NOT NULL,
  `authority_model`  ENUM('canonical','derived','mirror','legacy','transitional') NOT NULL DEFAULT 'canonical',
  `read_priority`    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `write_strategy`   ENUM('platform_primary','legacy_primary','dual_write','read_only','platform_only') NOT NULL DEFAULT 'platform_primary',
  `migration_status` ENUM('not_started','in_progress','complete','deprecated') NOT NULL DEFAULT 'not_started',
  `row_count`        BIGINT NULL,
  `notes`            TEXT NULL,
  `last_checked_at`  DATETIME NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_table` (`table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Release readiness: records results of pre-release verification checks.
CREATE TABLE IF NOT EXISTS `release_readiness_log` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id`       VARCHAR(36) NOT NULL,
  `check_key`    VARCHAR(128) NOT NULL,
  `status`       ENUM('pass','fail','warn','skip') NOT NULL,
  `detail`       TEXT NULL,
  `checked_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_run` (`run_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
