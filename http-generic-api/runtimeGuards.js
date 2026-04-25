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
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing bearer token." });
    }

    const token = auth.slice("Bearer ".length);
    if (token !== expected) {
      return res.status(403).json({ error: "Invalid bearer token." });
    }

    return next();
  };
}
