-- Sprint 31a: Seed platform owner tenant + admin user
-- Sprint 31b: Link customers to users (optional user_id FK)

-- ── 31b: customers → users link ───────────────────────────────────────────────

ALTER TABLE `customers`
  ADD COLUMN IF NOT EXISTS `user_id` VARCHAR(36) NULL COMMENT 'Set when this CRM customer has a platform login'
  AFTER `customer_id`,
  ADD UNIQUE KEY IF NOT EXISTS `uq_customer_user` (`tenant_id`, `user_id`);

-- ── 31a: Platform owner tenant ────────────────────────────────────────────────

INSERT IGNORE INTO `tenants`
  (tenant_id, tenant_type, display_name, status)
VALUES
  ('00000000-0000-4000-a000-000000000001', 'platform_owner', 'Mad4B Platform', 'active');

-- ── 31a: Admin user (Nagy) ────────────────────────────────────────────────────

INSERT IGNORE INTO `users`
  (user_id, email, display_name, status)
VALUES
  ('00000000-0000-4000-a000-000000000002', 'mad4b.digital@gmail.com', 'Nagy', 'active');

-- ── 31a: Admin membership ─────────────────────────────────────────────────────

INSERT IGNORE INTO `memberships`
  (user_id, tenant_id, role, status)
VALUES
  ('00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',
   'platform_owner', 'active');

-- ── 31a: Actor profile ────────────────────────────────────────────────────────

INSERT IGNORE INTO `actor_profiles`
  (profile_id, user_id, tenant_id, actor_type, status)
VALUES
  ('00000000-0000-4000-a000-000000000003',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',
   'platform_owner', 'active');

-- ── 31a: Role assignment ──────────────────────────────────────────────────────

INSERT IGNORE INTO `role_assignments`
  (assignment_id, user_id, tenant_id, role, granted_by, status)
VALUES
  ('00000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',
   'platform_owner',
   '00000000-0000-4000-a000-000000000002',
   'active');
