-- Sprint 34: Register the Admin GPT Assistant as a platform agent
-- Gives the custom GPT admin assistant a fixed agent_id so its API calls
-- are attributed, skill-checked, and fully audited in the platform.

-- ── Agent definition ──────────────────────────────────────────────────────────

INSERT IGNORE INTO `agents`
  (agent_id, name, display_name, description,
   execution_class, execution_layer,
   system_prompt, health_status, is_system, status)
VALUES
  ('00000000-0000-4000-a000-000000000020',
   'admin_gpt_assistant',
   'Admin GPT Assistant',
   'Custom GPT admin assistant — platform owner interface for operations, governance, and system management.',
   'authority',
   'custom_gpt',
   'You are the Mad4B platform admin assistant. You have full authority over tenant management, agent orchestration, schema imports, release readiness, and operational controls.',
   'active', 1, 'active');

-- ── Skills needed by the admin GPT ───────────────────────────────────────────

INSERT IGNORE INTO `agent_skills`
  (skill_id, skill_key, display_name, skill_type, scope, capability_json, requires_approval, status)
VALUES
  ('00000000-0000-4000-a000-000000000030',
   'system_control_admin',
   'Admin System Control',
   'system_control', 'global',
   '{"allowed_actions":["schema_import","schema_rollback","agent_control","release_readiness","admin_cli"]}',
   0, 'active'),
  ('00000000-0000-4000-a000-000000000031',
   'api_access_platform',
   'Platform API Access',
   'api_access', 'global',
   '{"allowed_services":["tenants","identity","access","customers","planner","connector","workflows","observability","sessions","uploads"]}',
   0, 'active'),
  ('00000000-0000-4000-a000-000000000032',
   'data_readwrite_platform',
   'Platform Data Read/Write',
   'data_write', 'global',
   '{"tables":["*"],"operations":["SELECT","INSERT","UPDATE"]}',
   0, 'active'),
  ('00000000-0000-4000-a000-000000000033',
   'logic_execution_platform',
   'Platform Logic Execution',
   'logic_execution', 'global',
   '{"allowed_execution_classes":["rule_based","standard","complex","authority"]}',
   0, 'active');

-- ── Grant all 4 skills to the admin GPT agent ─────────────────────────────────

INSERT IGNORE INTO `agent_skill_grants`
  (grant_id, agent_id, skill_id, tenant_id, granted_by, status)
VALUES
  ('00000000-0000-4000-a000-000000000040',
   '00000000-0000-4000-a000-000000000020',
   '00000000-0000-4000-a000-000000000030',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active'),
  ('00000000-0000-4000-a000-000000000041',
   '00000000-0000-4000-a000-000000000020',
   '00000000-0000-4000-a000-000000000031',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active'),
  ('00000000-0000-4000-a000-000000000042',
   '00000000-0000-4000-a000-000000000020',
   '00000000-0000-4000-a000-000000000032',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active'),
  ('00000000-0000-4000-a000-000000000043',
   '00000000-0000-4000-a000-000000000020',
   '00000000-0000-4000-a000-000000000033',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active');
