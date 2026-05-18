# Local Connector Auto-Reconnect, Safe Upgrade, and Desktop Manager

Date: 2026-05-18  
Status: active design + partial implementation  
Scope: `essam-pc` canonical local connector, `local.mad4b.com` public gateway, `connector.mad4b.com` admin/break-glass path

## Purpose

The local connector must not depend on a single `server.mjs` process or a manually opened desktop app. A bad connector upgrade, a failed Node process, a stopped `cloudflared` service, or a Windows restart must not leave the platform without a recovery path.

The durable operating model is:

```text
Watchdog + Safe Upgrade = survival and automatic recovery layer
Desktop Manager = user-facing control and repair interface
```

The desktop app is useful and should be built, but it must sit above the watchdog/safe-upgrade layer, not replace it.

## Current canonical device identity

The physical Windows device was previously represented by two names:

- `mohammedlap` — manually seeded historical device id.
- `essam-pc` — reinstall/fetch-with-shell device id.

These were merged into one canonical device identity:

```text
canonical device_id: essam-pc
historical alias: mohammedlap -> essam-pc
canonical config_id: 8db63b00-4fce-11f1-b256-614c56cd019b
```

The alias registry table is:

```text
local_connector_device_aliases
```

Runtime routes now resolve aliases before device lookup in:

- `http-generic-api/routes/localGatewayToolsRoutes.js`
- `http-generic-api/routes/connectorProxyRoutes.js`

The canonical `essam-pc` row owns the recovery tunnel metadata, including `cf_token`, `cf_tunnel_id`, `cf_tunnel_name`, `connector_secret`, and `tunnel_url`.

## Public and admin surfaces

### Public tenant/member gateway

```text
https://local.mad4b.com
```

Flow:

```text
local.mad4b.com
-> Cloudflare
-> Hostinger vhost
-> PHP proxy
-> auth.mad4b.com runtime
-> /local/tools + DB policy routing
-> local connector/device tools
```

Validated behavior:

- `GET https://local.mad4b.com/health` returns healthy.
- Unauthenticated `GET /local/tools` returns `401`.
- Admin authenticated `GET /local/tools` returns all gateway tools.
- Tenant JWT `GET /local/tools` returns tenant-safe tools only and hides `local.admin.*`.
- Tenant `local.connector.health` succeeds through device-scoped credentials.

### Admin / break-glass connector

```text
https://connector.mad4b.com
```

This remains an admin/break-glass surface. It is not the tenant/member default gateway.

## Implemented DB metadata

Migration:

```text
094_sprint62e_local_connector_auto_reconnect.sql
```

Adds metadata to `local_connector_user_configs`:

- `auto_reconnect_enabled`
- `watchdog_installed`
- `watchdog_version`
- `agent_version`
- `desired_agent_version`
- `active_slot`
- `last_health_at`
- `last_reconnect_at`
- `last_repair_at`
- `last_repair_status`
- `last_error_code`
- `last_error_message`
- `recovery_notes`

Adds recovery event table:

```text
local_connector_recovery_events
```

Event types include:

- `health_ok`
- `health_failed`
- `service_restart`
- `cloudflared_restart`
- `safe_upgrade`
- `rollback`
- `repair_bundle`
- `manual_recovery`
- `watchdog_install`

## Implemented connector agent files

The connector agent release files are served by Auth via:

```text
GET /connector-agent/manifest.json
GET /connector-agent/files/:fileName
```

Current release files:

- `local-connector/server.mjs`
- `local-connector/connector-watchdog.ps1`
- `local-connector/connector-safe-upgrade.ps1`

The manifest returns:

- release version
- file URLs
- SHA256 hashes
- file sizes
- upgrade policy

Smoke test alias:

```text
connector_agent_smoke
```

Expected checks:

- manifest returns `ok: true`
- agent id is `mad4b-local-connector`
- `server.mjs` has a SHA256 hash
- watchdog and safe-upgrade files have SHA256 hashes
- downloaded `server.mjs` hash header matches manifest hash

## Safe upgrade policy

Script:

```text
local-connector/connector-safe-upgrade.ps1
```

Rules:

1. Load `https://auth.mad4b.com/connector-agent/manifest.json`.
2. Download `server.mjs` to `server.mjs.next`.
3. Verify SHA256 from manifest.
4. Run `node --check` on the candidate file.
5. Backup the active `server.mjs`.
6. Store the previous known-good file as `server.mjs.stable`.
7. Replace active `server.mjs`.
8. Restart the `local-connector` Windows service.
9. Check local health at `http://127.0.0.1:7070/health`.
10. If health fails, restore `server.mjs.stable` and restart.
11. If rollback also fails, mark manual recovery required.

Safe-upgrade must be the only mechanism allowed to replace the active connector runtime.

## Watchdog policy

Script:

```text
local-connector/connector-watchdog.ps1
```

Scheduled task:

```text
Mad4B-LocalConnector-Watchdog
```

Expected schedule:

- Runs as `SYSTEM`.
- Runs every minute.
- Uses highest run level.

Responsibilities:

1. Check `cloudflared` service.
2. Check `local-connector` service.
3. Check `http://127.0.0.1:7070/health`.
4. Restart stopped services.
5. If health remains down after restart, restore stable connector file.
6. Write diagnostics to local watchdog log.
7. Leave the system in `manual_required` only if service restart and rollback both fail.

Validated on `essam-pc` after reinstall:

```text
cloudflared = Running
local-connector = Running
local health = 200
Mad4B-LocalConnector-Watchdog = Ready
LastTaskResult = 0
```

## Installer delivery

Short-lived installer links are created by the admin tool:

```text
local_connector_installer_download_link
```

The generated download URL now uses the connector-agent surface:

```text
/connector-agent/installer.ps1?token=...
```

The older path below should be considered deprecated because it can be intercepted by protected `/local-connector/*` middleware:

```text
/local-connector/install/download?token=...
```

The installer URL is public only in the sense that it does not require a backend API key. It is still protected by a short-lived HMAC token. The token must not be stored in docs, logs, tickets, or chat transcripts.

The downloaded file should be saved on the Windows device under:

```powershell
C:\mad4b-connector\local-connector\install-local-connector-essam-pc.ps1
```

Run as Administrator:

```powershell
cd C:\mad4b-connector\local-connector
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-local-connector-essam-pc.ps1
```

The script uses its own folder as `$Root`.

## Current operational verification commands

On the Windows device:

```powershell
Get-Service cloudflared, local-connector
Invoke-WebRequest http://127.0.0.1:7070/health -UseBasicParsing
Get-ScheduledTask -TaskName Mad4B-LocalConnector-Watchdog
Get-ScheduledTaskInfo -TaskName Mad4B-LocalConnector-Watchdog
```

Expected state:

```text
cloudflared: Running
local-connector: Running
local health: 200
watchdog task: Ready
LastTaskResult: 0
```

From platform tools:

```text
connectorHealth
health_check
local_gateway_public_smoke
connector_agent_smoke
```

## Sensitive local tool gating

The public gateway enforces policies from `local_gateway_tools` before dispatch:

- `consent_required`
- `risk_label`
- `consent_text`
- `required_entitlement_key`
- `default_service_mode`
- `approval_hold_type`
- `approval_required_role`
- `approval_ttl_minutes`

Validated blocks:

- `local.connector.files` without consent -> `403 consent_required`
- `local.connector.files` with consent but no entitlement -> `403 entitlement_required`

Approval-hold flow has been implemented and partially tested. Final end-to-end dispatch for sensitive file operations depends on the connector path accepting the same auth token and tunnel URL that Auth resolves from DB.

## Known current follow-up

After reinstall, the local Windows services and watchdog are healthy. If Auth-to-device calls fail while direct `/health` works, check these in order:

1. DB `local_connector_user_configs.tunnel_url` points to the active tunnel or break-glass host.
2. DB `connector_secret` matches the `BACKEND_API_KEY` written in `C:\mad4b-connector\local-connector\.env`.
3. Auth proxy fallback tokens include both per-device `connector_secret` and platform `BACKEND_API_KEY`.
4. The connector endpoint being called exists in the installed `server.mjs` version.
5. `cloudflared` tunnel status is healthy in Cloudflare.

Avoid manual replacement of `server.mjs`. Use `connector-safe-upgrade.ps1` or the installer.

## Desktop Manager plan

A lightweight Windows desktop/tray app should still be built, but it must act as a UI/controller over the recovery layer.

Recommended responsibilities:

- Show connector status.
- Show Cloudflared status.
- Show Auth gateway status.
- Display device id and canonical alias mapping.
- Button: reconnect.
- Button: repair.
- Button: check for updates.
- Button: install/reinstall watchdog.
- Button: view logs.
- Button: run safe upgrade.

The Desktop Manager must not replace `server.mjs` directly. It should call:

```powershell
connector-safe-upgrade.ps1
```

for upgrades, and should call watchdog/service operations for repair.

## Do not repeat these failure modes

1. Do not create duplicate physical device rows under new names. Use `local_connector_device_aliases`.
2. Do not place public installer downloads under `/local-connector/*`, because middleware may require `BACKEND_API_KEY` before token validation.
3. Do not import installer helpers from `localConnectorInstallRoutes.js` into `connectorAgentRoutes.js` if it creates circular route imports. Keep installer serving standalone or move shared helpers into a neutral utility module.
4. Do not replace `server.mjs` directly on a live device. Use safe-upgrade and rollback.
5. Do not expose installer tokens or generated scripts in chat/logs/docs.

## Next implementation steps

1. Finalize `/connector-agent/installer.ps1` as the canonical token-gated installer surface.
2. Add a small regression smoke test for token-gated installer route that checks status/headers without printing installer content.
3. Update `local_connector_user_configs.watchdog_installed`, `watchdog_version`, and `agent_version` after successful install or heartbeat.
4. Log watchdog/repair events from local agent back to Auth when online.
5. Complete the sensitive approval end-to-end smoke after Auth-to-device token/tunnel alignment is verified.
6. Build the Desktop Manager as a tray app/bootstrapper on top of watchdog and safe-upgrade.
