-- Sprint 07: Connected Systems Framework

CREATE TABLE IF NOT EXISTS `connected_systems` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `system_id`          VARCHAR(36) NOT NULL,
  `tenant_id`          VARCHAR(36) NOT NULL,
  `system_key`         VARCHAR(128) NOT NULL,
  `display_name`       VARCHAR(255) NOT NULL,
  `provider_family`    VARCHAR(64) NOT NULL,
  `provider_domain`    VARCHAR(255) NULL,
  `connector_family`   VARCHAR(64) NULL,
  `auth_type`          VARCHAR(64) NULL,
  `service_mode`       ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `self_serve_capable` TINYINT(1) NOT NULL DEFAULT 1,
  `assisted_capable`   TINYINT(1) NOT NULL DEFAULT 0,
  `managed_capable`    TINYINT(1) NOT NULL DEFAULT 0,
  `status`             ENUM('active','pending','error','archived') NOT NULL DEFAULT 'pending',
  `config_json`        TEXT NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_id` (`system_id`),
  UNIQUE KEY `uq_tenant_system_key` (`tenant_id`, `system_key`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_provider_family` (`provider_family`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `installations` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `installation_id` VARCHAR(36) NOT NULL,
  `system_id`       VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `scope`           VARCHAR(512) NULL,
  `credential_ref`  VARCHAR(255) NULL,
  `status`          ENUM('active','revoked','expired','error') NOT NULL DEFAULT 'active',
  `installed_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      DATETIME NULL,
  `meta_json`       TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_installation_id` (`installation_id`),
  KEY `idx_system` (`system_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `permission_grants` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grant_id`      VARCHAR(36) NOT NULL,
  `installation_id` VARCHAR(36) NOT NULL,
  `tenant_id`     VARCHAR(36) NOT NULL,
  `permission_key` VARCHAR(128) NOT NULL,
  `granted`       TINYINT(1) NOT NULL DEFAULT 1,
  `granted_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `granted_by`    VARCHAR(36) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grant_id` (`grant_id`),
  KEY `idx_installation` (`installation_id`),
  KEY `idx_tenant_key` (`tenant_id`, `permission_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `workspace_registry` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `workspace_id`      VARCHAR(36) NOT NULL,
  `tenant_id`         VARCHAR(36) NOT NULL,
  `workspace_key`     VARCHAR(128) NOT NULL,
  `display_name`      VARCHAR(255) NOT NULL,
  `workspace_type`    ENUM('brand','project','campaign','sandbox') NOT NULL DEFAULT 'brand',
  `bootstrap_status`  ENUM('not_started','in_progress','ready','degraded','error') NOT NULL DEFAULT 'not_started',
  `linked_brand_key`  VARCHAR(128) NULL,
  `linked_system_ids` TEXT NULL,
  `config_json`       TEXT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_id` (`workspace_id`),
  UNIQUE KEY `uq_tenant_workspace_key` (`tenant_id`, `workspace_key`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_bootstrap` (`bootstrap_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
