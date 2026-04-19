// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID, BRAND_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET, ENDPOINT_REGISTRY_SHEET, EXECUTION_POLICY_SHEET,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  TASK_ROUTES_SHEET, WORKFLOW_REGISTRY_SHEET, REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET, EXECUTION_LOG_UNIFIED_SHEET,
  JSON_ASSET_REGISTRY_SHEET, BRAND_CORE_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SPREADSHEET_ID, JSON_ASSET_REGISTRY_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID, RAW_BODY_MAX_BYTES, MAX_TIMEOUT_SECONDS,
  SERVICE_VERSION, GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH,
  DEFAULT_JOB_MAX_ATTEMPTS, JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS
} from "./config.js";

export function getDefaultGoogleScopes(action = {}, endpoint = {}) {
  const actionKey = String(action.action_key || "").trim();
  const method = String(endpoint.method || "").trim().toUpperCase();
  const readonly = method === "GET";

  switch (actionKey) {
    case "googleads_api":
      return ["https://www.googleapis.com/auth/adwords"];

    case "searchads360_api":
      return ["https://www.googleapis.com/auth/doubleclicksearch"];

    case "searchconsole_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/webmasters.readonly"
          : "https://www.googleapis.com/auth/webmasters"
      ];

    case "analytics_data_api":
      return ["https://www.googleapis.com/auth/analytics.readonly"];

    case "analytics_admin_api":
      return ["https://www.googleapis.com/auth/analytics.edit"];

    case "tagmanager_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/tagmanager.readonly"
          : "https://www.googleapis.com/auth/tagmanager.edit.containers"
      ];

    default:
      return ["https://www.googleapis.com/auth/cloud-platform"];
  }
}

export function normalizeGoogleScopeList(scopes = []) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map(v => String(v || "").trim()).filter(Boolean))]
    : [];
}

export function getScopesFromOAuthConfig(oauthConfigContract, action) {
  const parsed = oauthConfigContract?.parsed || {};
  const byFamily = parsed?.scopes_by_action_family || {};
  const actionKey = String(action.action_key || "").trim();
  return normalizeGoogleScopeList(byFamily[actionKey] || []);
}

export function validateGoogleOAuthConfigTraceability(action, oauthConfigContract) {
  const expectedName = String(action.oauth_config_file_name || "").trim();
  const actualName = String(oauthConfigContract?.name || "").trim();
  if (!expectedName || !actualName) return;
  if (expectedName !== actualName) {
    debugLog("OAUTH_CONFIG_NAME_MISMATCH:", {
      action_key: action.action_key,
      expected: expectedName,
      actual: actualName
    });
  }
}

export async function resolveDelegatedGoogleScopes({ drive, policies, action, endpoint }) {
  const endpointScopedKey = `${action.action_key}|${endpoint.endpoint_key}|scopes`;
  const actionScopedKey = `${action.action_key}|scopes`;

  // 1) OAuth config file first
  const oauthConfigContract = await fetchOAuthConfigContract(drive, action);
  validateGoogleOAuthConfigTraceability(action, oauthConfigContract);
  const fileScopes = getScopesFromOAuthConfig(oauthConfigContract, action);
  if (fileScopes.length) {
    return {
      explicitScopes: fileScopes,
      scopeSource: `oauth_config_file:${oauthConfigContract.name || action.oauth_config_file_name || action.oauth_config_file_id}`
    };
  }

  // 2) endpoint-level policy override
  const endpointPolicyScopes = policyList(policies, "HTTP Google Auth", endpointScopedKey);
  if (endpointPolicyScopes.length) {
    return {
      explicitScopes: endpointPolicyScopes,
      scopeSource: `execution_policy:endpoint:${endpointScopedKey}`
    };
  }

  // 3) action-level policy override
  const actionPolicyScopes = policyList(policies, "HTTP Google Auth", actionScopedKey);
  if (actionPolicyScopes.length) {
    return {
      explicitScopes: actionPolicyScopes,
      scopeSource: `execution_policy:action:${actionScopedKey}`
    };
  }

  // 4) current hardcoded fallback
  return {
    explicitScopes: getDefaultGoogleScopes(action, endpoint),
    scopeSource: `server_default:${action.action_key}`
  };
}

export async function mintGoogleAccessTokenForEndpoint({ drive, policies, action, endpoint }) {
  const { explicitScopes, scopeSource } = await resolveDelegatedGoogleScopes({
    drive,
    policies,
    action,
    endpoint
  });
  debugLog("GOOGLE_SCOPE_SOURCE:", scopeSource);
  debugLog("GOOGLE_SCOPES:", JSON.stringify(explicitScopes));

  const auth = new google.auth.GoogleAuth({ scopes: explicitScopes });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    const err = new Error("Unable to mint Google access token for delegated execution.");
    err.code = "auth_resolution_failed";
    err.status = 500;
    throw err;
  }
  return token;
}

export function requirePolicyTrue(policies, group, key, message) {
  const value = policyValue(policies, group, key, "FALSE");
  if (String(value).trim().toUpperCase() !== "TRUE") {
    const err = new Error(message || `${group} | ${key} policy is not enabled.`);
    err.code = "policy_blocked";
    err.status = 403;
    throw err;
  }
}

export function requirePolicySet(policies, group, keys = []) {
  const missing = (keys || []).filter(key => {
    const value = policyValue(policies, group, key, "FALSE");
    return String(value).trim().toUpperCase() !== "TRUE";
  });

  return {
    ok: missing.length === 0,
    missing
  };
}

export function getRequiredHttpExecutionPolicyKeys(policies = []) {
  const auditEnabled =
    String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Required Policy Presence Audit Enabled",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const configuredKeys = policyList(
    policies,
    "HTTP Execution Governance",
    "Required Policy Presence Audit Keys"
  );

  const fallbackKeys = [
    "Require Endpoint Active",
    "Require Execution Readiness",
    "Enforce Parent Action Match",
    "Require Relative Path",
    "Require Auth Generation",
    "Server-Side Auth Injection Required",
    "Require Action Schema Resolution",
    "Require Request Schema Alignment"
  ];

  if (auditEnabled && configuredKeys.length) {
    return configuredKeys;
  }

  return fallbackKeys;
}

export function buildMissingRequiredPolicyError(policies = [], missing = []) {
  const handling = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Missing Required Policy Handling",
      "BLOCK"
    )
  ).trim();

  const err = new Error(
    "Required HTTP Execution Governance policies are not fully enabled."
  );
  err.code = "missing_required_http_execution_policy";
  err.status = 403;
  err.details = {
    policy_group: "HTTP Execution Governance",
    missing_keys: missing,
    handling
  };
  return err;
}

export function resilienceAppliesToParentAction(policies, parentActionKey) {
  const enabled = String(
    policyValue(
      policies,
      "HTTP Execution Resilience",
      "Retry Mutation Enabled",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!enabled) return false;

  const affected = policyList(
    policies,
    "HTTP Execution Resilience",
    "Affected Parent Action Keys"
  );

  return affected.includes(String(parentActionKey || "").trim());
}

export function shouldRetryProviderResponse(policies, upstreamStatus, responseText) {
  const triggers = policyList(
    policies,
    "HTTP Execution Resilience",
    "Provider Retry Trigger"
  );

  const text = String(responseText || "");
  for (const trigger of triggers) {
    if (trigger === "upstream_status>=500" && Number(upstreamStatus) >= 500) {
      return true;
    }
    if (trigger.startsWith("response_contains:")) {
      const needle = trigger.slice("response_contains:".length);
      if (needle && text.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

export function buildProviderRetryMutations(policies, actionKey = "") {
  if (!retryMutationEnabled(policies)) return [];
  if (!retryMutationAppliesToQuery(policies)) return [];
  if (!retryMutationSchemaModeAllowlisted(policies)) return [];
  if (!resilienceAppliesToParentAction(policies, actionKey)) return [];

  const strategy = String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Strategy", "")
  ).trim();

  if (strategy !== "premium_escalation") return [];

  const stages = [
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 0", "{}")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 1", "")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 2", "")).trim()
  ].filter(Boolean);

  return stages
    .map(parseRetryStageValue)
    .filter((mutation, index) => {
      if (index === 0) return false;
      return Object.keys(mutation || {}).length > 0;
    });
}

export function inferAuthMode({ action, brand }) {
  if (brand?.auth_type === "basic_auth_app_password") return "basic_auth";

  const actionKey = String(action.action_key || "").trim().toLowerCase();
  const apiKeyMode = String(action.api_key_mode || "").trim().toLowerCase();
  const headerName = String(action.api_key_header_name || "").trim();
  const paramName = String(action.api_key_param_name || "").trim();
  const oauthConfigured = isOAuthConfigured(action);

  if (
    headerName &&
    String(headerName).toLowerCase() === "authorization" &&
    apiKeyMode.includes("bearer")
  ) {
    return "bearer_token";
  }

  if (apiKeyMode === "basic_auth_app_password") {
    return "basic_auth";
  }

  if (
    actionKey === "googleads_api" &&
    oauthConfigured &&
    headerName &&
    String(headerName).toLowerCase() !== "authorization"
  ) {
    return "oauth_gpt_action";
  }

  if (headerName && apiKeyMode === "custom_api") {
    return "api_key_header";
  }

  if (paramName) return "api_key_query";
  if (headerName) return "api_key_header";

  if (oauthConfigured) return "oauth_gpt_action";
  return "none";
}

export function normalizeAuthContract({
  action,
  brand,
  hostingAccounts = [],
  targetKey = ""
}) {
  const mode = inferAuthMode({ action, brand });
  const contract = {
    mode,
    inject: true,
    username: "",
    secret: "",
    param_name: "",
    header_name: "",
    custom_headers: {}
  };

  if (mode === "basic_auth") {
    contract.username = brand?.username || "";
    contract.secret = brand?.application_password || "";
    contract.header_name = "Authorization";
    return contract;
  }

  if (mode === "api_key_query") {
    contract.param_name = action.api_key_param_name || "api_key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "api_key_header") {
    contract.header_name = action.api_key_header_name || "x-api-key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "bearer_token") {
    contract.header_name = "Authorization";

    const storageMode = String(action.api_key_storage_mode || "")
      .trim()
      .toLowerCase();

    // old/simple action-level mode
    if (!storageMode || storageMode === "embedded_sheet") {
      contract.secret = action.api_key_value || "";
      return contract;
    }

    // governed per-target credentials:
    // brand -> hosting account OR direct hosting-account target -> account registry -> secret reference
    if (storageMode === "per_target_credentials") {
      const accountKey = resolveAccountKey({
        brand,
        targetKey,
        hostingAccounts
      });

      const hostingAccount = findHostingAccountByKey(hostingAccounts, accountKey);

      if (hostingAccount) {
        const accountStorageMode = String(
          hostingAccount.api_key_storage_mode || ""
        ).trim().toLowerCase();

        if (accountStorageMode === "secret_reference") {
          contract.secret = resolveSecretFromReference(
            hostingAccount.api_key_reference
          );
          return contract;
        }
        contract.secret = String(hostingAccount.api_key_reference || "").trim();
        return contract;
      }

      contract.secret = "";
      return contract;
    }

    contract.secret = action.api_key_value || "";
    return contract;
  }

  return contract;
}

export function findHostingAccountByKey(hostingAccounts = [], key = "") {
  const wanted = String(key || "").trim();
  if (!wanted) return null;

  return (
    hostingAccounts.find(
      row => String(row.hosting_account_key || "").trim() === wanted
    ) || null
  );
}

export function resolveAccountKeyFromBrand(brand = {}) {
  return (
    String(brand?.hosting_account_key || "").trim() ||
    String(brand?.hostinger_api_target_key || "").trim() ||
    String(brand?.hosting_account_registry_ref || "").trim()
  );
}

export function resolveAccountKey({
  brand = null,
  targetKey = "",
  hostingAccounts = []
}) {
  const fromBrand = resolveAccountKeyFromBrand(brand);
  if (fromBrand) return fromBrand;

  const directTargetKey = String(targetKey || "").trim();
  if (!directTargetKey) return "";

  const directHostingAccount = findHostingAccountByKey(
    hostingAccounts,
    directTargetKey
  );
  if (directHostingAccount) {
    return String(directHostingAccount.hosting_account_key || "").trim();
  }

  return "";
}

export function resolveSecretFromReference(reference = "") {
  const ref = String(reference || "").trim();
  if (!ref) return "";

  const prefix = "ref:secret:";
  if (!ref.startsWith(prefix)) return "";

  const secretKey = ref.slice(prefix.length).trim();
  if (!secretKey) return "";

  return String(process.env[secretKey] || "").trim();
}

export function isGoogleApiHost(providerDomain = "") {
  try {
    return new URL(providerDomain).hostname.endsWith("googleapis.com");
  } catch {
    return false;
  }
}

export function getAdditionalStaticAuthHeaders(action = {}, authContract = {}) {
  const headerName = String(action.api_key_header_name || "").trim();
  const headerValue = String(action.api_key_value || "").trim();

  if (!headerName || !headerValue) return {};
  if (headerName.toLowerCase() === "authorization") return {};

  return { [headerName]: headerValue };
}

export function enforceSupportedAuthMode(policies, mode) {
  const supported = String(policyValue(policies, "HTTP Execution Governance", "Supported Auth Modes", ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
  if (!supported.includes(mode)) {
    const err = new Error(`Resolved auth mode is unsupported by policy: ${mode}`);
    err.code = "unsupported_auth_mode";
    err.status = 403;
    throw err;
  }
}

export function buildResolvedAuthHeaders(contract) {
  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    return { Authorization: `Basic ${token}` };
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { Authorization: `Bearer ${contract.secret}` };
  }

  if (contract.mode === "custom_headers") {
    return { ...(contract.custom_headers || {}) };
  }

  return {};
}

export function injectAuthIntoQuery(query, contract) {
  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...query, [contract.param_name]: contract.secret };
  }
  return query;
}

export function injectAuthIntoHeaders(headers, contract) {
  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...headers, [contract.header_name]: contract.secret };
  }

  return { ...headers, ...buildResolvedAuthHeaders(contract) };
}

export function injectAuthForSchemaValidation(query, headers, contract) {
  let nextQuery = { ...(query || {}) };
  let nextHeaders = { ...(headers || {}) };

  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextQuery[contract.param_name] = contract.secret;
  }

  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders[contract.header_name] = contract.secret;
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders["Authorization"] = `Bearer ${contract.secret}`;
  }

  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    nextHeaders["Authorization"] = `Basic ${token}`;
  }

  return { query: nextQuery, headers: nextHeaders };
}
