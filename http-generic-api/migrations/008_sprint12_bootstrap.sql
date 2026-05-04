-- Sprint 12: Guided Setup and Bootstrap

CREATE TABLE IF NOT EXISTS `onboarding_states` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `onboarding_id`      VARCHAR(36) NOT NULL,
  `tenant_id`          VARCHAR(36) NOT NULL,
  `current_step`       VARCHAR(64) NOT NULL DEFAULT 'start',
  `completed_steps`    TEXT NULL,
  `service_mode`       ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `connector_first`    TINYINT(1) NOT NULL DEFAULT 0,
  `managed_launch`     TINYINT(1) NOT NULL DEFAULT 0,
  `overall_status`     ENUM('not_started','in_progress','complete','abandoned') NOT NULL DEFAULT 'not_started',
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_onboarding_id` (`onboarding_id`),
  UNIQUE KEY `uq_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `readiness_checks` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `check_id`       VARCHAR(36) NOT NULL,
  `tenant_id`      VARCHAR(36) NOT NULL,
  `check_key`      VARCHAR(64) NOT NULL,
  `check_status`   ENUM('pass','fail','warn','pending') NOT NULL DEFAULT 'pending',
  `detail`         VARCHAR(512) NULL,
  `checked_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_check_id` (`check_id`),
  KEY `idx_tenant_key` (`tenant_id`, `check_key`),
  KEY `idx_status` (`check_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
