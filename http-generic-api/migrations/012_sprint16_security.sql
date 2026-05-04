-- Sprint 16: Security, Compliance, and Records

-- Immutable audit log — no UPDATE/DELETE allowed by application
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `audit_id`     VARCHAR(36) NOT NULL,
  `tenant_id`    VARCHAR(36) NULL,
  `actor_id`     VARCHAR(36) NULL,
  `actor_type`   VARCHAR(64) NULL,
  `action`       VARCHAR(128) NOT NULL,
  `resource_type` VARCHAR(64) NULL,
  `resource_id`  VARCHAR(128) NULL,
  `before_json`  TEXT NULL,
  `after_json`   TEXT NULL,
  `ip_address`   VARCHAR(64) NULL,
  `user_agent`   VARCHAR(512) NULL,
  `service_mode` ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `occurred_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_audit_id` (`audit_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_actor` (`actor_id`),
  KEY `idx_action` (`action`),
  KEY `idx_occurred` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `secret_references` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ref_id`        VARCHAR(36) NOT NULL,
  `tenant_id`     VARCHAR(36) NOT NULL,
  `secret_key`    VARCHAR(128) NOT NULL,
  `store_type`    ENUM('env','vault','db_encrypted','external') NOT NULL DEFAULT 'env',
  `env_var_name`  VARCHAR(128) NULL,
  `vault_path`    VARCHAR(512) NULL,
  `description`   VARCHAR(255) NULL,
  `rotated_at`    DATETIME NULL,
  `expires_at`    DATETIME NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ref_id` (`ref_id`),
  UNIQUE KEY `uq_tenant_key` (`tenant_id`, `secret_key`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `incidents` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `incident_id`   VARCHAR(36) NOT NULL,
  `tenant_id`     VARCHAR(36) NULL,
  `title`         VARCHAR(512) NOT NULL,
  `severity`      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `category`      ENUM('security','compliance','operational','data_breach','unauthorized_access','review_violation','other') NOT NULL DEFAULT 'other',
  `status`        ENUM('open','investigating','contained','resolved','closed') NOT NULL DEFAULT 'open',
  `assigned_to`   VARCHAR(36) NULL,
  `description`   TEXT NULL,
  `resolved_at`   DATETIME NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_incident_id` (`incident_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_severity` (`severity`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `compliance_profiles` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_id`      VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `framework`       VARCHAR(64) NOT NULL,
  `status`          ENUM('compliant','non_compliant','under_review','exempt') NOT NULL DEFAULT 'under_review',
  `last_assessed_at` DATETIME NULL,
  `notes`           TEXT NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_profile_id` (`profile_id`),
  UNIQUE KEY `uq_tenant_framework` (`tenant_id`, `framework`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
