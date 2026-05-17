import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const EXPORT_ROOT = process.env.DB_BACKUP_EXPORT_ROOT || "/tmp/growth-os-db-backups";

function safeName(value = "") {
  const name = String(value || "");
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : "";
}
function tokenHash(token = "") {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function buildBackupArtifactRoutes() {
  const router = express.Router();

  router.get("/admin/backup-artifacts/export/:exportId/:fileName", async (req, res) => {
    try {
      const exportId = safeName(req.params.exportId);
      const fileName = safeName(req.params.fileName);
      const token = String(req.query.token || "");
      if (!exportId || !fileName || !token) {
        return res.status(400).json({ ok: false, error: { code: "bad_request", message: "exportId, fileName, and token are required." } });
      }
      const dir = path.resolve(EXPORT_ROOT, exportId);
      if (!dir.startsWith(path.resolve(EXPORT_ROOT))) {
        return res.status(403).json({ ok: false, error: { code: "path_not_allowed", message: "Export path is not allowed." } });
      }
      const downloadPath = path.join(dir, "download.json");
      const raw = await fs.readFile(downloadPath, "utf8");
      const meta = JSON.parse(raw);
      if (new Date(meta.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ ok: false, error: { code: "download_expired", message: "Temporary backup artifact download expired." } });
      }
      if (tokenHash(token) !== meta.token_sha256) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid temporary download token." } });
      }
      if (!Array.isArray(meta.files) || !meta.files.includes(fileName)) {
        return res.status(403).json({ ok: false, error: { code: "file_not_allowed", message: "File is not part of this export." } });
      }
      const filePath = path.join(dir, fileName);
      const st = await fs.stat(filePath);
      if (!st.isFile()) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Export file not found." } });
      }
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      return res.sendFile(filePath);
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      return res.status(status).json({ ok: false, error: { code: error?.code || "backup_artifact_download_failed", message: error?.message || "Backup artifact download failed." } });
    }
  });

  return router;
}
