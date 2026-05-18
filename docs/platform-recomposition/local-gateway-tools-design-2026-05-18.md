# local.mad4b.com Gateway Tools Design - 2026-05-18

## Decision

`local.mad4b.com` is the public Hostinger/Auth gateway for tenants, members, and governed local-device usage.

`connector.mad4b.com` remains an admin-only and break-glass recovery tunnel. It may be used as `tunnel_url` only for admin recovery devices or exceptional recovery paths.

## Why a separate table

The existing `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools` tables describe GPT-facing tool surfaces. They are not precise enough to model the public local gateway because the gateway needs its own visibility, policy, service-mode, and audit behavior.

The new gateway needs to answer:

- Which local tools are visible on `local.mad4b.com`?
- Which dispatch tool do they map to internally?
- Which caller types may use them?
- Is device_id required?
- Is tenant context required?
- Is approval required?
- Is the action consequential?
- Which calls were made, by whom, for which tenant/device, and with what result?

## Tables

### `local_gateway_tools`

Registry for tools exposed by the local gateway.

Important fields:

- `tool_key` - public gateway tool key, e.g. `local.connector.health`
- `dispatch_tool_key` - internal governed tool, e.g. `connector_health`
- `public_host` - normally `local.mad4b.com`
- `public_path` - normally `/local/tools/call`
- `dispatch_surface` - `device_tools`, `gpt_tools`, or `auth_route`
- `target_path_template` - internal route such as `/connector/{device_id}/files`
- `risk_class`
- `requires_admin`
- `requires_approval`
- `is_consequential`
- `allowed_caller_types_json`
- `service_modes_json`
- `input_schema`
- `status`

### `local_gateway_tool_call_log`

Append-only call audit table for gateway calls.

Important fields:

- `call_id`
- `tool_key`
- `dispatch_tool_key`
- `public_host`
- `user_id`
- `tenant_id`
- `device_id`
- `config_id`
- `route_id`
- `auth_mode`
- `caller_type`
- `service_mode`
- `request_args_hash`
- `request_args_json`
- `redaction_status`
- `status`
- `http_status`
- `error_code`
- `duration_ms`
- `trace_id`

## Seeded gateway tools

| Gateway tool | Dispatch tool | Status | Risk | Notes |
|---|---|---|---|---|
| `local.connector.health` | `connector_health` | active | low | Tenant-safe health diagnostic. |
| `local.connector.files` | `connector_files` | active | high | Requires approval policy for write/read sensitive paths. |
| `local.connector.shell` | `connector_shell` | active | high | Allowlisted aliases only. |
| `local.connector.apps` | `connector_apps` | active | medium | Interactive local apps. |
| `local.connector.browser` | `connector_browser` | active | medium | HTTP/HTTPS only. |
| `local.connector.n8n` | `connector_n8n` | active | high | Workflow activation/execution should be entitlement and approval gated. |
| `local.connector.dependencies` | `connector_dependencies` | planned | high/admin | Recovery dependency installs are not normal tenant self-serve. |

## Runtime routing model

1. Request enters `local.mad4b.com` on the same Hostinger/Auth app as `auth.mad4b.com`.
2. Auth resolves user, tenant, role, service mode, and entitlement.
3. Gateway resolves the requested `tool_key` from `local_gateway_tools`.
4. Gateway validates device ownership and route policy from DB.
5. Gateway dispatches internally to the mapped device tool or auth route.
6. Gateway writes `local_gateway_tool_call_log` with redacted request evidence and result state.

## DNS and tunnel model

- `local.mad4b.com` must point to the Hostinger/Auth application, not directly to a Windows Cloudflare tunnel.
- Device reachability must be resolved internally from DB.
- `connector.mad4b.com` may remain a direct Cloudflare tunnel only for admin recovery and break-glass.

## Promotion blockers

Before exposing this as the default tenant/member path:

1. Add `/local/tools` and `/local/tools/call` routes on Auth.
2. Ensure `local.mad4b.com` DNS/Hostinger vhost maps to the same app as `auth.mad4b.com`.
3. Add role/tenant/entitlement checks before dispatch.
4. Add approval/hold integration for high-risk tools.
5. Ensure every call writes `local_gateway_tool_call_log`.
6. Keep `connector.mad4b.com` out of tenant-facing gateway records except admin recovery configs.
