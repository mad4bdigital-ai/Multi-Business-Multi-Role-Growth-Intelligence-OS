-- Sprint 03: Identity, Roles, Plans, Entitlements

CREATE TABLE IF NOT EXISTS `users` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      VARCHAR(36) NOT NULL,
  `email`        VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `status`       ENUM('active','suspended','pending','archived') NOT NULL DEFAULT 'active',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_id` (`user_id`),
  UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `actor_profiles` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_id`       VARCHAR(36) NOT NULL,
  `user_id`          VARCHAR(36) NOT NULL,
  `tenant_id`        VARCHAR(36) NOT NULL,
  `actor_type`       ENUM('platform_owner','partner','freelancer','client','brand_operator') NOT NULL,
  `profile_data_json` TEXT NULL,
  `status`           ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_profile_id` (`profile_id`),
  UNIQUE KEY `uq_user_tenant` (`user_id`, `tenant_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `role_assignments` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assignment_id` VARCHAR(36) NOT NULL,
  `user_id`      VARCHAR(36) NOT NULL,
  `tenant_id`    VARCHAR(36) NOT NULL,
  `role`         VARCHAR(64) NOT NULL,
  `granted_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `granted_by`   VARCHAR(36) NULL,
  `expires_at`   DATETIME NULL,
  `status`       ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assignment_id` (`assignment_id`),
  KEY `idx_user_tenant` (`user_id`, `tenant_id`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `plans` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id`            VARCHAR(36) NOT NULL,
  `plan_key`           VARCHAR(64) NOT NULL,
  `display_name`       VARCHAR(255) NOT NULL,
  `service_mode`       ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `features_json`      TEXT NULL,
  `limits_json`        TEXT NULL,
  `price_monthly_usd`  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `active`             TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_id` (`plan_id`),
  UNIQUE KEY `uq_plan_key` (`plan_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subscription_id` VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `plan_id`         VARCHAR(36) NOT NULL,
  `status`          ENUM('active','past_due','cancelled','trialing','paused') NOT NULL DEFAULT 'active',
  `started_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscription_id` (`subscription_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_plan` (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `entitlements` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entitlement_id`    VARCHAR(36) NOT NULL,
  `tenant_id`         VARCHAR(36) NOT NULL,
  `entitlement_key`   VARCHAR(128) NOT NULL,
  `entitlement_value` TEXT NOT NULL,
  `source`            ENUM('plan','manual','trial','promotional') NOT NULL DEFAULT 'plan',
  `granted_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`        DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_entitlement_id` (`entitlement_id`),
  KEY `idx_tenant_key` (`tenant_id`, `entitlement_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `assistance_roles` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`          VARCHAR(36) NOT NULL,
  `role_key`         VARCHAR(64) NOT NULL,
  `display_name`     VARCHAR(255) NOT NULL,
  `level`            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `capabilities_json` TEXT NULL,
  `active`           TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_id` (`role_id`),
  UNIQUE KEY `uq_role_key` (`role_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
