-- Sprint 02: Tenancy Graph
-- Run via: node migrate-platform-tables.mjs

CREATE TABLE IF NOT EXISTS `tenants` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    VARCHAR(36)  NOT NULL,
  `tenant_type`  ENUM('platform_owner','partner_organization','freelancer_operator','managed_client_account','brand') NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `status`       ENUM('active','suspended','pending','archived') NOT NULL DEFAULT 'active',
  `metadata_json` TEXT NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tenant_relationships` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_tenant_id`   VARCHAR(36) NOT NULL,
  `child_tenant_id`    VARCHAR(36) NOT NULL,
  `relationship_type`  ENUM('owns','manages','partners_with','white_labels') NOT NULL,
  `status`             ENUM('active','suspended','terminated') NOT NULL DEFAULT 'active',
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rel` (`parent_tenant_id`, `child_tenant_id`, `relationship_type`),
  KEY `idx_parent` (`parent_tenant_id`),
  KEY `idx_child` (`child_tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `memberships` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     VARCHAR(36) NOT NULL,
  `tenant_id`   VARCHAR(36) NOT NULL,
  `role`        VARCHAR(64) NOT NULL,
  `status`      ENUM('active','suspended','revoked') NOT NULL DEFAULT 'active',
  `granted_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_membership` (`user_id`, `tenant_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `invitations` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invitation_id` VARCHAR(36) NOT NULL,
  `tenant_id`   VARCHAR(36) NOT NULL,
  `email`       VARCHAR(255) NOT NULL,
  `role`        VARCHAR(64) NOT NULL,
  `token`       VARCHAR(128) NOT NULL,
  `status`      ENUM('pending','accepted','expired','revoked') NOT NULL DEFAULT 'pending',
  `expires_at`  DATETIME NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invitation_id` (`invitation_id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
