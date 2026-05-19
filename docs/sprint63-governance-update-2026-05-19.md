# Sprint 63 Governance Update — 2026-05-19

## Status

Sprint 63 converted several runtime and recovery surfaces from ad-hoc/manual checks into governed read-only status APIs, smoke tests, and local connector probe aliases.

This document is the canonical Sprint 63 delta. It supplements:

- `docs/platform-recomposition/local-connector-autoreconnect-and-desktop-manager-2026-05-18.md`
- `docs/platform-disaster-recovery-runbook.md`
- `docs/backup-and-copy-governance.md`

## Merged runtime changes

| Area | PR | Runtime evidence |
|---|---:|---|
| Local Manager beta read-only UI/status | #17, #18 | `/local-manager/beta` returns 200 HTML; `/local-manager/beta/status` is admin-protected and redacted |
| Deployment evidence hardening | #19 | `/deployment-info` exposes `commit_sha`, `commit_source`, `deployed_at`, `deployed_at_source`, and `evidence` without absolute manifest paths |
| Route selector runtime smoke | #20 | `smoke:route-selector` passed and classifies missing LAN/VPN/direct/dynamic routes as not provisioned |
| Installer/reprovision status polish | #21, #22 | `smoke:installer-reprovision` passed; invalid installer token reaches token validation |
| GitHub tooling schema contracts | #23, #24 | `smoke:github-tooling-schema` passed after DB pool close fix |
| DB restore certifier probe alias | #25 | Connector agent manifest serves `db-restore-certifier.mjs`; installer includes `db_restore_certify_probe` |
| n8n restore certifier probe alias | #26 | Connector agent manifest serves `n8n-restore-certifier.mjs`; installer includes `n8n_restore_certify_probe` |

## Local Manager beta policy

Live routes:

```text
GET /local-manager/beta
GET /local-manager/beta/status
```

Rules:

- `/local-manager/beta` is a public read-only UI shell.
- `/local-manager/beta/status` requires backend admin auth.
- Status responses must return `read_only=true` and `secrets_included=false`.
- Repair execution is intentionally disabled in beta and is reported as `read_only_beta`.
- The beta route must mount before protected root-level local connector routers.

Do not add repair execution to this surface until consent, entitlement, and admin approval checks are implemented end-to-end.

## Deployment evidence policy

`/deployment-info` is the live deployment evidence endpoint. It must not expose secrets or absolute internal manifest paths.

Required fields:

```text
commit_sha
commit_source
deployed_at
deployed_at_source
evidence.secrets_included = false
```

Detached HEAD on Hostinger is acceptable when `commit_sha` and `deployed_at` are available.

## Route selector policy

Supported route types:

```text
vpn_private_ip
lan_private_ip
direct_public_ip
dynamic_public_ip
cloudflare_tunnel
admin_recovery
```

Default priority order:

```text
10 vpn_private_ip
20 lan_private_ip
30 direct_public_ip
40 dynamic_public_ip
50 cloudflare_tunnel
90 admin_recovery
```

`smoke:route-selector` is dry-run only. It verifies status/read-only evidence, known route type classification, route priority policy, connector proxy health dispatch, selected route evidence, and redacted route attempts.

Missing optional LAN/VPN/direct/dynamic routes must be classified as `not provisioned`, not as runtime failures.

## Installer/reprovision policy

`GET /local-connector/install/status` must be sanitized and read-only. It must not return:

```text
connector_secret
cf_token
signed download URLs
installer bodies
command_template
```

`smoke:installer-reprovision` is dry-run only and verifies:

- unauthenticated status is rejected
- missing `device_id` is rejected
- valid status is read-only and non-secret
- invalid installer token returns `invalid_download_token`
- empty install body is rejected before provisioning side effects

Installer/token-gated routes must mount before protected local connector catch-all routers.

## GitHub tooling schema policy

`smoke:github-tooling-schema` validates the DB registry and admin-only tool exports for GitHub operations.

Covered contracts include:

- pull request list uses array response schema
- pull request creation accepts `201 Created`
- merge PR export retains expected-head-sha policy notes
- update-branch and GraphQL tools are exported as admin-only
- repo/environment secret-name listing tools are read-only and never return secret values
- workflow-specific run listing and Git tree reads are covered

The smoke is non-mutating and must close the DB pool with `await pool.end()` so admin shell calls do not hang behind Cloudflare.

## DR certifier alias policy

The connector agent manifest now includes:

```text
db-restore-certifier.mjs
n8n-restore-certifier.mjs
```

Installer allowlist aliases:

```text
db_restore_certify_probe
n8n_restore_certify_probe
```

Probe mode rules:

- read-only only
- no broad PowerShell or Windows control required
- recovery-key file presence may be checked, but key contents must not be read or printed
- no full DB import in DB probe mode
- no isolated n8n boot in n8n probe mode
- return `writes_attempted=false` and `secrets_included=false`

As of this update, `auth.mad4b.com` serves both files and installers include both aliases. The installed `essam-pc` runtime still needs safe-upgrade/reinstall before the aliases appear on-device.

## Backup automation state

Backup schedule automation was not enabled in Sprint 63.

Reason:

- The task explicitly requires admin approval.
- No scheduler table exists yet; policies currently use `mode` and `frequency_cron` only.
- DB policy dry-run is blocked by `database_executor_must_be_local_connector_or_explicitly_changed`.
- Failure-notification target and retention deletion approval flow are not yet finalized.

Dry-run readiness:

```text
policy:platform-code-main:snapshot-draft -> ready
policy:local-n8n-data:manual -> ready
policy:local-connector-runtime:manual -> ready
policy:platform-db-primary:manual-draft -> blocked by DB executor decision
```

No backup schedule should be enabled until an admin explicitly approves exact cron values, notification target, retention dry-run flow, and DB executor policy.

## Current blocked follow-ups

```text
dr-certification:isolated-db-import-test -> blocked until essam-pc runs updated connector installer/safe-upgrade
dr-certification:isolated-n8n-boot-test -> blocked until essam-pc runs updated connector installer/safe-upgrade
backup-automation:enable-schedules -> blocked pending explicit admin approval and DB executor decision
```

## Required operator action

Run the updated local connector installer or safe upgrade on `essam-pc`, then verify:

```text
connector_shell list includes db_restore_certify_probe
connector_shell list includes n8n_restore_certify_probe
```

Only after this verification should DB import or isolated n8n boot certification continue.
