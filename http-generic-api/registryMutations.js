async function runGovernedRegistryMutation(config = {}, input = {}, deps = {}) {
  const live = await config.readLive(deps);
  const row = config.buildRow(input, deps);
  const targetRowNumber = config.findRowNumber
    ? config.findRowNumber(live.header, live.rows, input, deps)
    : null;

  const mutationResult = await deps.performGovernedSheetMutation({
    spreadsheetId: deps.REGISTRY_SPREADSHEET_ID,
    sheetName: config.sheetName,
    mutationType: config.mutationType,
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: config.scanRangeA1
  });

  return {
    mutationType: config.mutationType,
    targetRowNumber:
      config.mutationType === "append"
        ? undefined
        : mutationResult.targetRowNumber || targetRowNumber,
    row: config.includeRow === false ? undefined : row,
    preflight: mutationResult.preflight
  };
}

function readLiveSheetFactory(sheetName, rangeA1) {
  return async function readLive(deps = {}) {
    const { getGoogleClientsForSpreadsheet, headerMap, registryError, toValuesApiRange } = deps;
    const { sheets } = await getGoogleClientsForSpreadsheet(deps.REGISTRY_SPREADSHEET_ID);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: String(deps.REGISTRY_SPREADSHEET_ID || "").trim(),
      range: toValuesApiRange(sheetName, rangeA1)
    });
    const values = response.data.values || [];
    if (!values.length) throw registryError(sheetName);

    const header = values[0].map(value => String(value || "").trim());
    const rows = values.slice(1);
    return {
      header,
      rows,
      map: headerMap(header, sheetName)
    };
  };
}

export const readTaskRoutesLive = readLiveSheetFactory("Task Routes", "A1:AF2000");
export const readWorkflowRegistryLive = readLiveSheetFactory("Workflow Registry", "A1:AL2000");
export const readRegistrySurfacesCatalogLive = readLiveSheetFactory("Registry Surfaces Catalog", "A1:AG2000");
export const readValidationRepairRegistryLive = readLiveSheetFactory("Validation & Repair Registry", "A1:AZ2000");
export const readActionsRegistryLive = readLiveSheetFactory("Actions Registry", "A1:AZ2000");

export function buildTaskRouteRow(input = {}, deps = {}) {
  const row = {};

  for (const col of deps.TASK_ROUTES_CANONICAL_COLUMNS || []) {
    row[col] = "";
  }

  row["Task Key"] = String(input["Task Key"] ?? input.task_key ?? "").trim();
  row["Trigger Terms"] = String(input["Trigger Terms"] ?? input.trigger_terms ?? "").trim();
  row["Route Modules"] = String(input["Route Modules"] ?? input.route_modules ?? "").trim();
  row["Execution Layer"] = String(input["Execution Layer"] ?? input.execution_layer ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Enabled"] =
    input["Enabled"] === true || String(input["Enabled"] ?? input.enabled ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Output Focus"] = String(input["Output Focus"] ?? input.output_focus ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Sources"] = String(input["Entry Sources"] ?? input.entry_sources ?? "").trim();
  row["Linked Starter Titles"] = String(input["Linked Starter Titles"] ?? input.linked_starter_titles ?? "").trim();
  row["Active Starter Count"] = String(input["Active Starter Count"] ?? input.active_starter_count ?? "").trim();
  row["Route Key Match Status"] = String(input["Route Key Match Status"] ?? input.route_key_match_status ?? "").trim();

  row["row_id"] = String(input.row_id ?? "").trim();
  row["route_id"] = String(input.route_id ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["intent_key"] = String(input.intent_key ?? "").trim();
  row["brand_scope"] = String(input.brand_scope ?? "").trim();
  row["request_type"] = String(input.request_type ?? "").trim();
  row["route_mode"] = String(input.route_mode ?? "").trim();
  row["target_module"] = String(input.target_module ?? "").trim();
  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["priority"] = String(input.priority ?? "").trim();
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["match_rule"] = String(input.match_rule ?? "").trim();
  row["route_source"] = String(input.route_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

export function findTaskRouteRowNumber(header = [], rows = [], input = {}) {
  const routeIdIdx = header.indexOf("route_id");
  const taskKeyIdx = header.indexOf("Task Key");

  if (routeIdIdx === -1 && taskKeyIdx === -1) {
    const err = new Error("Task Routes header missing route_id and Task Key.");
    err.code = "task_routes_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedRouteId = String(input.route_id || "").trim();
  const wantedTaskKey = String(input["Task Key"] ?? input.task_key ?? "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingRouteId = routeIdIdx === -1 ? "" : String(row[routeIdIdx] || "").trim();
    const existingTaskKey = taskKeyIdx === -1 ? "" : String(row[taskKeyIdx] || "").trim();

    if (wantedRouteId && existingRouteId === wantedRouteId) return i + 2;
    if (!wantedRouteId && wantedTaskKey && existingTaskKey === wantedTaskKey) return i + 2;
  }

  return null;
}

export function buildWorkflowRegistryRow(input = {}, deps = {}) {
  const row = {};

  for (const col of deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS || []) {
    row[col] = "";
  }

  row["Workflow ID"] = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  row["Workflow Name"] = String(input["Workflow Name"] ?? input.workflow_name ?? "").trim();
  row["Module Mode"] = String(input["Module Mode"] ?? input.module_mode ?? "").trim();
  row["Trigger Source"] = String(input["Trigger Source"] ?? input.trigger_source ?? "").trim();
  row["Input Type"] = String(input["Input Type"] ?? input.input_type ?? "").trim();
  row["Primary Objective"] = String(input["Primary Objective"] ?? input.primary_objective ?? "").trim();
  row["Mapped Engine(s)"] = String(input["Mapped Engine(s)"] ?? input.mapped_engines ?? "").trim();
  row["Engine Order"] = String(input["Engine Order"] ?? input.engine_order ?? "").trim();
  row["Workflow Type"] = String(input["Workflow Type"] ?? input.workflow_type ?? "").trim();
  row["Primary Output"] = String(input["Primary Output"] ?? input.primary_output ?? "").trim();
  row["Input Detection Rules"] = String(input["Input Detection Rules"] ?? input.input_detection_rules ?? "").trim();
  row["Output Template"] = String(input["Output Template"] ?? input.output_template ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Route Key"] = String(input["Route Key"] ?? input.route_key ?? "").trim();
  row["Execution Mode"] = String(input["Execution Mode"] ?? input.execution_mode ?? "").trim();
  row["User Facing"] =
    input["User Facing"] === true || String(input["User Facing"] ?? input.user_facing ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Parent Layer"] = String(input["Parent Layer"] ?? input.parent_layer ?? "").trim();
  row["Status"] = String(input["Status"] ?? input.status_label ?? "").trim();
  row["Linked Workflows"] = String(input["Linked Workflows"] ?? input.linked_workflows ?? "").trim();
  row["Linked Engines"] = String(input["Linked Engines"] ?? input.linked_engines ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Priority Weight"] = String(input["Entry Priority Weight"] ?? input.entry_priority_weight ?? "").trim();
  row["Dependency Type"] = String(input["Dependency Type"] ?? input.dependency_type ?? "").trim();
  row["Output Artifact Type"] = String(input["Output Artifact Type"] ?? input.output_artifact_type ?? "").trim();

  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["target_module"] = String(input.target_module ?? "").trim();
  row["execution_class"] = String(input.execution_class ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["route_compatibility"] = String(input.route_compatibility ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["registry_source"] = String(input.registry_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

export function findWorkflowRegistryRowNumber(header = [], rows = [], input = {}) {
  const workflowIdIdx = header.indexOf("Workflow ID");
  const workflowKeyIdx = header.indexOf("workflow_key");

  if (workflowIdIdx === -1 && workflowKeyIdx === -1) {
    const err = new Error("Workflow Registry header missing Workflow ID and workflow_key.");
    err.code = "workflow_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedWorkflowId = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  const wantedWorkflowKey = String(input.workflow_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingWorkflowId = workflowIdIdx === -1 ? "" : String(row[workflowIdIdx] || "").trim();
    const existingWorkflowKey = workflowKeyIdx === -1 ? "" : String(row[workflowKeyIdx] || "").trim();

    if (wantedWorkflowId && existingWorkflowId === wantedWorkflowId) return i + 2;
    if (!wantedWorkflowId && wantedWorkflowKey && existingWorkflowKey === wantedWorkflowKey) return i + 2;
  }

  return null;
}

export function buildRegistrySurfaceCatalogRow(input = {}) {
  return {
    surface_id: String(input.surface_id ?? "").trim(),
    surface_name: String(input.surface_name ?? "").trim(),
    worksheet_name: String(input.worksheet_name ?? "").trim(),
    worksheet_gid: String(input.worksheet_gid ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    authority_status: String(input.authority_status ?? "").trim(),
    required_for_execution:
      input.required_for_execution === true ||
      String(input.required_for_execution ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    schema_ref: String(input.schema_ref ?? "").trim(),
    schema_version: String(input.schema_version ?? "").trim(),
    header_signature: String(input.header_signature ?? "").trim(),
    expected_column_count: String(input.expected_column_count ?? "").trim(),
    binding_mode: String(input.binding_mode ?? "").trim(),
    sheet_role: String(input.sheet_role ?? "").trim(),
    audit_mode: String(input.audit_mode ?? "").trim(),
    legacy_surface_containment_required:
      input.legacy_surface_containment_required === true ||
      String(input.legacy_surface_containment_required ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_candidate_types: String(input.repair_candidate_types ?? "").trim(),
    repair_priority: String(input.repair_priority ?? "").trim()
  };
}

export function findRegistrySurfaceCatalogRowNumber(header = [], rows = [], input = {}) {
  const surfaceIdIdx = header.indexOf("surface_id");
  const surfaceNameIdx = header.indexOf("surface_name");

  if (surfaceIdIdx === -1 && surfaceNameIdx === -1) {
    const err = new Error("Registry Surfaces Catalog header missing surface_id and surface_name.");
    err.code = "registry_surfaces_catalog_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedSurfaceId = String(input.surface_id || "").trim();
  const wantedSurfaceName = String(input.surface_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingSurfaceId = surfaceIdIdx === -1 ? "" : String(row[surfaceIdIdx] || "").trim();
    const existingSurfaceName = surfaceNameIdx === -1 ? "" : String(row[surfaceNameIdx] || "").trim();

    if (wantedSurfaceId && existingSurfaceId === wantedSurfaceId) return i + 2;
    if (!wantedSurfaceId && wantedSurfaceName && existingSurfaceName === wantedSurfaceName) return i + 2;
  }

  return null;
}

export function buildValidationRepairRegistryRow(input = {}) {
  return {
    validation_key: String(input.validation_key ?? "").trim(),
    validation_name: String(input.validation_name ?? "").trim(),
    surface_id: String(input.surface_id ?? "").trim(),
    target_sheet: String(input.target_sheet ?? "").trim(),
    target_range: String(input.target_range ?? "").trim(),
    validation_type: String(input.validation_type ?? "").trim(),
    validation_scope: String(input.validation_scope ?? "").trim(),
    severity: String(input.severity ?? "").trim(),
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_strategy: String(input.repair_strategy ?? "").trim(),
    repair_module: String(input.repair_module ?? "").trim(),
    expected_schema_ref: String(input.expected_schema_ref ?? "").trim(),
    expected_schema_version: String(input.expected_schema_version ?? "").trim(),
    expected_header_signature: String(input.expected_header_signature ?? "").trim(),
    drift_detection_mode: String(input.drift_detection_mode ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim(),
    notes: String(input.notes ?? "").trim()
  };
}

export function findValidationRepairRegistryRowNumber(header = [], rows = [], input = {}) {
  const validationKeyIdx = header.indexOf("validation_key");
  const validationNameIdx = header.indexOf("validation_name");

  if (validationKeyIdx === -1 && validationNameIdx === -1) {
    const err = new Error("Validation & Repair Registry header missing validation_key and validation_name.");
    err.code = "validation_repair_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedValidationKey = String(input.validation_key || "").trim();
  const wantedValidationName = String(input.validation_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingValidationKey = validationKeyIdx === -1 ? "" : String(row[validationKeyIdx] || "").trim();
    const existingValidationName = validationNameIdx === -1 ? "" : String(row[validationNameIdx] || "").trim();

    if (wantedValidationKey && existingValidationKey === wantedValidationKey) return i + 2;
    if (!wantedValidationKey && wantedValidationName && existingValidationName === wantedValidationName) return i + 2;
  }

  return null;
}

export function buildActionsRegistryRow(input = {}) {
  return {
    action_key: String(input.action_key ?? "").trim(),
    parent_action_key: String(input.parent_action_key ?? "").trim(),
    action_name: String(input.action_name ?? "").trim(),
    action_label: String(input.action_label ?? "").trim(),
    action_type: String(input.action_type ?? "").trim(),
    target_module: String(input.target_module ?? "").trim(),
    workflow_key: String(input.workflow_key ?? "").trim(),
    execution_mode: String(input.execution_mode ?? "").trim(),
    request_method: String(input.request_method ?? "").trim(),
    path_template: String(input.path_template ?? "").trim(),
    provider_domain_mode: String(input.provider_domain_mode ?? "").trim(),
    auth_mode: String(input.auth_mode ?? "").trim(),
    schema_mode: String(input.schema_mode ?? "").trim(),
    request_schema_ref: String(input.request_schema_ref ?? "").trim(),
    response_schema_ref: String(input.response_schema_ref ?? "").trim(),
    route_scope: String(input.route_scope ?? "").trim(),
    retry_profile: String(input.retry_profile ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes ?? "").trim(),
    owner_module: String(input.owner_module ?? "").trim(),
    authority_source: String(input.authority_source ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim()
  };
}

export function findActionsRegistryRowNumber(header = [], rows = [], input = {}) {
  const actionKeyIdx = header.indexOf("action_key");
  const actionNameIdx = header.indexOf("action_name");

  if (actionKeyIdx === -1 && actionNameIdx === -1) {
    const err = new Error("Actions Registry header missing action_key and action_name.");
    err.code = "actions_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedActionKey = String(input.action_key || "").trim();
  const wantedActionName = String(input.action_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingActionKey = actionKeyIdx === -1 ? "" : String(row[actionKeyIdx] || "").trim();
    const existingActionName = actionNameIdx === -1 ? "" : String(row[actionNameIdx] || "").trim();

    if (wantedActionKey && existingActionKey === wantedActionKey) return i + 2;
    if (!wantedActionKey && wantedActionName && existingActionName === wantedActionName) return i + 2;
  }

  return null;
}

export async function writeExecutionPolicyRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: deps.readExecutionPolicyRegistryLive,
      buildRow: deps.buildExecutionPolicyRow,
      sheetName: deps.EXECUTION_POLICY_SHEET,
      mutationType: "append",
      scanRangeA1: "A:H"
    },
    input,
    deps
  );
}

export async function updateExecutionPolicyRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: deps.readExecutionPolicyRegistryLive,
      buildRow: deps.buildExecutionPolicyRow,
      findRowNumber: deps.findExecutionPolicyRowNumber,
      sheetName: deps.EXECUTION_POLICY_SHEET,
      mutationType: "update",
      scanRangeA1: "A:H"
    },
    input,
    deps
  );
}

export async function deleteExecutionPolicyRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: deps.readExecutionPolicyRegistryLive,
      buildRow: deps.buildExecutionPolicyRow,
      findRowNumber: deps.findExecutionPolicyRowNumber,
      sheetName: deps.EXECUTION_POLICY_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:H",
      includeRow: false
    },
    input,
    deps
  );
}

export async function writeTaskRouteRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readTaskRoutesLive,
      buildRow: buildTaskRouteRow,
      sheetName: deps.TASK_ROUTES_SHEET,
      mutationType: "append",
      scanRangeA1: "A:AF"
    },
    input,
    deps
  );
}

export async function updateTaskRouteRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readTaskRoutesLive,
      buildRow: buildTaskRouteRow,
      findRowNumber: findTaskRouteRowNumber,
      sheetName: deps.TASK_ROUTES_SHEET,
      mutationType: "update",
      scanRangeA1: "A:AF"
    },
    input,
    deps
  );
}

export async function deleteTaskRouteRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readTaskRoutesLive,
      buildRow: buildTaskRouteRow,
      findRowNumber: findTaskRouteRowNumber,
      sheetName: deps.TASK_ROUTES_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:AF",
      includeRow: false
    },
    input,
    deps
  );
}

export async function writeWorkflowRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readWorkflowRegistryLive,
      buildRow: buildWorkflowRegistryRow,
      sheetName: deps.WORKFLOW_REGISTRY_SHEET,
      mutationType: "append",
      scanRangeA1: "A:AL"
    },
    input,
    deps
  );
}

export async function updateWorkflowRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readWorkflowRegistryLive,
      buildRow: buildWorkflowRegistryRow,
      findRowNumber: findWorkflowRegistryRowNumber,
      sheetName: deps.WORKFLOW_REGISTRY_SHEET,
      mutationType: "update",
      scanRangeA1: "A:AL"
    },
    input,
    deps
  );
}

export async function deleteWorkflowRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readWorkflowRegistryLive,
      buildRow: buildWorkflowRegistryRow,
      findRowNumber: findWorkflowRegistryRowNumber,
      sheetName: deps.WORKFLOW_REGISTRY_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:AL",
      includeRow: false
    },
    input,
    deps
  );
}

export async function writeRegistrySurfaceCatalogRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readRegistrySurfacesCatalogLive,
      buildRow: buildRegistrySurfaceCatalogRow,
      sheetName: deps.REGISTRY_SURFACES_CATALOG_SHEET,
      mutationType: "append",
      scanRangeA1: "A:AG"
    },
    input,
    deps
  );
}

export async function updateRegistrySurfaceCatalogRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readRegistrySurfacesCatalogLive,
      buildRow: buildRegistrySurfaceCatalogRow,
      findRowNumber: findRegistrySurfaceCatalogRowNumber,
      sheetName: deps.REGISTRY_SURFACES_CATALOG_SHEET,
      mutationType: "update",
      scanRangeA1: "A:AG"
    },
    input,
    deps
  );
}

export async function deleteRegistrySurfaceCatalogRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readRegistrySurfacesCatalogLive,
      buildRow: buildRegistrySurfaceCatalogRow,
      findRowNumber: findRegistrySurfaceCatalogRowNumber,
      sheetName: deps.REGISTRY_SURFACES_CATALOG_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:AG",
      includeRow: false
    },
    input,
    deps
  );
}

export async function writeValidationRepairRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readValidationRepairRegistryLive,
      buildRow: buildValidationRepairRegistryRow,
      sheetName: deps.VALIDATION_REPAIR_REGISTRY_SHEET,
      mutationType: "append",
      scanRangeA1: "A:AZ"
    },
    input,
    deps
  );
}

export async function updateValidationRepairRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readValidationRepairRegistryLive,
      buildRow: buildValidationRepairRegistryRow,
      findRowNumber: findValidationRepairRegistryRowNumber,
      sheetName: deps.VALIDATION_REPAIR_REGISTRY_SHEET,
      mutationType: "update",
      scanRangeA1: "A:AZ"
    },
    input,
    deps
  );
}

export async function deleteValidationRepairRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readValidationRepairRegistryLive,
      buildRow: buildValidationRepairRegistryRow,
      findRowNumber: findValidationRepairRegistryRowNumber,
      sheetName: deps.VALIDATION_REPAIR_REGISTRY_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:AZ",
      includeRow: false
    },
    input,
    deps
  );
}

export async function writeActionsRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readActionsRegistryLive,
      buildRow: buildActionsRegistryRow,
      sheetName: deps.ACTIONS_REGISTRY_SHEET,
      mutationType: "append",
      scanRangeA1: "A:AZ"
    },
    input,
    deps
  );
}

export async function updateActionsRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readActionsRegistryLive,
      buildRow: buildActionsRegistryRow,
      findRowNumber: findActionsRegistryRowNumber,
      sheetName: deps.ACTIONS_REGISTRY_SHEET,
      mutationType: "update",
      scanRangeA1: "A:AZ"
    },
    input,
    deps
  );
}

export async function deleteActionsRegistryRow(input = {}, deps = {}) {
  return runGovernedRegistryMutation(
    {
      readLive: readActionsRegistryLive,
      buildRow: buildActionsRegistryRow,
      findRowNumber: findActionsRegistryRowNumber,
      sheetName: deps.ACTIONS_REGISTRY_SHEET,
      mutationType: "delete",
      scanRangeA1: "A:AZ",
      includeRow: false
    },
    input,
    deps
  );
}
