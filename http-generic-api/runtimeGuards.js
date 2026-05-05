export function requireEnv(name, value) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function isBackendApiKeyEnabled(env) {
  return Boolean(env?.BACKEND_API_KEY);
}

export function isDebugEnabled(env) {
  return String(env?.EXECUTION_DEBUG || "").toLowerCase() === "true";
}

export function createDebugLog(env) {
  const enabled = isDebugEnabled(env);

  return function debugLog(...args) {
    if (!enabled) return;
    console.log(...args);
  };
}

export function createBackendApiKeyMiddleware(env) {
  const enabled = isBackendApiKeyEnabled(env);
  const expected = env?.BACKEND_API_KEY;

  return function requireBackendApiKey(req, res, next) {
    if (!enabled) return next();

    const auth = req.headers.authorization || req.header("Authorization") || "";
    const headerApiKey = req.headers["x-api-key"] || req.header("x-api-key") || "";
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const token = bearerToken || String(headerApiKey || "");

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "missing_backend_api_key",
          message: "Missing backend API key. Send Authorization: Bearer <BACKEND_API_KEY> or x-api-key: <BACKEND_API_KEY>.",
          status: 401
        }
      });
    }

    if (token !== expected) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "invalid_backend_api_key",
          message: "Invalid backend API key.",
          status: 403
        }
      });
    }

    return next();
  };
}
