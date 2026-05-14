import { Router } from "express";
import { getPool } from "../db.js";

async function resolveDeviceTunnel(userId, deviceId) {
  const [rows] = await getPool().query(
    `SELECT tunnel_url, connector_secret
       FROM \`local_connector_user_configs\`
      WHERE user_id = ? AND device_id = ? AND is_enabled = 1
      LIMIT 1`,
    [userId, deviceId]
  );
  return rows[0] || null;
}

async function proxyToDevice(req, res, deviceId, targetPath) {
  const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
  const userId = isUserAuth ? req.auth.user_id : null;
  if (!userId) {
    return res.status(401).json({ ok: false, error: { code: "user_identity_required", message: "Sign-in required to access device." } });
  }

  const device = await resolveDeviceTunnel(userId, deviceId);
  if (!device) {
    return res.status(404).json({ ok: false, error: { code: "device_not_found", message: `No active connector found for device '${deviceId}'.` } });
  }
  if (!device.tunnel_url) {
    return res.status(503).json({ ok: false, error: { code: "tunnel_not_provisioned", message: "Device tunnel is not provisioned yet. Run /local-connector/install first." } });
  }

  const queryString = Object.keys(req.query).length
    ? "?" + new URLSearchParams(req.query).toString()
    : "";
  const url = `${device.tunnel_url}${targetPath}${queryString}`;

  const options = {
    method: req.method,
    headers: {
      "Authorization": `Bearer ${device.connector_secret}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  };

  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length) {
    options.body = JSON.stringify(req.body);
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return res.status(response.status).json(data);
}

export function buildConnectorProxyRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── GET /connector/:device_id/policy ─────────────────────────────────────
  router.get("/connector/:device_id/policy", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/policy");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── GET /connector/:device_id/health ──────────────────────────────────────
  router.get("/connector/:device_id/health", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/health");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/shell ──────────────────────────────────────
  router.post("/connector/:device_id/shell", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/shell");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/files ──────────────────────────────────────
  router.post("/connector/:device_id/files", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/files");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  // ── POST /connector/:device_id/fetch-upload ───────────────────────────────
  router.post("/connector/:device_id/fetch-upload", requireBackendApiKey, async (req, res) => {
    try {
      await proxyToDevice(req, res, req.params.device_id, "/fetch-upload");
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: "proxy_failed", message: err.message } });
    }
  });

  return router;
}
