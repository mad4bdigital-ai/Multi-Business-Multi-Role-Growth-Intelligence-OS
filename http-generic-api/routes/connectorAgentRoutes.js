import { Router } from "express";
import { readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(__dirname, "../../local-connector/server.mjs");
const EXPORT_ROOT = process.env.DB_BACKUP_EXPORT_ROOT || "/tmp/growth-os-db-backups";

function safeName(value = "") {
  const name = String(value || "");
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : "";
}
function tokenHash(token = "") {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function getAgentSource() {
  return readFileSync(AGENT_PATH, "utf8");
}

function getAgentMeta() {
  const src = getAgentSource();
  const stat = statSync(AGENT_PATH);
  return {
    path: AGENT_PATH,
    bytes: Buffer.byteLength(src, "utf8"),
    sha256: createHash("sha256").update(src).digest("hex"),
    modified_at: stat.mtime.toISOString(),
    has_n8n_lifecycle: src.includes("handleN8nV2") && src.includes("N8N_COMMAND"),
  };
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  // Public — no auth. Returns current connector agent script for self-install.
  router.get("/connector-agent/server.mjs", (_req, res) => {
    try {
      const src = getAgentSource();
      const meta = getAgentMeta();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="server.mjs"');
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("ETag", `"${meta.sha256}"`);
      res.setHeader("X-Connector-Agent-Sha256", meta.sha256);
      res.setHeader("X-Connector-Agent-Has-N8n-Lifecycle", String(meta.has_n8n_lifecycle));
      return res.status(200).send(src);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  router.get("/connector-agent/backup-artifacts/export/:exportId/:fileName", (req, res) => {
    try {
      const exportId = safeName(req.params.exportId);
      const fileName = safeName(req.params.fileName);
      const token = String(req.query.token || "");
      if (!exportId || !fileName || !token) {
        return res.status(400).json({ ok: false, error: { code: "bad_request", message: "exportId, fileName, and token are required." } });
      }
      const dir = resolve(EXPORT_ROOT, exportId);
      if (!dir.startsWith(resolve(EXPORT_ROOT))) {
        return res.status(403).json({ ok: false, error: { code: "path_not_allowed", message: "Export path is not allowed." } });
      }
      const meta = JSON.parse(readFileSync(resolve(dir, "download.json"), "utf8"));
      if (new Date(meta.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ ok: false, error: { code: "download_expired", message: "Temporary backup artifact download expired." } });
      }
      if (tokenHash(token) !== meta.token_sha256) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid temporary download token." } });
      }
      if (!Array.isArray(meta.files) || !meta.files.includes(fileName)) {
        return res.status(403).json({ ok: false, error: { code: "file_not_allowed", message: "File is not part of this export." } });
      }
      const filePath = resolve(dir, fileName);
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Export file not found." } });
      }
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      return res.sendFile(filePath);
    } catch (err) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      return res.status(status).json({ ok: false, error: { code: err?.code || "backup_artifact_download_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/backup-artifacts/export/:exportId/:fileName", (req, res) => {
    try {
      const exportId = safeName(req.params.exportId);
      const fileName = safeName(req.params.fileName);
      const token = String(req.query.token || "");
      if (!exportId || !fileName || !token) {
        return res.status(400).json({ ok: false, error: { code: "bad_request", message: "exportId, fileName, and token are required." } });
      }
      const dir = resolve(EXPORT_ROOT, exportId);
      if (!dir.startsWith(resolve(EXPORT_ROOT))) {
        return res.status(403).json({ ok: false, error: { code: "path_not_allowed", message: "Export path is not allowed." } });
      }
      const meta = JSON.parse(readFileSync(resolve(dir, "download.json"), "utf8"));
      if (new Date(meta.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ ok: false, error: { code: "download_expired", message: "Temporary backup artifact download expired." } });
      }
      if (tokenHash(token) !== meta.token_sha256) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid temporary download token." } });
      }
      if (!Array.isArray(meta.files) || !meta.files.includes(fileName)) {
        return res.status(403).json({ ok: false, error: { code: "file_not_allowed", message: "File is not part of this export." } });
      }
      const filePath = resolve(dir, fileName);
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Export file not found." } });
      }
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      return res.sendFile(filePath);
    } catch (err) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      return res.status(status).json({ ok: false, error: { code: err?.code || "backup_artifact_download_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/version", (_req, res) => {
    try {
      return res.status(200).json({ ok: true, agent: getAgentMeta() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  return router;
}
