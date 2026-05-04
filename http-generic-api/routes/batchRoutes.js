import { Router } from "express";

const MAX_REQUESTS    = 50;
const SUB_TIMEOUT_MS  = 30_000;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

export function buildBatchRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  /**
   * POST /batch
   *
   * Execute multiple API calls in a single HTTP request.
   *
   * Body:
   *   {
   *     requests: [
   *       { method: "POST", path: "/contacts", body: {...} },
   *       { method: "GET",  path: "/tenants/t1/entitlements" },
   *       { method: "PATCH", path: "/tickets/t1/status", body: { status: "resolved" } }
   *     ],
   *     parallel: true          // default true; set false for strict ordering
   *   }
   *
   * Response:
   *   {
   *     ok: true,
   *     count: 3,
   *     results: [
   *       { index: 0, status: 201, ok: true,  body: { ok: true, contact_id: "..." } },
   *       { index: 1, status: 200, ok: true,  body: { ok: true, entitlements: [...] } },
   *       { index: 2, status: 400, ok: false, body: { ok: false, error: {...} } }
   *     ]
   *   }
   *
   * Limits:
   *   - Max 50 sub-requests per batch call
   *   - Sub-request paths must start with /
   *   - Calling /batch from within a batch is blocked (loop prevention)
   *   - Each sub-request inherits the batch call's authentication
   *   - Per sub-request timeout: 30 s
   */
  router.post("/batch", requireBackendApiKey, async (req, res) => {
    const { requests, parallel = true } = req.body || {};

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_requests", message: "requests array is required and must be non-empty." },
      });
    }

    if (requests.length > MAX_REQUESTS) {
      return res.status(400).json({
        ok: false,
        error: { code: "batch_too_large", message: `Maximum ${MAX_REQUESTS} requests per batch. Got ${requests.length}.` },
      });
    }

    // Validate each sub-request structure up front
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i];
      const method = String(r?.method || "").toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_method", message: `requests[${i}].method must be one of: ${[...ALLOWED_METHODS].join(", ")}` },
        });
      }
      if (!r?.path || !String(r.path).startsWith("/")) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_path", message: `requests[${i}].path must be a string starting with /` },
        });
      }
      if (String(r.path).startsWith("/batch")) {
        return res.status(400).json({
          ok: false,
          error: { code: "batch_loop", message: `requests[${i}]: calling /batch from within a batch is not allowed.` },
        });
      }
    }

    // Forward auth header to each sub-request
    const authHeader   = req.headers["authorization"] || req.headers["x-api-key"] || "";
    const apiKeyHeader = req.headers["x-api-key"]    || "";
    const port         = req.socket.localPort;
    const baseUrl      = `http://127.0.0.1:${port}`;

    async function executeOne(item, index) {
      const method  = item.method.toUpperCase();
      const url     = `${baseUrl}${item.path}`;
      const hasBody = method !== "GET" && method !== "DELETE" && item.body !== undefined;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SUB_TIMEOUT_MS);

      try {
        const fetchRes = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(authHeader   ? { authorization: authHeader }  : {}),
            ...(apiKeyHeader ? { "x-api-key": apiKeyHeader } : {}),
            "x-batch-request": "1",
          },
          ...(hasBody ? { body: JSON.stringify(item.body) } : {}),
        });

        clearTimeout(timer);
        const body = await fetchRes.json().catch(() => ({}));
        return { index, status: fetchRes.status, ok: fetchRes.status < 300, body };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
          return { index, status: 504, ok: false, body: { ok: false, error: { code: "sub_request_timeout", message: `Request timed out after ${SUB_TIMEOUT_MS / 1000}s` } } };
        }
        return { index, status: 500, ok: false, body: { ok: false, error: { code: "sub_request_failed", message: err.message } } };
      }
    }

    let results;
    if (parallel) {
      results = await Promise.all(requests.map((item, i) => executeOne(item, i)));
    } else {
      results = [];
      for (let i = 0; i < requests.length; i++) {
        results.push(await executeOne(requests[i], i));
      }
    }

    const allOk = results.every(r => r.ok);
    return res.status(200).json({
      ok: allOk,
      count: results.length,
      results,
    });
  });

  return router;
}
