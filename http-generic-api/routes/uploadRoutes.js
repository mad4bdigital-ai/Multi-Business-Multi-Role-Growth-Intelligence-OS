import { Router } from "express";
import { getPool } from "../db.js";
import {
  generateUploadId,
  buildMetadata,
  buildInstructions,
  uploadContentToDrive,
  deleteDriveFile,
  processUpload,
} from "../uploadPipeline.js";

const EXPIRES_DAYS = 7;
const VALID_TYPES = ["schema", "skill", "knowledge", "repo_link", "asset"];
const VALID_SOURCE_MODES = ["direct", "guided", "connector_browser", "connector_shell", "repo_fetch"];

function expiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + EXPIRES_DAYS);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function guessMimeType(filename) {
  if (!filename) return "text/plain";
  if (filename.endsWith(".yaml") || filename.endsWith(".yml")) return "text/yaml";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".pdf")) return "application/pdf";
  return "text/plain";
}

export function buildUploadRoutes(deps) {
  const router = Router();
  const { requireBackendApiKey } = deps;

  // POST /uploads — direct upload (content in body) or repo_link
  router.post("/uploads", requireBackendApiKey, async (req, res) => {
    const {
      upload_type, source_mode = "direct", content, filename,
      repo_url, metadata: rawMeta = {}, uploaded_by, user_email, tenant_id,
    } = req.body || {};

    if (!upload_type || !VALID_TYPES.includes(upload_type)) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_type", message: `upload_type must be one of: ${VALID_TYPES.join(", ")}` },
      });
    }

    const isRepoLink = upload_type === "repo_link";
    const rawContent = content || repo_url;

    if (!rawContent || typeof rawContent !== "string" || !rawContent.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_content", message: isRepoLink ? "repo_url is required" : "content is required" },
      });
    }

    try {
      const pool = getPool();
      const uploadId = generateUploadId();
      const mimeType = guessMimeType(filename);
      const meta = buildMetadata({
        ...rawMeta,
        source: { mode: source_mode, origin_url: isRepoLink ? rawContent : null, ...(rawMeta.source || {}) },
      });

      // Upload content to Drive and share with user email (writer access)
      const driveResult = await uploadContentToDrive(
        rawContent,
        filename || (isRepoLink ? "repo_link.txt" : "upload.txt"),
        mimeType,
        user_email || null
      );

      await pool.query(
        `INSERT INTO \`uploads\`
           (upload_id, upload_type, source_mode, status, filename, mime_type, size_bytes,
            drive_file_id, drive_folder_id, drive_web_url, metadata, uploaded_by, user_email, tenant_id, expires_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uploadId, upload_type, source_mode,
          filename || null, mimeType, driveResult.size_bytes,
          driveResult.drive_file_id, driveResult.drive_folder_id, driveResult.drive_web_url,
          JSON.stringify(meta), uploaded_by || null, user_email || null, tenant_id || null, expiresAt(),
        ]
      );

      const autoProcess = meta.helpers?.auto_process === true;

      if (autoProcess) {
        const [rows] = await pool.query("SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1", [uploadId]);
        try {
          await processUpload({ ...rows[0], metadata: meta });
        } catch {
          // status already set to failed inside processUpload
        }
        const [updated] = await pool.query("SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1", [uploadId]);
        return res.status(200).json({ ok: true, upload: sanitize(updated[0]) });
      }

      return res.status(200).json({
        ok: true,
        upload_id: uploadId,
        upload_type,
        status: "pending",
        drive_web_url: driveResult.drive_web_url,
        expires_at: expiresAt(),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "upload_failed", message: err.message } });
    }
  });

  // POST /uploads/prepare — guided mode: create record + return instructions
  router.post("/uploads/prepare", requireBackendApiKey, async (req, res) => {
    const { upload_type, metadata: rawMeta = {}, uploaded_by, user_email, tenant_id } = req.body || {};

    if (!upload_type || !VALID_TYPES.includes(upload_type)) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_type", message: `upload_type must be one of: ${VALID_TYPES.join(", ")}` },
      });
    }

    try {
      const pool = getPool();
      const uploadId = generateUploadId();
      const meta = buildMetadata({ ...rawMeta, source: { mode: "guided", ...(rawMeta.source || {}) } });
      const baseUrl = process.env.MAIN_API_URL || "https://api.mad4b.com";
      const instructions = buildInstructions(uploadId, upload_type, baseUrl);

      await pool.query(
        `INSERT INTO \`uploads\`
           (upload_id, upload_type, source_mode, status, metadata, instruction_set, uploaded_by, user_email, tenant_id, expires_at)
         VALUES (?, ?, 'guided', 'awaiting_upload', ?, ?, ?, ?, ?, ?)`,
        [uploadId, upload_type, JSON.stringify(meta), JSON.stringify(instructions), uploaded_by || null, user_email || null, tenant_id || null, expiresAt()]
      );

      return res.status(200).json({
        ok: true,
        upload_id: uploadId,
        upload_type,
        status: "awaiting_upload",
        instructions,
        expires_at: expiresAt(),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "prepare_failed", message: err.message } });
    }
  });

  // POST /uploads/:upload_id/content — complete a guided upload
  router.post("/uploads/:upload_id/content", requireBackendApiKey, async (req, res) => {
    const { upload_id } = req.params;
    const { content, filename } = req.body || {};

    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ ok: false, error: { code: "missing_content", message: "content is required" } });
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query(
        "SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1",
        [upload_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Upload not found" } });
      }
      if (rows[0].status !== "awaiting_upload") {
        return res.status(409).json({ ok: false, error: { code: "wrong_status", message: `Upload is in status "${rows[0].status}", expected awaiting_upload` } });
      }

      const record = rows[0];
      const mimeType = guessMimeType(filename || record.filename);
      const driveResult = await uploadContentToDrive(
        content,
        filename || record.filename || "upload.txt",
        mimeType,
        record.user_email || null
      );

      await pool.query(
        `UPDATE \`uploads\`
         SET status = 'pending', filename = COALESCE(?, filename), mime_type = ?, size_bytes = ?,
             drive_file_id = ?, drive_folder_id = ?, drive_web_url = ?, updated_at = NOW()
         WHERE upload_id = ?`,
        [filename || null, mimeType, driveResult.size_bytes,
         driveResult.drive_file_id, driveResult.drive_folder_id, driveResult.drive_web_url, upload_id]
      );

      const meta = record.metadata || {};
      const autoProcess = meta.helpers?.auto_process === true;
      if (autoProcess) {
        const [updated] = await pool.query("SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1", [upload_id]);
        try { await processUpload({ ...updated[0], metadata: meta }); } catch { /* status set inside */ }
        const [final] = await pool.query("SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1", [upload_id]);
        return res.status(200).json({ ok: true, upload: sanitize(final[0]) });
      }

      return res.status(200).json({ ok: true, upload_id, status: "pending", drive_web_url: driveResult.drive_web_url });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "content_upload_failed", message: err.message } });
    }
  });

  // GET /uploads/:upload_id — get status + metadata
  router.get("/uploads/:upload_id", requireBackendApiKey, async (req, res) => {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        "SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1",
        [req.params.upload_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Upload not found" } });
      }
      return res.status(200).json({ ok: true, upload: sanitize(rows[0]) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "db_error", message: err.message } });
    }
  });

  // PATCH /uploads/:upload_id/metadata — update metadata segments before processing
  router.patch("/uploads/:upload_id/metadata", requireBackendApiKey, async (req, res) => {
    const { goal, platform, helpers, source } = req.body || {};
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        "SELECT upload_id, status, metadata FROM `uploads` WHERE upload_id = ? LIMIT 1",
        [req.params.upload_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Upload not found" } });
      }
      if (["processed", "processing"].includes(rows[0].status)) {
        return res.status(409).json({ ok: false, error: { code: "already_processed", message: "Cannot update metadata on a processed or processing upload" } });
      }

      const current = rows[0].metadata || {};
      const merged = buildMetadata({
        goal: { ...(current.goal || {}), ...(goal || {}) },
        platform: { ...(current.platform || {}), ...(platform || {}) },
        helpers: { ...(current.helpers || {}), ...(helpers || {}) },
        source: { ...(current.source || {}), ...(source || {}) },
      });

      await pool.query(
        "UPDATE `uploads` SET metadata = ?, updated_at = NOW() WHERE upload_id = ?",
        [JSON.stringify(merged), req.params.upload_id]
      );

      return res.status(200).json({ ok: true, upload_id: req.params.upload_id, metadata: merged });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "db_error", message: err.message } });
    }
  });

  // POST /uploads/:upload_id/process — trigger processing pipeline
  router.post("/uploads/:upload_id/process", requireBackendApiKey, async (req, res) => {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        "SELECT * FROM `uploads` WHERE upload_id = ? LIMIT 1",
        [req.params.upload_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Upload not found" } });
      }
      const record = rows[0];
      if (!["pending", "failed"].includes(record.status)) {
        return res.status(409).json({ ok: false, error: { code: "wrong_status", message: `Upload status is "${record.status}" — only pending or failed uploads can be processed` } });
      }
      if (!record.drive_file_id && record.upload_type !== "repo_link") {
        return res.status(409).json({ ok: false, error: { code: "no_content", message: "Upload has no Drive file — complete the content upload first" } });
      }

      const result = await processUpload(record);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(422).json({ ok: false, error: { code: "process_failed", message: err.message } });
    }
  });

  // GET /uploads — list with filters
  router.get("/uploads", requireBackendApiKey, async (req, res) => {
    const { upload_type, status, tenant_id, uploaded_by, user_email, limit = "20", offset = "0" } = req.query;
    const pool = getPool();
    try {
      const conditions = [];
      const params = [];
      if (upload_type) { conditions.push("upload_type = ?"); params.push(upload_type); }
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (tenant_id) { conditions.push("tenant_id = ?"); params.push(tenant_id); }
      if (uploaded_by) { conditions.push("uploaded_by = ?"); params.push(uploaded_by); }
      if (user_email) { conditions.push("user_email = ?"); params.push(user_email); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(Number(limit), Number(offset));

      const [rows] = await pool.query(
        `SELECT * FROM \`uploads\` ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        params
      );
      return res.status(200).json({ ok: true, count: rows.length, uploads: rows.map(sanitize) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "db_error", message: err.message } });
    }
  });

  // DELETE /uploads/:upload_id — cancel + remove from Drive
  router.delete("/uploads/:upload_id", requireBackendApiKey, async (req, res) => {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        "SELECT upload_id, status, drive_file_id FROM `uploads` WHERE upload_id = ? LIMIT 1",
        [req.params.upload_id]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "not_found", message: "Upload not found" } });
      }
      if (rows[0].status === "processing") {
        return res.status(409).json({ ok: false, error: { code: "processing", message: "Cannot delete an upload while it is processing" } });
      }
      if (rows[0].drive_file_id) {
        await deleteDriveFile(rows[0].drive_file_id);
      }
      await pool.query("DELETE FROM `uploads` WHERE upload_id = ?", [req.params.upload_id]);
      return res.status(200).json({ ok: true, upload_id: req.params.upload_id, deleted: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "delete_failed", message: err.message } });
    }
  });

  return router;
}

// Strip internal DB fields not relevant to callers
function sanitize(row) {
  if (!row) return null;
  const { id, drive_folder_id, ...rest } = row;
  return rest;
}
