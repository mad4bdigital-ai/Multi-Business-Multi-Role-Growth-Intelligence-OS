-- Sprint 10: Tracking and Reporting Core

CREATE TABLE IF NOT EXISTS `tracking_workspaces` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `workspace_id`      VARCHAR(36) NOT NULL,
  `tenant_id`         VARCHAR(36) NOT NULL,
  `workspace_key`     VARCHAR(128) NOT NULL,
  `display_name`      VARCHAR(255) NOT NULL,
  `ga_property_id`    VARCHAR(64) NULL,
  `gtm_container_id`  VARCHAR(64) NULL,
  `gsc_property`      VARCHAR(255) NULL,
  `tracking_status`   ENUM('active','inactive','error') NOT NULL DEFAULT 'inactive',
  `service_mode`      ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_id` (`workspace_id`),
  UNIQUE KEY `uq_tenant_key` (`tenant_id`, `workspace_key`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tracked_events` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`         VARCHAR(36) NOT NULL,
  `tenant_id`        VARCHAR(36) NOT NULL,
  `workspace_id`     VARCHAR(36) NULL,
  `event_category`   VARCHAR(64) NOT NULL,
  `event_type`       VARCHAR(128) NOT NULL,
  `actor_id`         VARCHAR(36) NULL,
  `actor_type`       VARCHAR(64) NULL,
  `subject_id`       VARCHAR(36) NULL,
  `subject_type`     VARCHAR(64) NULL,
  `service_mode`     ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `dimensions_json`  TEXT NULL,
  `metrics_json`     TEXT NULL,
  `occurred_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_id` (`event_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_category_type` (`event_category`, `event_type`),
  KEY `idx_occurred` (`occurred_at`),
  KEY `idx_service_mode` (`service_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `reporting_views` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `view_id`          VARCHAR(36) NOT NULL,
  `tenant_id`        VARCHAR(36) NOT NULL,
  `view_key`         VARCHAR(128) NOT NULL,
  `display_name`     VARCHAR(255) NOT NULL,
  `view_type`        ENUM('execution_summary','access_audit','customer_timeline','assisted_ops','managed_delivery','custom') NOT NULL DEFAULT 'execution_summary',
  `filters_json`     TEXT NULL,
  `columns_json`     TEXT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_view_id` (`view_id`),
  UNIQUE KEY `uq_tenant_key` (`tenant_id`, `view_key`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
