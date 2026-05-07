-- Sprint 32: Tenant commercial layer
-- credit_balances, credit_ledger, usage_limits, tenant_usage, commercial_profiles
-- Seeds: platform_owner plan + Nagy's tenant bootstrapped with unlimited access

-- ── Credit balance (current snapshot, updated on every ledger write) ──────────

CREATE TABLE IF NOT EXISTS `credit_balances` (
  `id`                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `tenant_id`         VARCHAR(36)      NOT NULL,
  `balance`           DECIMAL(14,4)    NOT NULL DEFAULT 0.0000 COMMENT 'Available credits',
  `reserved`          DECIMAL(14,4)    NOT NULL DEFAULT 0.0000 COMMENT 'In-flight/pending deductions',
  `lifetime_credited` DECIMAL(14,4)    NOT NULL DEFAULT 0.0000,
  `lifetime_consumed` DECIMAL(14,4)    NOT NULL DEFAULT 0.0000,
  `currency`          VARCHAR(8)       NOT NULL DEFAULT 'USD',
  `last_topup_at`     DATETIME         NULL,
  `last_consumed_at`  DATETIME         NULL,
  `updated_at`        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Credit ledger (immutable audit trail) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS `credit_ledger` (
  `id`            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `ledger_id`     VARCHAR(36)    NOT NULL,
  `tenant_id`     VARCHAR(36)    NOT NULL,
  `amount`        DECIMAL(14,4)  NOT NULL COMMENT 'Positive = credit, negative = debit',
  `balance_after` DECIMAL(14,4)  NOT NULL,
  `ledger_type`   ENUM('topup','usage_session','usage_api','usage_upload','usage_storage',
                       'adjustment','refund','expiry','promotional') NOT NULL,
  `ref_type`      VARCHAR(64)    NULL COMMENT 'session | upload | api_call | subscription',
  `ref_id`        VARCHAR(128)   NULL,
  `description`   VARCHAR(512)   NULL,
  `created_by`    VARCHAR(36)    NULL COMMENT 'user_id of admin who made a manual adjustment',
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ledger_id` (`ledger_id`),
  KEY `idx_tenant_time` (`tenant_id`, `created_at`),
  KEY `idx_type` (`ledger_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Usage limits (per-tenant overrides; NULL = inherit plan / unlimited) ──────

CREATE TABLE IF NOT EXISTS `usage_limits` (
  `id`                       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`                VARCHAR(36)   NOT NULL,
  `monthly_session_minutes`  INT UNSIGNED  NULL COMMENT 'NULL = unlimited',
  `monthly_api_calls`        INT UNSIGNED  NULL,
  `monthly_uploads`          SMALLINT UNSIGNED NULL,
  `max_drive_bytes`          BIGINT UNSIGNED   NULL,
  `max_seats`                SMALLINT UNSIGNED NULL,
  `credit_limit`             DECIMAL(14,4) NULL COMMENT 'NULL = unlimited; hard stop when balance hits 0',
  `overage_allowed`          TINYINT(1)    NOT NULL DEFAULT 0,
  `overage_rate_per_unit`    DECIMAL(10,6) NULL COMMENT 'USD per credit unit if overage allowed',
  `updated_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Monthly usage counters (one row per tenant per month, upserted on events) ─

CREATE TABLE IF NOT EXISTS `tenant_usage` (
  `id`                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`            VARCHAR(36)   NOT NULL,
  `period`               VARCHAR(7)    NOT NULL COMMENT 'YYYY-MM',
  `session_count`        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `session_minutes`      INT UNSIGNED  NOT NULL DEFAULT 0,
  `api_calls`            INT UNSIGNED  NOT NULL DEFAULT 0,
  `uploads_count`        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `drive_files_count`    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `drive_bytes_stored`   BIGINT UNSIGNED   NOT NULL DEFAULT 0,
  `credits_consumed`     DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_period` (`tenant_id`, `period`),
  KEY `idx_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Commercial profile (market intelligence per tenant) ───────────────────────

CREATE TABLE IF NOT EXISTS `commercial_profiles` (
  `id`                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`          VARCHAR(36)   NOT NULL,
  `industry`           VARCHAR(128)  NULL COMMENT 'web_agency, ecommerce, saas, consulting, media',
  `company_size`       ENUM('solo','micro','small','medium','enterprise') NULL,
  `markets_json`       JSON          NULL COMMENT 'Geographic market codes: ["AU","US","UK"]',
  `verticals_json`     JSON          NULL COMMENT 'Platform verticals: ["wordpress","shopify","woocommerce"]',
  `contract_type`      ENUM('monthly','annual','lifetime','managed','trial') NULL,
  `billing_currency`   VARCHAR(8)    NOT NULL DEFAULT 'USD',
  `mrr_usd`            DECIMAL(10,2) NULL COMMENT 'Monthly recurring revenue',
  `arr_usd`            DECIMAL(10,2) NULL COMMENT 'Annual recurring revenue',
  `ltv_usd`            DECIMAL(10,2) NULL COMMENT 'Lifetime value estimate',
  `acquisition_source` VARCHAR(128)  NULL COMMENT 'organic, referral, linkedin, cold_outreach',
  `health_score`       TINYINT UNSIGNED NULL COMMENT '0-100 customer health score',
  `churn_risk`         ENUM('low','medium','high') NULL,
  `notes`              TEXT          NULL,
  `updated_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seeds ─────────────────────────────────────────────────────────────────────

-- Platform owner plan
INSERT IGNORE INTO `plans`
  (plan_id, plan_key, display_name, service_mode, price_monthly_usd, active)
VALUES
  ('00000000-0000-4000-a000-000000000010', 'platform_owner', 'Platform Owner', 'managed', 0.00, 1);

-- Platform owner subscription
INSERT IGNORE INTO `subscriptions`
  (subscription_id, tenant_id, plan_id, status)
VALUES
  ('00000000-0000-4000-a000-000000000011',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000010',
   'active');

-- Platform owner credit balance (effectively unlimited)
INSERT IGNORE INTO `credit_balances`
  (tenant_id, balance, lifetime_credited, currency)
VALUES
  ('00000000-0000-4000-a000-000000000001', 999999.0000, 999999.0000, 'USD');

INSERT IGNORE INTO `credit_ledger`
  (ledger_id, tenant_id, amount, balance_after, ledger_type, description, created_by)
VALUES
  ('00000000-0000-4000-a000-000000000012',
   '00000000-0000-4000-a000-000000000001',
   999999.0000, 999999.0000, 'topup',
   'Platform owner bootstrap credit',
   '00000000-0000-4000-a000-000000000002');

-- Platform owner usage limits (all NULL = unlimited)
INSERT IGNORE INTO `usage_limits`
  (tenant_id, overage_allowed)
VALUES
  ('00000000-0000-4000-a000-000000000001', 1);

-- Platform owner commercial profile
INSERT IGNORE INTO `commercial_profiles`
  (tenant_id, industry, company_size, contract_type, billing_currency,
   markets_json, verticals_json, acquisition_source, health_score)
VALUES
  ('00000000-0000-4000-a000-000000000001',
   'platform_operator', 'solo', 'lifetime', 'USD',
   '["AU"]',
   '["wordpress","woocommerce","shopify","saas"]',
   'founder', 100);
