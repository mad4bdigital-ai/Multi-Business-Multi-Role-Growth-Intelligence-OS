import { Router } from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "../db.js";
import {
  verifyInstallerDownloadToken,
  buildInstallPowerShell,
  DEFAULT_WINDOWS_ALIASES,
  CONNECTOR_PORT,
} from "./localConnectorInstallRoutes.js";
import { getPool } from "../db.js";
import {
  verifyInstallerDownloadToken,
  buildInstallPowerShell,
  DEFAULT_WINDOWS_ALIASES,
  CONNECTOR_PORT,
} from "./localConnectorInstallRoutes.js";

const AGENT_VERSION = "2026.05.18.1";
const ROOT = process.cwd();

const FILES = {
  "server.mjs": {
    relativePath: "local-connector/server.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "connector-watchdog.ps1": {
    relativePath: "local-connector/connector-watchdog.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
  "connector-safe-upgrade.ps1": {
    relativePath: "local-connector/connector-safe-upgrade.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "auth.mad4b.com").split(",")[0].trim();
  return `${proto}://${host}`;
}

async function loadAgentFile(fileName) {
  const meta = FILES[fileName];
  if (!meta) return null;
  const fullPath = path.resolve(ROOT, meta.relativePath);
  const buffer = await readFile(fullPath);
  return { ...meta, fileName, fullPath, buffer, size: buffer.length, sha256: sha256(buffer) };
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  router.get("/connector-agent/manifest.json", async (req, res) => {
    try {
      const base = publicBaseUrl(req);
      const files = {};
      for (const fileName of Object.keys(FILES)) {
        const loaded = await loadAgentFile(fileName);
        files[fileName] = {
          url: `${base}/connector-agent/files/${encodeURIComponent(fileName)}`,
          sha256: loaded.sha256,
          size: loaded.size,
          content_type: loaded.contentType,
          executable: loaded.executable,
        };
      }

      return res.status(200).json({
        ok: true,
        agent: "mad4b-local-connector",
        version: AGENT_VERSION,
        release_channel: "stable",
        minimum_watchdog_version: "2026.05.18.1",
        generated_at: new Date().toISOString(),
        files,
        upgrade_policy: {
          verify_sha256: true,
          node_check_required: true,
          backup_before_replace: true,
          health_check_required: true,
          rollback_on_failed_health: true,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_manifest_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/installer.ps1", async (req, res) => {
    try {
      const payload = verifyInstallerDownloadToken(req.query.token);
      if (payload.format !== "ps1") {
        return res.status(400).json({ ok: false, error: { code: "unsupported_format", message: "Only ps1 installer downloads are supported." } });
      }
      const [[config]] = await getPool().query(
        "SELECT config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, cf_token FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",
        [payload.user_id, payload.device_id]
      );
      if (!config) {
        return res.status(404).json({ ok: false, error: { code: "connector_config_not_found", message: "No active connector config was found for this download token." } });
      }
      if (!config.cf_token || !config.connector_secret) {
        return res.status(409).json({ ok: false, error: { code: "connector_config_incomplete", message: "Connector config is missing recovery token or connector secret." } });
      }
      const installer = buildInstallPowerShell({
        cfToken: config.cf_token,
        connectorSecret: config.connector_secret,
        tunnelUrl: config.tunnel_url,
        aliases: DEFAULT_WINDOWS_ALIASES,
        port: CONNECTOR_PORT,
      });
      const filename = `install-local-connector-${String(config.device_id).replace(/[^a-zA-Z0-9_-]+/g, "-")}.ps1`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      return res.status(200).send(installer);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "connector_agent_installer_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/files/:fileName", async (req, res) => {
    try {
      const requested = String(req.params.fileName || "").trim();
      if (!FILES[requested]) {
        return res.status(404).json({ ok: false, error: { code: "connector_agent_file_not_found", message: "Unknown connector agent file." } });
      }
      const loaded = await loadAgentFile(requested);
      res.setHeader("Content-Type", loaded.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Mad4B-Agent-Version", AGENT_VERSION);
      res.setHeader("X-Mad4B-SHA256", loaded.sha256);
      return res.status(200).send(loaded.buffer);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_file_failed", message: err.message } });
    }
  });

  return router;
}
