import { readTable as sqlReadTable } from "./sqlAdapter.js";

export const REGISTRY_SURFACES = Object.freeze({
  actions: Object.freeze({
    surfaceKey: "actions",
    sqlTableName: "Actions Registry",
    legacySheetEnv: "ACTIONS_REGISTRY_SHEET",
    keyFields: Object.freeze(["action_key"])
  }),
  endpoints: Object.freeze({
    surfaceKey: "endpoints",
    sqlTableName: "API Actions Endpoint Registry",
    legacySheetEnv: "ENDPOINT_REGISTRY_SHEET",
    keyFields: Object.freeze(["parent_action_key", "endpoint_key"])
  }),
  executionPolicies: Object.freeze({
    surfaceKey: "execution_policies",
    sqlTableName: "Execution Policy Registry",
    legacySheetEnv: "EXECUTION_POLICY_SHEET",
    keyFields: Object.freeze(["policy_group", "policy_key"])
  })
});

function normalizeSource(value, fallback = "sql") {
  return String(value || fallback).trim().toLowerCase();
}

function envFlag(name, fallback = "false") {
  return String(process.env[name] ?? fallback).trim().toLowerCase() === "true";
}

export function shouldReadRegistrySurfaceFromSql(surfaceKey, env = process.env) {
  const surface = REGISTRY_SURFACES[surfaceKey];
  if (!surface) throw new Error(`Unknown registry surface: ${surfaceKey}`);

  const globalSource = normalizeSource(env.REGISTRY_PRIMARY_SOURCE || env.DATA_SOURCE, "sql");
  const surfaceEnvName = `${String(surfaceKey).toUpperCase()}_REGISTRY_SOURCE`;
  const surfaceSource = normalizeSource(env[surfaceEnvName] || globalSource, "sql");
  const legacyFlagName = `LEGACY_SHEET_${String(surfaceKey).toUpperCase()}_REGISTRY_ENABLED`;
  const legacyEnabled = envFlag(legacyFlagName, "false");

  return surfaceSource !== "sheets" || !legacyEnabled;
}

export async function readSqlRegistrySurface(surfaceKey) {
  const surface = REGISTRY_SURFACES[surfaceKey];
  if (!surface) throw new Error(`Unknown registry surface: ${surfaceKey}`);
  const rows = await sqlReadTable(surface.sqlTableName);
  return Array.isArray(rows) ? rows : [];
}

export function filterRowsByKeyFields(rows = [], surfaceKey) {
  const surface = REGISTRY_SURFACES[surfaceKey];
  if (!surface) throw new Error(`Unknown registry surface: ${surfaceKey}`);
  return rows.filter(row =>
    surface.keyFields.some(field => String(row?.[field] ?? "").trim())
  );
}
