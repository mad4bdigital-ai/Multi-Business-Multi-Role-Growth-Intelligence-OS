-- Sprint 62f: merge duplicate local connector device identities
-- A physical device may appear under multiple names after reinstall/manual seeding.
-- Keep one canonical device_id and retain aliases for routing and audit.

CREATE TABLE IF NOT EXISTS `local_connector_device_aliases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alias_device_id` VARCHAR(128) NOT NULL,
  `canonical_device_id` VARCHAR(128) NOT NULL,
  `canonical_config_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `reason` VARCHAR(255) NULL,
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_local_device_alias` (`alias_device_id`, `user_id`, `tenant_id`),
  KEY `idx_local_device_alias_canonical` (`canonical_device_id`, `status`),
  KEY `idx_local_device_alias_config` (`canonical_config_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
