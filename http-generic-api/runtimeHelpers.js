export function jsonParseSafe(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function asBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

export function boolFromSheet(value) {
  return asBool(value);
}

export function rowToObject(headers = [], row = []) {
  const out = {};
  headers.forEach((header, i) => {
    out[header] = row[i] ?? "";
  });
  return out;
}
