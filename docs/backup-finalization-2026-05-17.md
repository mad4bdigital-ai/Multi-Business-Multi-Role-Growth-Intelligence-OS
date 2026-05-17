# Backup & Disaster Recovery Finalization — 2026-05-17

## Final status

Completed local DR baseline:

```text
Code backup = succeeded
Database backup = succeeded
n8n local backup = succeeded
Local connector runtime backup = succeeded
Restore validations = passed
Local destination = D:\\Nagy\\Growth-0s-Backups
```

## Completed points

### 1. Recovery key protection

Local recovery keys are stored under:

```text
D:\\Nagy\\Growth-0s-Backups\\keys
```

ACL hardening was applied on the keys folder:

```text
inheritance disabled
SYSTEM = FullControl
BUILTIN\\Administrators = FullControl
```

Marker:

```text
D:\\Nagy\\Growth-0s-Backups\\keys\\.keys-protection.json
```

### 2. Off-device plan

Created local manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\off-device-transfer-plan-2026-05-17.json
```

Status:

```text
pending_destination
```

Allowed payload:

```text
encrypted artifacts + manifests only
```

Recovery keys must be stored in a separate secure vault or separate access boundary.

### 3. Retention policy

Created local manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-retention-policy-2026-05-17.json
```

Rules:

```text
code: keep_last=7, keep_days=30
database: keep_last=14, keep_days=30
n8n_local: keep_last=14, keep_days=30
local_connector: keep_last=7, keep_days=30
```

Deletion requires dry-run and explicit approval. Never delete the last restore-passed artifact of any kind.

### 4. Automation plan

Created local manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-automation-plan-2026-05-17.json
```

Automation status:

```text
planned_not_scheduled
```

Reason: off-device destination and key escrow are not finalized.

### 5. Restore validation

Completed validations:

```text
code: ZIP extraction + marker validation
DB: decrypt + gunzip + SQL structure validation; plaintext SQL removed
n8n: decrypt + ZIP structure validation; plaintext ZIP removed
local connector: decrypt + ZIP structure validation; plaintext ZIP removed
```

Full isolated DB import and isolated n8n boot remain recommended before declaring full disaster-recovery readiness.

### 6. n8n consistency

n8n data path backed up:

```text
D:\\n8n-data
```

Included markers:

```text
.n8n/database.sqlite
.n8n/database.sqlite-wal
.n8n/config
.n8n/nodes
.n8n/storage
```

n8n backup artifact is encrypted with AES-256-GCM.

### 7. Local connector backup

Local connector runtime backed up:

```text
source = C:\\mad4b-connector
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-local-connector-2026-05-17T18-48-34-422Z.zip.aes256gcm
checksum_sha256 = 1d3a0a41c77686ff77be358ea6097d1f44a6fb120a557633aa660e7c877747f2
restore_status = passed
```

### 8. Runtime manifest

Created local manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\runtime-manifest-2026-05-17.json
```

Captured without secrets:

```text
api_base_url = https://auth.mad4b.com
connector_url = https://connector.mad4b.com
service = http_generic_api_connector
version = 2.6.0-governed-context-resolution
db_connected = true
release_readiness = pass
```

### 9. Cloudflare / DNS manifest

Created local manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\dns-cloudflare-manifest-2026-05-17.json
```

Status:

```text
blocked_pending_authenticated_cloudflare_export
```

Observed blockers:

```text
connector_cf:list_dns -> not_configured
auth:listDnsRecords -> unauthenticated
```

### 10. Temporary DB export cleanup

Script:

```text
http-generic-api/scripts/db-backup-export-cleanup.mjs
```

Alias:

```text
db_backup_export_cleanup
```

The temporary download route is token-gated and expiration-aware. Cleanup removes server-side temporary export directories after artifacts are transferred locally.

### 11. Canonicals/OpenAPI/admin schema sync

Admin shell aliases were documented in admin_control schema descriptions. Backup/DR documents and migrations were committed to the repo.

### 12. Disaster recovery runbook

Created:

```text
docs/platform-disaster-recovery-runbook.md
```

## Backup runbooks

```text
docs/backup-run-2026-05-17-code-main.md
docs/backup-run-2026-05-17-db-primary.md
docs/backup-run-2026-05-17-n8n-local.md
```

## Off-device Google Drive upload

Status:

```text
succeeded
```

Destination:

```text
parent_folder_id = 1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG
root_folder = Growth-OS-Backups-Offsite
subfolders = artifacts, manifests, keys
```

Uploaded:

```text
artifacts = 4
manifests = 10
keys = 3
total_files = 17
```

Registry:

```text
platform_copy_locations.location_key = google-drive:growth-os-backups-offsite
offsite_drive_upload_sessions.session_id = offsite-491d395be917479d908634997e1de4d4
```

Final manifest:

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\off-device-google-drive-upload-2026-05-17.json
Drive file id = 1WMjzzPovPPgZliI6syBQvI6-JuVOVM9-
```

## Cloudflare / DNS export

Status:

```text
succeeded
```

Summary:

```text
connection_id = 687504ba-0e1e-4c70-b21f-abc00e2e9cd4
zone_name = mad4b.com
zone_id = 2e03311efd38d148302f3a85ca5c831e
dns_record_count = 15
tunnel_count = 3
auth.mad4b.com records = 1
connector.mad4b.com records = 1
n8n.mad4b.com records = 1
server_manifest_path = /tmp/growth-os-cloudflare-manifests/cloudflare-dns-manifest-2026-05-17.json
local_manifest_path = D:\\Nagy\\Growth-0s-Backups\\manifests\\cloudflare-dns-manifest-2026-05-17.json
drive_manifest_file_id = 1dF6cMcwh4Sy2ebVatGJqTYReBjfJbkbU
manifest_sha256 = 2db10b875123f964b40fc4dc7657cfb1c1bb1d2a4da26ceb0f6d2c6d744f1c93
```

Registry:

```text
platform_copy_locations.location_key = cloudflare:mad4b.com:dns-and-tunnels
user_app_connections.validation_status = validated
```

Security:

```text
Cloudflare token is stored encrypted.
TXT record content is redacted in the manifest.
No secrets are included in the DNS/tunnel manifest.
```

## Current blockers that require external decision/access

```text
1. Automation remains intentionally disabled until final retention schedule is approved.
2. Full DB import into isolated MySQL and isolated n8n boot test remain recommended for formal DR certification.
```

## Final baseline conclusion

The platform now has a verified local backup baseline for code, DB, n8n, and connector runtime, an off-device Google Drive copy of artifacts/manifests/keys, and a validated Cloudflare DNS/tunnel export. It is suitable for local recovery and off-device artifact recovery. Full DR certification still requires isolated DB import and isolated n8n boot tests.
