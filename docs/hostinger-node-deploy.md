# Hostinger Node.js App Deployment

## Purpose

This runbook describes the GitHub Actions deployment path for Hostinger Node.js apps used by the platform.

The previous Hostinger hPanel mode was manual upload, such as `connector-api.zip`. The intended target state is:

```text
push to main -> GitHub Actions -> build artifact -> SSH/rsync to Hostinger app path -> install production dependencies -> restart Node app -> verify runtime
```

## Apps

| Hostname | Role | Deployment target secret |
|---|---|---|
| `auth.mad4b.com` | Platform control plane and `/connector-agent/server.mjs` distributor | `HOSTINGER_AUTH_NODE_PATH` |
| `connector.mad4b.com` | Optional Hostinger Node app mirror / legacy hPanel app. The live DNS currently points to the Cloudflare Tunnel for the local connector. | `HOSTINGER_CONNECTOR_NODE_PATH` |

`auth.mad4b.com` is the critical app for distributing the current local connector agent. The route `/connector-agent/version` verifies whether the deployed app is serving a connector agent with n8n lifecycle support.

## GitHub workflow

Workflow file:

```text
.github/workflows/deploy-hostinger-node.yml
```

Triggers:

- `push` to `main`
- manual `workflow_dispatch` with target `auth`, `connector`, or `both`

On push, both Hostinger Node app deploy jobs are eligible. If the connector Hostinger app is not used, either provide its path secret anyway or adjust the workflow target policy.

## Required GitHub secrets

Set these in GitHub repository or environment secrets.

```text
HOSTINGER_SSH_HOST
HOSTINGER_SSH_PORT
HOSTINGER_SSH_USER
HOSTINGER_SSH_PRIVATE_KEY
HOSTINGER_AUTH_NODE_PATH
HOSTINGER_CONNECTOR_NODE_PATH
BACKEND_API_KEY
```

Optional restart command secrets:

```text
HOSTINGER_AUTH_RESTART_CMD
HOSTINGER_CONNECTOR_RESTART_CMD
```

If no restart command is configured, the workflow creates or touches:

```text
tmp/restart.txt
```

This is a common Node/Passenger restart trigger. If the Hostinger Node.js runtime requires a different restart mechanism, store it in the corresponding restart command secret.

## Expected remote layout

The workflow deploys the repository root into the Node app path, excluding secrets, `.git`, `node_modules`, logs, and transient folders.

Expected runtime paths:

```text
<HOSTINGER_AUTH_NODE_PATH>/http-generic-api/server.js
<HOSTINGER_AUTH_NODE_PATH>/local-connector/server.mjs
<HOSTINGER_CONNECTOR_NODE_PATH>/http-generic-api/server.js
<HOSTINGER_CONNECTOR_NODE_PATH>/local-connector/server.mjs
```

Production dependencies are installed with:

```bash
cd <APP_PATH>/http-generic-api
npm ci --omit=dev
```

## Verification

After auth deploy, the workflow checks:

```text
https://auth.mad4b.com/health
https://auth.mad4b.com/connector-agent/version
```

The connector agent version response must include:

```json
{
  "ok": true,
  "agent": {
    "has_n8n_lifecycle": true
  }
}
```

This proves that the deployed `auth.mad4b.com` app is serving the new `local-connector/server.mjs` with n8n lifecycle support.

## Security notes

- Never commit `.env`, private keys, API tokens, or Hostinger credentials.
- Use GitHub Secrets or environment secrets only.
- Do not deploy `node_modules`; install production dependencies on the remote target.
- Keep restart commands narrow and deterministic.
- Do not use arbitrary shell or user-provided commands in the workflow.

## Rollback

Use Hostinger hPanel deployment history if needed, or rerun the workflow for a known-good commit.

Manual rollback from GitHub Actions:

1. Open the workflow run page.
2. Use `workflow_dispatch` on the known-good branch or commit ref if available.
3. Choose target `auth` or `both`.
4. Confirm `/connector-agent/version` and `/health` after deployment.
