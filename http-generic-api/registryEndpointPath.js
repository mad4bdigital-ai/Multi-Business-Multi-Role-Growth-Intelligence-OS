export function normalizeEndpointPathForLookup(rawPath = "") {
  let normalized = String(rawPath || "").trim().toLowerCase();
  try {
    const url = new URL(normalized.startsWith("http") ? normalized : `https://placeholder.local${normalized}`);
    normalized = url.pathname;
  } catch {
    normalized = normalized.replace(/^https?:\/\/[^/]+/, "");
  }
  normalized = normalized
    .replace(/^\/wp-json/, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");
  return normalized || "/";
}

export function findEndpointRowsByPath(rows = [], path = "") {
  const normalizedSearch = normalizeEndpointPathForLookup(path);
  return rows.filter(row => {
    const rowPath = normalizeEndpointPathForLookup(
      String(row.endpoint_path_or_function || "").trim()
    );
    return rowPath === normalizedSearch;
  });
}

export function buildEndpointPathSearchReport(rows = [], path = "") {
  const matches = findEndpointRowsByPath(rows, path);
  return {
    searched_path: path,
    normalized_path: normalizeEndpointPathForLookup(path),
    match_count: matches.length,
    matches: matches.map(row => ({
      endpoint_key: String(row.endpoint_key || "").trim(),
      parent_action_key: String(row.parent_action_key || "").trim(),
      endpoint_path_or_function: String(row.endpoint_path_or_function || "").trim(),
      status: String(row.status || "").trim(),
      execution_readiness: String(row.execution_readiness || "").trim()
    }))
  };
}

export function requireEndpointPathColumnSearchBeforeAdd(rows = [], path = "") {
  const report = buildEndpointPathSearchReport(rows, path);
  if (report.match_count > 0) {
    const err = new Error(
      `Endpoint path already exists in registry: ${path} (normalized: ${report.normalized_path}). ` +
      `Found ${report.match_count} existing row(s). Search before adding to avoid duplicates.`
    );
    err.code = "endpoint_path_already_exists";
    err.status = 409;
    err.details = report;
    throw err;
  }
  return report;
}
