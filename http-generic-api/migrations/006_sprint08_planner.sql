-- Sprint 08: Prompt-to-Run Planner

CREATE TABLE IF NOT EXISTS `intent_resolutions` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `resolution_id`    VARCHAR(36) NOT NULL,
  `tenant_id`        VARCHAR(36) NOT NULL,
  `user_id`          VARCHAR(36) NULL,
  `raw_input`        TEXT NOT NULL,
  `resolved_intent`  VARCHAR(128) NULL,
  `confidence`       DECIMAL(5,4) NULL,
  `matched_route_key` VARCHAR(128) NULL,
  `matched_workflow_key` VARCHAR(128) NULL,
  `resolution_status` ENUM('resolved','ambiguous','unmatched','blocked') NOT NULL DEFAULT 'unmatched',
  `service_mode`     ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `meta_json`        TEXT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resolution_id` (`resolution_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_intent` (`resolved_intent`),
  KEY `idx_status` (`resolution_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `execution_plans` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id`           VARCHAR(36) NOT NULL,
  `tenant_id`         VARCHAR(36) NOT NULL,
  `user_id`           VARCHAR(36) NULL,
  `resolution_id`     VARCHAR(36) NULL,
  `intent_key`        VARCHAR(128) NULL,
  `brand_key`         VARCHAR(128) NULL,
  `target_key`        VARCHAR(128) NULL,
  `workflow_key`      VARCHAR(128) NULL,
  `route_key`         VARCHAR(128) NULL,
  `service_mode`      ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `access_decision`   ENUM('ALLOW_SELF_SERVE','ALLOW_WITH_OPTIONAL_ASSISTANCE','REQUIRE_REVIEW','REQUIRE_SUPERVISOR_APPROVAL','ROUTE_TO_MANAGED_SERVICE','DENY') NULL,
  `plan_status`       ENUM('draft','validated','approved','executing','completed','failed','cancelled') NOT NULL DEFAULT 'draft',
  `steps_json`        TEXT NULL,
  `preview_json`      TEXT NULL,
  `validation_errors` TEXT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_id` (`plan_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_resolution` (`resolution_id`),
  KEY `idx_status` (`plan_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
