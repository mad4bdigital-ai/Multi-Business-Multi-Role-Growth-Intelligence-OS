const DEFAULT_ALLOWED_TRANSPORT = "http_generic_api";

export const HTTP_METHOD_TRANSPORT_KEYS = Object.freeze([
  "http_get",
  "http_post",
  "http_put",
  "http_patch",
  "http_delete"
]);

export function normalizeTransportActionKey(value = "") {
  return String(value || "").trim();
}

export function getAllowedDelegatedTransportKeys(allowedTransport = DEFAULT_ALLOWED_TRANSPORT) {
  const primary = normalizeTransportActionKey(allowedTransport || DEFAULT_ALLOWED_TRANSPORT);
  return new Set([primary, ...HTTP_METHOD_TRANSPORT_KEYS]);
}

export function isSupportedDelegatedTransportActionKey(
  transportActionKey = "",
  { allowedTransport = DEFAULT_ALLOWED_TRANSPORT } = {}
) {
  const key = normalizeTransportActionKey(transportActionKey);
  if (!key) return false;
  return getAllowedDelegatedTransportKeys(allowedTransport).has(key);
}

export function describeAllowedDelegatedTransportKeys(allowedTransport = DEFAULT_ALLOWED_TRANSPORT) {
  return [...getAllowedDelegatedTransportKeys(allowedTransport)].join("|");
}

export function transportActionKeyForMethod(method = "", fallback = DEFAULT_ALLOWED_TRANSPORT) {
  const normalized = String(method || "").trim().toUpperCase();
  const map = {
    GET: "http_get",
    POST: "http_post",
    PUT: "http_put",
    PATCH: "http_patch",
    DELETE: "http_delete"
  };
  return map[normalized] || normalizeTransportActionKey(fallback || DEFAULT_ALLOWED_TRANSPORT);
}
