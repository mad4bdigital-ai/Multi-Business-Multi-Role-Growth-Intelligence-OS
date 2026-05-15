-- Sprint 48: Cloudflare admin tool + connector activation + self-repair tooling
-- Empowers admin GPT to self-diagnose and repair connected systems:
-- Cloudflare tunnels/DNS, Hostinger VPS, GitHub repo, local connector.

-- ─── Update admin_control tool description and enum ───────────────────────────
UPDATE `admin_platform_endpoint_tools`
SET
  description = 'Run github CLI, gcloud CLI, DB SQL, env inspect/mutate, Hostinger API, Cloudflare API, or allowlisted shell commands.',
  input_schema = '{"type":"object","required":["tool"],"properties":{"tool":{"type":"string","enum":["github","gcloud","db","env","shell","hostinger","cloudflare","windows_app"]},"args":{"type":"array","items":{"type":"string"}},"sql":{"type":"string"},"params":{"type":"array"},"action":{"type":"string","enum":["run","list","get","set","unset","status","authorize","launch"]},"alias":{"type":"string"},"name":{"type":"string"},"value":{"type":"string"},"include_values":{"type":"boolean"},"reveal_values":{"type":"boolean"},"timeout_ms":{"type":"integer"}}}'
WHERE tool_key = 'admin_control';

-- ─── Cloudflare admin tool ────────────────────────────────────────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('admin_cloudflare',
 'Cloudflare API',
 'Forward any call to the Cloudflare REST API (tunnels, DNS records, zones, workers, R2). Use path like /client/v4/accounts/{account_id}/tunnels for tunnel management, /client/v4/zones/{zone_id}/dns_records for DNS.',
 'POST', '/admin/cli/cloudflare',
 NULL,
 '{"type":"object","required":["path"],"properties":{"path":{"type":"string","description":"Cloudflare API path, e.g. /client/v4/accounts/{account_id}/tunnels"},"method":{"type":"string","enum":["GET","POST","PUT","DELETE","PATCH"],"default":"GET"},"request_body":{"type":"object"},"params":{"type":"object","description":"Query parameters"}}}',
 NULL,
 'admin,cloudflare', 65)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  input_schema = VALUES(input_schema),
  tags         = VALUES(tags);

-- ─── Connector activation tool ────────────────────────────────────────────────
-- Allows GPT to activate pending connectors directly via DB
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('admin_connector_activate',
 'Activate Connector',
 'Set a system connector status to active (or pending/disabled). Use admin_system_connectors_list first to find the system_key. Safe to call: only updates status + updated_at.',
 'POST', '/admin/control',
 NULL,
 '{"type":"object","required":["system_key","status"],"properties":{"system_key":{"type":"string"},"status":{"type":"string","enum":["active","pending","disabled"]}}}',
 '{"tool":"db","action":"run"}',
 'admin,connectors', 68)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description);

-- ─── Cloudflare tunnel diagnostic tool ────────────────────────────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('cloudflare_tunnel_status',
 'Cloudflare Tunnel Status',
 'List active Cloudflare tunnels for the configured account. Diagnose tunnel 1033 errors (connector.mad4b.com). Pass account_id or omit to use CLOUDFLARE_ACCOUNT_ID env.',
 'POST', '/admin/cli/cloudflare',
 NULL,
 '{"type":"object","properties":{"account_id":{"type":"string","description":"Cloudflare account ID; defaults to env CLOUDFLARE_ACCOUNT_ID"},"tunnel_name":{"type":"string","description":"Filter by tunnel name"}}}',
 NULL,
 'cloudflare,tunnels', 66)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description);

-- ─── Activate Hostinger connector (was status=pending) ────────────────────────
UPDATE `connected_systems`
SET   status = 'active', updated_at = NOW()
WHERE system_key = 'hostinger_api_connector_https_developers_hostinger_com'
  AND status = 'pending';

-- ─── Self-repair diagnostic tool ──────────────────────────────────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('platform_self_repair_diagnose',
 'Self-Repair Diagnostic',
 'Run a full platform self-repair diagnostic: check connector tunnel status, Hostinger VPS health, GitHub binding, DB connectivity, and local connector reachability. Returns a repair plan with specific actions.',
 'GET', '/activation/bootstrap-config',
 NULL,
 NULL,
 NULL,
 'admin,repair', 69)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description);
