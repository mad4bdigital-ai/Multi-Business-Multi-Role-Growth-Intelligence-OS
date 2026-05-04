-- Sprint 15: Observability and Metering

CREATE TABLE IF NOT EXISTS `telemetry_spans` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `span_id`        VARCHAR(36) NOT NULL,
  `trace_id`       VARCHAR(36) NOT NULL,
  `tenant_id`      VARCHAR(36) NULL,
  `run_id`         VARCHAR(36) NULL,
  `span_name`      VARCHAR(128) NOT NULL,
  `span_type`      ENUM('http','db','queue','ai','review','managed','internal') NOT NULL DEFAULT 'internal',
  `service_mode`   ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `status`         ENUM('ok','error','timeout') NOT NULL DEFAULT 'ok',
  `duration_ms`    INT UNSIGNED NULL,
  `attributes_json` TEXT NULL,
  `error_message`  VARCHAR(512) NULL,
  `started_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_span_id` (`span_id`),
  KEY `idx_trace` (`trace_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_run` (`run_id`),
  KEY `idx_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `usage_meters` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `meter_id`        VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `meter_key`       VARCHAR(128) NOT NULL,
  `period_start`    DATE NOT NULL,
  `period_end`      DATE NOT NULL,
  `unit`            VARCHAR(32) NOT NULL DEFAULT 'count',
  `quantity`        BIGINT NOT NULL DEFAULT 0,
  `service_mode`    ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `cost_usd`        DECIMAL(12,4) NULL,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_meter_id` (`meter_id`),
  UNIQUE KEY `uq_tenant_key_period` (`tenant_id`, `meter_key`, `period_start`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_period` (`period_start`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `quota_rules` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rule_id`      VARCHAR(36) NOT NULL,
  `plan_key`     VARCHAR(64) NULL,
  `tenant_id`    VARCHAR(36) NULL,
  `meter_key`    VARCHAR(128) NOT NULL,
  `limit_value`  BIGINT NULL,
  `period`       ENUM('daily','monthly','annual','lifetime') NOT NULL DEFAULT 'monthly',
  `action`       ENUM('block','warn','throttle') NOT NULL DEFAULT 'warn',
  `active`       TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rule_id` (`rule_id`),
  KEY `idx_plan` (`plan_key`),
  KEY `idx_tenant_meter` (`tenant_id`, `meter_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
