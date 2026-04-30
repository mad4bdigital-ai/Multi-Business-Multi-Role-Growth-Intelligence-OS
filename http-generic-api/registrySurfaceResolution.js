export const REGISTRY_WORKBOOK_ID = "1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o";
const REGISTRY_SURFACE_PREFIX = "surface.";
export const GOOGLE_SHEETS_PARENT_ACTION_KEY = "google_sheets_api";

const REGISTRY_MUTATION_ENDPOINTS = new Set([
  "updateSheetValues",
  "batchUpdateSheetValues",
  "appendSheetValues",
  "clearSheetValues",
  "batchUpdateSpreadsheet"
]);

const REGISTRY_READ_ENDPOINTS = new Set([
  "getSheetValues",
  "getSpreadsheet"
]);

function extractSpreadsheetId(requestPayload = {}) {
  return (
    requestPayload.path_params?.spreadsheetId ??
    (requestPayload.body && typeof requestPayload.body === "object"
      ? requestPayload.body.spreadsheetId
      : undefined) ??
    requestPayload.query?.spreadsheetId ??
    null
  );
}

export function isRegistrySurfaceTargetKey(targetKey = "") {
  return String(targetKey || "").startsWith(REGISTRY_SURFACE_PREFIX);
}

export function isGoogleSheetsRegistryRequest({ parentActionKey, endpointKey, requestPayload = {} } = {}) {
  if (parentActionKey !== GOOGLE_SHEETS_PARENT_ACTION_KEY) return false;
  if (!isRegistrySurfaceTargetKey(requestPayload.target_key)) return false;
  const spreadsheetId = extractSpreadsheetId(requestPayload);
  if (spreadsheetId !== REGISTRY_WORKBOOK_ID) return false;
  return REGISTRY_MUTATION_ENDPOINTS.has(endpointKey) || REGISTRY_READ_ENDPOINTS.has(endpointKey);
}

export function inferRegistryWritebackScope(targetKey = "") {
  switch (String(targetKey || "")) {
    case "surface.validation_and_repair_registry_sheet": return "validation_registry";
    case "surface.endpoint_registry_sheet": return "endpoint_registry";
    case "surface.actions_registry_sheet": return "actions_registry";
    case "surface.registry_surfaces_catalog_sheet": return "registry_surfaces";
    case "surface.execution_bindings_sheet": return "execution_bindings";
    case "surface.workflow_registry_sheet": return "workflow_registry";
    case "surface.task_routes_sheet": return "task_routes";
    case "surface.execution_policy_registry_sheet": return "execution_policy_registry";
    case "surface.repair_mapping_registry_sheet": return "repair_mapping_registry";
    default: return "registry_surface";
  }
}

export function resolveRegistrySurfaceTarget({ targetKey, endpointKey } = {}) {
  if (!isRegistrySurfaceTargetKey(targetKey)) {
    const err = new Error(
      "Registry workbook Sheets execution requires a surface.* target_key."
    );
    err.code = "registry_surface_target_required";
    err.status = 403;
    err.details = { target_key: targetKey ?? null, endpoint_key: endpointKey };
    throw err;
  }

  return {
    // Brand-compatible shape so downstream auth + provider resolution work unchanged
    target_key: targetKey,
    brand_name: "",
    normalized_brand_name: "",
    brand_domain: "",
    base_url: "https://sheets.googleapis.com",
    auth_type: "",           // empty → inferAuthMode defers to action.oauth_config_file_id → oauth_gpt_action
    write_allowed: "TRUE",
    destructive_allowed: "FALSE",
    transport_enabled: "TRUE",
    transport_action_key: "http_generic_api",
    default_headers_json: null,  // prevents brand credential headers from leaking
    username: "",
    application_password: "",
    site_aliases_json: null,
    hosting_provider: "",
    hosting_account_key: "",
    // Registry surface marker fields — not consumed by existing auth/provider logic
    resolution_mode: "registry_surface",
    registry_surface_auth_mode: "bearer_token",
    credential_resolution: "google_oauth_registry_surface",
    brand_scope_required: false,
    brand_target_override_allowed: false,
    wordpress_target_allowed: false,
    writeback_scope: inferRegistryWritebackScope(targetKey),
    governance_notes:
      "Registry workbook request resolved as registry_surface. Brand Registry target resolution is intentionally bypassed."
  };
}

export function assertRegistrySurfaceTargetAllowed(brand = {}) {
  if (!brand || brand.resolution_mode !== "registry_surface") return;

  if (brand.registry_surface_auth_mode !== "bearer_token") {
    const err = new Error(
      "Registry surface execution must use bearer_token auth, not brand credentials."
    );
    err.code = "registry_surface_requires_bearer_token";
    err.status = 403;
    err.details = {
      target_key: brand.target_key,
      registry_surface_auth_mode: brand.registry_surface_auth_mode
    };
    throw err;
  }

  if (String(brand.target_key || "").toLowerCase().endsWith("_wp")) {
    const err = new Error(
      "Registry surface execution cannot resolve to a WordPress brand target."
    );
    err.code = "registry_surface_cannot_use_wordpress_target";
    err.status = 403;
    err.details = { target_key: brand.target_key };
    throw err;
  }

  if (brand.username || brand.application_password) {
    const err = new Error(
      "Registry surface execution must not carry brand credentials (username/application_password)."
    );
    err.code = "registry_surface_brand_credentials_leaked";
    err.status = 403;
    err.details = { target_key: brand.target_key };
    throw err;
  }
}
