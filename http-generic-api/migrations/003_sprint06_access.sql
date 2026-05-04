-- Sprint 06: Runtime Access Engine

CREATE TABLE IF NOT EXISTS `request_envelopes` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `envelope_id`     VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `user_id`         VARCHAR(36) NULL,
  `actor_type`      VARCHAR(64) NULL,
  `intent_key`      VARCHAR(128) NULL,
  `brand_key`       VARCHAR(128) NULL,
  `target_key`      VARCHAR(128) NULL,
  `service_mode`    ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `access_decision` ENUM('ALLOW_SELF_SERVE','ALLOW_WITH_OPTIONAL_ASSISTANCE','REQUIRE_REVIEW','REQUIRE_SUPERVISOR_APPROVAL','ROUTE_TO_MANAGED_SERVICE','DENY') NULL,
  `decision_reason` VARCHAR(255) NULL,
  `risk_level`      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  `request_json`    TEXT NULL,
  `resolved_at`     DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_envelope_id` (`envelope_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_decision` (`access_decision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
