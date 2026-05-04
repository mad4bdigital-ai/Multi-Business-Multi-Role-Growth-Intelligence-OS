import {
  isOAuthConfigured as isOAuthConfiguredCore,
  inferAuthMode as inferAuthModeCore,
  injectAuthForSchemaValidation as injectAuthForSchemaValidationCore,
  injectAuthIntoHeaders as injectAuthIntoHeadersCore,
  injectAuthIntoQuery as injectAuthIntoQueryCore,
  buildResolvedAuthHeaders as buildResolvedAuthHeadersCore
} from "./authInjection.js";

import {
  normalizeAuthContract as normalizeAuthContractCore,
  findHostingAccountByKey as findHostingAccountByKeyCore,
  resolveAccountKeyFromBrand as resolveAccountKeyFromBrandCore,
  resolveAccountKey as resolveAccountKeyCore,
  resolveSecretFromReference as resolveSecretFromReferenceCore,
  isGoogleApiHost as isGoogleApiHostCore,
  getAdditionalStaticAuthHeaders as getAdditionalStaticAuthHeadersCore,
  enforceSupportedAuthMode as enforceSupportedAuthModeCore
} from "./authCredentialResolution.js";

import {
  pathTemplateToRegex as pathTemplateToRegexCore,
  ensureMethodAndPathMatchEndpoint as ensureMethodAndPathMatchEndpointCore
} from "./httpRequestUtils.js";

import {
  fetchSchemaContract as fetchSchemaContractCore
} from "./driveFileLoader.js";

import {
  resolveSchemaOperation as resolveSchemaOperationCore,
  validateByJsonSchema as validateByJsonSchemaCore,
  validateParameters as validateParametersCore,
  validateRequestBody as validateRequestBodyCore,
  classifySchemaDrift as classifySchemaDriftCore
} from "./schemaValidation.js";

import { boolFromSheet } from "./runtimeHelpers.js";

export function isOAuthConfigured(action) {
  return isOAuthConfiguredCore(action);
}

export function inferAuthMode({ action, brand }) {
  return inferAuthModeCore({ action, brand });
}

export function normalizeAuthContract(args) { return normalizeAuthContractCore(args); }
export function findHostingAccountByKey(h, k) { return findHostingAccountByKeyCore(h, k); }
export function resolveAccountKeyFromBrand(b) { return resolveAccountKeyFromBrandCore(b); }
export function resolveAccountKey(args) { return resolveAccountKeyCore(args); }
export function resolveSecretFromReference(r) { return resolveSecretFromReferenceCore(r); }
export function isGoogleApiHost(d) { return isGoogleApiHostCore(d); }
export function getAdditionalStaticAuthHeaders(a, c) { return getAdditionalStaticAuthHeadersCore(a, c); }
export function enforceSupportedAuthMode(p, m) { return enforceSupportedAuthModeCore(p, m); }

export function pathTemplateToRegex(t) { return pathTemplateToRegexCore(t); }
export function ensureMethodAndPathMatchEndpoint(e, m, p, pp) { return ensureMethodAndPathMatchEndpointCore(e, m, p, pp); }

export async function fetchSchemaContract(drive, fileId) { return fetchSchemaContractCore(drive, fileId); }

export function resolveSchemaOperation(schema, method, path) {
  return resolveSchemaOperationCore(schema, method, path, { pathTemplateToRegex });
}

export function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  return validateByJsonSchemaCore(schema, value, scope, pathPrefix);
}

export function validateParameters(operation, request) {
  return validateParametersCore(operation, request);
}

export function validateRequestBody(operation, body) {
  return validateRequestBodyCore(operation, body);
}

export function classifySchemaDrift(expected, actual, scope) {
  return classifySchemaDriftCore(expected, actual, scope);
}

export function buildResolvedAuthHeaders(contract) {
  return buildResolvedAuthHeadersCore(contract);
}

export function injectAuthIntoQuery(query, contract) {
  return injectAuthIntoQueryCore(query, contract);
}

export function injectAuthIntoHeaders(headers, contract) {
  return injectAuthIntoHeadersCore(headers, contract);
}

export function injectAuthForSchemaValidation(query, headers, contract) {
  return injectAuthForSchemaValidationCore(query, headers, contract);
}

export function ensureWritePermissions(brand, method) {
  if (brand && ["POST", "PUT", "PATCH"].includes(method) && !boolFromSheet(brand.write_allowed)) {
    const err = new Error(`Write operations are not allowed for ${brand.brand_name || brand.base_url}.`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }

  if (method === "DELETE") {
    if (brand && boolFromSheet(brand.destructive_allowed)) return;
    const err = new Error("DELETE is not allowed for this target.");
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
}
