-- Sprint 17: Public API and Developer Platform

CREATE TABLE IF NOT EXISTS `developer_apps` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_id`        VARCHAR(36) NOT NULL,
  `tenant_id`     VARCHAR(36) NOT NULL,
  `app_name`      VARCHAR(255) NOT NULL,
  `app_type`      ENUM('server','browser','mobile','integration') NOT NULL DEFAULT 'server',
  `scopes`        TEXT NULL,
  `redirect_uris` TEXT NULL,
  `status`        ENUM('active','suspended','revoked') NOT NULL DEFAULT 'active',
  `created_by`    VARCHAR(36) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_id` (`app_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `api_credentials` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `credential_id`  VARCHAR(36) NOT NULL,
  `app_id`         VARCHAR(36) NOT NULL,
  `tenant_id`      VARCHAR(36) NOT NULL,
  `key_prefix`     VARCHAR(8) NOT NULL,
  `key_hash`       VARCHAR(128) NOT NULL,
  `label`          VARCHAR(128) NULL,
  `scopes`         TEXT NULL,
  `last_used_at`   DATETIME NULL,
  `expires_at`     DATETIME NULL,
  `status`         ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credential_id` (`credential_id`),
  KEY `idx_app` (`app_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_prefix` (`key_prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `webhooks` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `webhook_id`     VARCHAR(36) NOT NULL,
  `tenant_id`      VARCHAR(36) NOT NULL,
  `app_id`         VARCHAR(36) NULL,
  `url`            TEXT NOT NULL,
  `events`         TEXT NOT NULL,
  `secret_hash`    VARCHAR(128) NULL,
  `status`         ENUM('active','paused','failed','revoked') NOT NULL DEFAULT 'active',
  `failure_count`  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `last_fired_at`  DATETIME NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_webhook_id` (`webhook_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `rate_limit_rules` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rule_id`      VARCHAR(36) NOT NULL,
  `tenant_id`    VARCHAR(36) NULL,
  `plan_key`     VARCHAR(64) NULL,
  `app_id`       VARCHAR(36) NULL,
  `route_pattern` VARCHAR(255) NOT NULL,
  `window_sec`   INT UNSIGNED NOT NULL DEFAULT 60,
  `max_requests` INT UNSIGNED NOT NULL DEFAULT 100,
  `action`       ENUM('block','throttle','log') NOT NULL DEFAULT 'block',
  `active`       TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rule_id` (`rule_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_plan` (`plan_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
