function localFetchRange(sheets, spreadsheetId, range) {
  return sheets.spreadsheets.values
    .get({
      spreadsheetId: String(spreadsheetId || "").trim(),
      range
    })
    .then(response => response.data.values || []);
}

async function readRegistryTable(
  sheets,
  deps,
  { spreadsheetId, sheetName, columnEnd, dataEndRow = 2000, columnStart = "A" }
) {
  if (typeof deps.fetchChunkedTable === "function") {
    return deps.fetchChunkedTable(sheets, {
      spreadsheetId,
      sheetName,
      columnStart,
      columnEnd,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow
    });
  }

  const normalizedSheetName = String(sheetName || "").trim().replace(/'/g, "''");
  const range = `'${normalizedSheetName}'!${columnStart}1:${columnEnd}${dataEndRow}`;
  return localFetchRange(sheets, spreadsheetId, range);
}

export async function getRegistrySurfaceCatalogRowBySurfaceId(surfaceId = "", deps = {}) {
  const normalizedSurfaceId = String(surfaceId || "").trim();
  if (!normalizedSurfaceId) return null;

  const {
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    getCell,
    headerMap,
    toValuesApiRange
  } = deps;

  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    columnEnd: "AG",
    dataEndRow: 2000
  });

  if (values.length < 2) return null;

  const header = values[0].map(value => String(value || "").trim());
  const map = headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET);

  for (const row of values.slice(1)) {
    const rowSurfaceId = String(getCell(row, map, "surface_id") || "").trim();
    if (rowSurfaceId !== normalizedSurfaceId) continue;

    return {
      surface_id: rowSurfaceId,
      surface_name: String(getCell(row, map, "surface_name") || "").trim(),
      worksheet_name: String(getCell(row, map, "worksheet_name") || "").trim(),
      worksheet_gid: String(getCell(row, map, "worksheet_gid") || "").trim(),
      active_status: String(getCell(row, map, "active_status") || "").trim(),
      authority_status: String(getCell(row, map, "authority_status") || "").trim(),
      required_for_execution: String(getCell(row, map, "required_for_execution") || "").trim(),
      schema_ref: String(getCell(row, map, "schema_ref") || "").trim(),
      schema_version: String(getCell(row, map, "schema_version") || "").trim(),
      header_signature: String(getCell(row, map, "header_signature") || "").trim(),
      expected_column_count: String(getCell(row, map, "expected_column_count") || "").trim(),
      binding_mode: String(getCell(row, map, "binding_mode") || "").trim(),
      sheet_role: String(getCell(row, map, "sheet_role") || "").trim(),
      audit_mode: String(getCell(row, map, "audit_mode") || "").trim(),
      legacy_surface_containment_required: String(
        getCell(row, map, "legacy_surface_containment_required") || ""
      ).trim(),
      repair_candidate_types: String(getCell(row, map, "repair_candidate_types") || "").trim(),
      repair_priority: String(getCell(row, map, "repair_priority") || "").trim()
    };
  }

  return null;
}

export async function loadBrandRegistry(sheets, deps = {}) {
  const {
    BRAND_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  } = deps;
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: BRAND_REGISTRY_SHEET,
    columnEnd: "CX",
    dataEndRow: 1000
  });
  if (!values.length) throw registryError("Brand Registry");
  const headers = values[0];
  const map = headerMap(headers, BRAND_REGISTRY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      brand_name: getCell(row, map, "Brand Name"),
      normalized_brand_name: getCell(row, map, "Normalized Brand Name"),
      brand_domain: getCell(row, map, "brand_domain"),
      target_key: getCell(row, map, "target_key"),
      site_aliases_json: getCell(row, map, "site_aliases_json"),
      base_url: getCell(row, map, "base_url"),
      transport_action_key: getCell(row, map, "transport_action_key"),
      auth_type: getCell(row, map, "auth_type"),
      credential_resolution: getCell(row, map, "credential_resolution"),
      username: getCell(row, map, "username"),
      application_password: getCell(row, map, "application_password"),
      default_headers_json: getCell(row, map, "default_headers_json"),
      write_allowed: getCell(row, map, "write_allowed"),
      destructive_allowed: getCell(row, map, "destructive_allowed"),
      transport_enabled: getCell(row, map, "transport_enabled"),
      target_resolution_mode: getCell(row, map, "target_resolution_mode"),
      hosting_provider: getCell(row, map, "hosting_provider"),
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hostinger_api_target_key: getCell(row, map, "hostinger_api_target_key"),
      server_environment_label: getCell(row, map, "server_environment_label"),
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_region_or_datacenter: getCell(row, map, "server_region_or_datacenter"),
      server_primary_domain: getCell(row, map, "server_primary_domain"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      hosting_account_registry_ref: getCell(row, map, "hosting_account_registry_ref")
    }))
    .filter(row => row.brand_name || row.target_key || row.base_url);
}

export async function loadHostingAccountRegistry(sheets, deps = {}) {
  const {
    HOSTING_ACCOUNT_REGISTRY_COLUMNS,
    HOSTING_ACCOUNT_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  } = deps;
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: HOSTING_ACCOUNT_REGISTRY_SHEET,
    columnEnd: "AZ",
    dataEndRow: 1000
  });
  if (!values.length) throw registryError("Hosting Account Registry");

  const headers = values[0];
  const map = headerMap(headers, HOSTING_ACCOUNT_REGISTRY_SHEET);

  for (const column of HOSTING_ACCOUNT_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, column)) {
      const err = new Error(
        `Hosting Account Registry missing required column: ${column}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values
    .slice(1)
    .map(row => ({
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hosting_provider: getCell(row, map, "hosting_provider"),
      account_identifier: getCell(row, map, "account_identifier"),
      api_auth_mode: getCell(row, map, "api_auth_mode"),
      api_key_reference: getCell(row, map, "api_key_reference"),
      api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
      plan_label: getCell(row, map, "plan_label"),
      plan_type: getCell(row, map, "plan_type"),
      account_scope_notes: getCell(row, map, "account_scope_notes"),
      status: getCell(row, map, "status"),
      last_reviewed_at: getCell(row, map, "last_reviewed_at"),
      brand_sites_json: getCell(row, map, "brand_sites_json"),
      resolver_target_keys_json: getCell(row, map, "resolver_target_keys_json"),
      auth_validation_status: getCell(row, map, "auth_validation_status"),
      endpoint_binding_status: getCell(row, map, "endpoint_binding_status"),
      resolver_execution_ready: getCell(row, map, "resolver_execution_ready"),
      last_runtime_check_at: getCell(row, map, "last_runtime_check_at"),
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      ssh_available: getCell(row, map, "ssh_available"),
      ssh_enabled: getCell(row, map, "ssh_enabled"),
      ssh_source: getCell(row, map, "ssh_source"),
      ssh_host: getCell(row, map, "ssh_host"),
      ssh_port: getCell(row, map, "ssh_port"),
      ssh_username: getCell(row, map, "ssh_username"),
      ssh_auth_mode: getCell(row, map, "ssh_auth_mode"),
      ssh_credential_reference: getCell(row, map, "ssh_credential_reference"),
      ssh_runtime_notes: getCell(row, map, "ssh_runtime_notes"),
      account_mode: getCell(row, map, "account_mode"),
      shared_access_enabled: getCell(row, map, "shared_access_enabled"),
      sftp_available: getCell(row, map, "sftp_available"),
      wp_cli_available: getCell(row, map, "wp_cli_available"),
      last_validated_at: getCell(row, map, "last_validated_at")
    }))
    .filter(row => row.hosting_account_key);
}

export async function loadActionsRegistry(sheets, deps = {}) {
  const {
    ACTIONS_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  } = deps;
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    columnEnd: "AM",
    dataEndRow: 1000
  });
  if (!values.length) throw registryError("Actions Registry");
  const headers = values[0];
  const map = headerMap(headers, ACTIONS_REGISTRY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      action_key: getCell(row, map, "action_key"),
      status: getCell(row, map, "status"),
      module_binding: getCell(row, map, "module_binding"),
      connector_family: getCell(row, map, "connector_family"),
      api_key_mode: getCell(row, map, "api_key_mode"),
      api_key_param_name: getCell(row, map, "api_key_param_name"),
      api_key_header_name: getCell(row, map, "api_key_header_name"),
      api_key_value: getCell(row, map, "api_key_value"),
      api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
      openai_schema_file_id: getCell(row, map, "openai_schema_file_id"),
      oauth_config_file_id: getCell(row, map, "oauth_config_file_id"),
      oauth_config_file_name: getCell(row, map, "oauth_config_file_name"),
      runtime_capability_class: getCell(row, map, "runtime_capability_class"),
      runtime_callable: getCell(row, map, "runtime_callable"),
      primary_executor: getCell(row, map, "primary_executor"),
      notes: getCell(row, map, "notes")
    }))
    .filter(row => row.action_key);
}

export async function loadEndpointRegistry(sheets, deps = {}) {
  const {
    ENDPOINT_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    debugLog,
    getCell,
    headerMap,
    registryError
  } = deps;
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ENDPOINT_REGISTRY_SHEET,
    columnEnd: "BA",
    dataEndRow: 2000
  });
  if (!values.length) throw registryError("API Actions Endpoint Registry");
  const headers = values[0];
  const map = headerMap(headers, ENDPOINT_REGISTRY_SHEET);
  debugLog("ENDPOINT_REGISTRY_HEADERS:", JSON.stringify(headers));
  debugLog("ENDPOINT_REGISTRY_HEADER_MAP_KEYS:", JSON.stringify(Object.keys(map)));

  return values
    .slice(1)
    .map(row => ({
      endpoint_id: getCell(row, map, "endpoint_id"),
      parent_action_key: getCell(row, map, "parent_action_key"),
      endpoint_key: getCell(row, map, "endpoint_key"),
      provider_domain: getCell(row, map, "provider_domain"),
      method: getCell(row, map, "method"),
      endpoint_path_or_function: getCell(row, map, "endpoint_path_or_function"),
      module_binding: getCell(row, map, "module_binding"),
      connector_family: getCell(row, map, "connector_family"),
      status: getCell(row, map, "status"),
      spec_validation_status: getCell(row, map, "spec_validation_status"),
      auth_validation_status: getCell(row, map, "auth_validation_status"),
      privacy_validation_status: getCell(row, map, "privacy_validation_status"),
      execution_readiness: getCell(row, map, "execution_readiness"),
      endpoint_role: getCell(row, map, "endpoint_role"),
      execution_mode: getCell(row, map, "execution_mode"),
      transport_required: getCell(row, map, "transport_required"),
      fallback_allowed: getCell(row, map, "fallback_allowed"),
      fallback_match_basis: getCell(row, map, "fallback_match_basis"),
      fallback_provider_domain: getCell(row, map, "fallback_provider_domain"),
      fallback_connector_family: getCell(row, map, "fallback_connector_family"),
      fallback_action_name: getCell(row, map, "fallback_action_name"),
      fallback_route_target: getCell(row, map, "fallback_route_target"),
      fallback_notes: getCell(row, map, "fallback_notes"),
      inventory_role: getCell(row, map, "inventory_role"),
      inventory_source: getCell(row, map, "inventory_source"),
      notes: getCell(row, map, "notes"),
      brand_resolution_source: getCell(row, map, "brand_resolution_source"),
      transport_action_key: getCell(row, map, "transport_action_key")
    }))
    .filter(row => row.endpoint_key);
}

export async function loadExecutionPolicies(sheets, deps = {}) {
  const {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    boolFromSheet,
    getCell,
    headerMap,
    registryError
  } = deps;
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    columnEnd: "H",
    dataEndRow: 2000
  });
  if (!values.length) throw registryError("Execution Policy Registry");
  const headers = values[0];
  const map = headerMap(headers, EXECUTION_POLICY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      policy_group: getCell(row, map, "policy_group"),
      policy_key: getCell(row, map, "policy_key"),
      policy_value: getCell(row, map, "policy_value"),
      active: getCell(row, map, "active"),
      execution_scope: getCell(row, map, "execution_scope"),
      affects_layer: getCell(row, map, "affects_layer"),
      blocking: getCell(row, map, "blocking"),
      notes: getCell(row, map, "notes")
    }))
    .filter(row => row.policy_key && boolFromSheet(row.active));
}

export async function readExecutionPolicyRegistryLive(deps = {}) {
  const {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  } = deps;
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await readRegistryTable(sheets, deps, {
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    columnEnd: "H",
    dataEndRow: 2000
  });
  if (!values.length) throw registryError("Execution Policy Registry");

  const header = values[0].map(value => String(value || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, EXECUTION_POLICY_SHEET)
  };
}

export function buildExecutionPolicyRow(input = {}) {
  return {
    policy_group: String(input.policy_group || "").trim(),
    policy_key: String(input.policy_key || "").trim(),
    policy_value: String(input.policy_value || "").trim(),
    active:
      input.active === true || String(input.active || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    execution_scope: String(input.execution_scope || "execution").trim(),
    affects_layer: String(input.affects_layer || "").trim(),
    blocking:
      input.blocking === true || String(input.blocking || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes || "").trim()
  };
}

export function findExecutionPolicyRowNumber(header = [], rows = [], input = {}) {
  const groupIdx = header.indexOf("policy_group");
  const keyIdx = header.indexOf("policy_key");

  if (groupIdx === -1 || keyIdx === -1) {
    const err = new Error("Execution Policy Registry header missing policy_group or policy_key.");
    err.code = "execution_policy_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedGroup = String(input.policy_group || "").trim();
  const wantedKey = String(input.policy_key || "").trim();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const existingGroup = String(row[groupIdx] || "").trim();
    const existingKey = String(row[keyIdx] || "").trim();
    if (existingGroup === wantedGroup && existingKey === wantedKey) {
      return index + 2;
    }
  }

  return null;
}
