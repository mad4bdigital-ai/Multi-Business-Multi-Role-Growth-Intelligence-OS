import express from "express";
import {
  assertSqlEndpointRegistryAuthority,
  describeEndpointRegistryLayer,
  loadEndpointRegistrySqlEmulated,
  resolveEndpointSqlEmulated,
} from "../endpointRegistryAuthorityLayer.js";

function compactEndpoint(row = {}) {
  return {
    endpoint_id: row.endpoint_id,
    parent_action_key: row.parent_action_key,
    endpoint_key: row.endpoint_key,
    provider_domain: row.provider_domain,
    provider_family: row.provider_family,
    method: row.method,
    endpoint_path_or_function: row.endpoint_path_or_function,
    openai_action_name: row.openai_action_name,
    module_binding: row.module_binding,
    connector_family: row.connector_family,
    status: row.status,
    execution_readiness: row.execution_readiness,
    endpoint_role: row.endpoint_role,
    execution_mode: row.execution_mode,
    transport_required: row.transport_required,
    runtime_binding_profile: row.runtime_binding_profile,
    admin_only: row.admin_only,
  };
}

function requireNonEmpty(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${name} is required`);
    err.status = 400;
    err.code = "missing_required_field";
    throw err;
  }
  return normalized;
}

function readEndpointIdentity(req) {
  const parentActionKey = req.query.parent_action_key || req.query.action_key;
  const endpointKey = req.query.endpoint_key || req.query.endpoint;
  return {
    parentActionKey: requireNonEmpty(parentActionKey, "parent_action_key"),
    endpointKey: requireNonEmpty(endpointKey, "endpoint_key"),
  };
}

export function buildSqlEndpointRegistryRoutes(deps = {}) {
  const router = express.Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());

  router.get(
    "/admin/sql/endpoint-registry/source-status",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (_req, res) => {
      return res.json({
        ok: true,
        ...describeEndpointRegistryLayer(),
      });
    },
  );

  router.get(
    "/admin/sql/endpoint-registry/endpoints",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const authority = assertSqlEndpointRegistryAuthority();
        const rows = await loadEndpointRegistrySqlEmulated({
          parent_action_key: req.query.parent_action_key,
          endpoint_key: req.query.endpoint_key,
          status: req.query.status || "active",
          limit: req.query.limit,
        });

        return res.json({
          ok: true,
          source: "sql_emulated_sheet",
          table: "endpoints",
          authority,
          count: rows.length,
          endpoints: rows.map(compactEndpoint),
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_list_failed",
            message: error.message,
            details: error.details || undefined,
          },
        });
      }
    },
  );

  router.get(
    "/admin/sql/endpoint-registry/simulated-sheet-rows",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const authority = assertSqlEndpointRegistryAuthority();
        const rows = await loadEndpointRegistrySqlEmulated({
          parent_action_key: req.query.parent_action_key,
          endpoint_key: req.query.endpoint_key,
          status: req.query.status || "active",
          limit: req.query.limit,
        });

        return res.json({
          ok: true,
          source: "sql_emulated_sheet",
          table: "endpoints",
          authority,
          count: rows.length,
          rows,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_simulated_rows_failed",
            message: error.message,
            details: error.details || undefined,
          },
        });
      }
    },
  );

  router.get(
    "/admin/sql/endpoint-registry/resolve",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const authority = assertSqlEndpointRegistryAuthority();
        const { parentActionKey, endpointKey } = readEndpointIdentity(req);
        const endpoint = await resolveEndpointSqlEmulated(parentActionKey, endpointKey);

        return res.json({
          ok: true,
          source: "sql_emulated_sheet",
          table: "endpoints",
          authority,
          endpoint: compactEndpoint(endpoint),
          simulated_sheet_row: endpoint,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_resolve_failed",
            message: error.message,
            details: error.details || undefined,
          },
        });
      }
    },
  );

  router.get(
    "/admin/sql/endpoint-registry/resolve-action",
    requireBackendApiKey,
    requireAdminPrincipal,
    async (req, res) => {
      try {
        const authority = assertSqlEndpointRegistryAuthority();
        const { parentActionKey, endpointKey } = readEndpointIdentity(req);
        const endpoint = await resolveEndpointSqlEmulated(parentActionKey, endpointKey);

        return res.json({
          ok: true,
          source: "sql_emulated_sheet",
          action_key: parentActionKey,
          endpoint_key: endpointKey,
          authority,
          resolved: {
            parent_action_key: endpoint.parent_action_key,
            endpoint_key: endpoint.endpoint_key,
            method: endpoint.method,
            provider_domain: endpoint.provider_domain,
            endpoint_path_or_function: endpoint.endpoint_path_or_function,
            status: endpoint.status,
            execution_readiness: endpoint.execution_readiness,
            execution_mode: endpoint.execution_mode,
            admin_only: endpoint.admin_only,
          },
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          error: {
            code: error.code || "sql_endpoint_registry_resolve_action_failed",
            message: error.message,
            details: error.details || undefined,
          },
        });
      }
    },
  );

  return router;
}
