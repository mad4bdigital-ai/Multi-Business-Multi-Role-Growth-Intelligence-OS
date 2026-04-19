import { inferAuthMode } from "./authInjection.js";
import { policyValue } from "./registryResolution.js";

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

    if (!storageMode || storageMode === "embedded_sheet") {
      contract.secret = action.api_key_value || "";
      return contract;
    }

    if (storageMode === "per_target_credentials") {
      const accountKey = resolveAccountKey({ brand, targetKey, hostingAccounts });
      const hostingAccount = findHostingAccountByKey(hostingAccounts, accountKey);

      if (hostingAccount) {
        const accountStorageMode = String(
          hostingAccount.api_key_storage_mode || ""
        ).trim().toLowerCase();

        if (accountStorageMode === "secret_reference") {
          contract.secret = resolveSecretFromReference(hostingAccount.api_key_reference);
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

  const directHostingAccount = findHostingAccountByKey(hostingAccounts, directTargetKey);
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
