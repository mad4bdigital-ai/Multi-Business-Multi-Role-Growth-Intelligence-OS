import { readTableDirect as sqlReadTableDirect } from "./sqlAdapter.js";

const _DATA_SOURCE = String(process.env.DATA_SOURCE || "").trim().toLowerCase() || "sheets";

export async function loadTaskRoutesRegistry(sheets, options = {}, deps = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  if (_DATA_SOURCE !== "sheets") {
    const sqlRows = await sqlReadTableDirect("Task Routes");
    const rows = sqlRows.map(r => {
      const routeActive = String(r.active || "").trim().toUpperCase() === "TRUE";
      const routeRecord = {
        task_key: r.task_key || "",
        route_key: r.task_key || "",
        trigger_terms: r.trigger_terms || "",
        route_modules: r.route_modules || "",
        execution_layer: r.execution_layer || "",
        enabled: r.enabled || "",
        output_focus: r.output_focus || "",
        notes: r.notes || "",
        entry_sources: r.entry_sources || "",
        linked_starter_titles: r.linked_starter_titles || "",
        active_starter_count: r.active_starter_count || "",
        route_key_match_status: r.route_key_match_status || "",
        row_id: r.row_id || "",
        route_id: r.route_id || "",
        active: r.active || "",
        intent_key: r.intent_key || "",
        brand_scope: r.brand_scope || "",
        request_type: r.request_type || "",
        route_mode: r.route_mode || "",
        target_module: r.target_module || "",
        workflow_key: r.workflow_key || "",
        lifecycle_mode: r.lifecycle_mode || "",
        memory_required: r.memory_required || "",
        logging_required: r.logging_required || "",
        review_required: r.review_required || "",
        priority: r.priority || "",
        allowed_states: r.allowed_states || "",
        degraded_action: r.degraded_action || "",
        blocked_action: r.blocked_action || "",
        match_rule: r.match_rule || "",
        route_source: r.route_source || "",
        last_validated_at: r.last_validated_at || "",
        addition_status: "active",
        governance_status: "",
        validation_status: "",
        overlap_group: "",
        integration_mode: "",
        chain_candidate: "",
        graph_update_required: "",
        bindings_update_required: "",
        policy_update_required: "",
        starter_update_required: "",
        reconciliation_required: ""
      };
      return { ...routeRecord, executable_authority: routeActive };
    }).filter(r => r.task_key || r.route_id || r.workflow_key);
    return includeCandidateInspection ? rows : rows.filter(r => r.executable_authority);
  }

  const taskShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.TASK_ROUTES_SHEET,
    deps.toValuesApiRange(deps.TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await deps.getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: deps.TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: deps.TASK_ROUTES_CANONICAL_COLUMNS
  });

  const values = typeof deps.fetchChunkedTable === "function"
    ? await deps.fetchChunkedTable(sheets, {
        spreadsheetId: deps.REGISTRY_SPREADSHEET_ID,
        sheetName: deps.TASK_ROUTES_SHEET,
        columnStart: "A",
        columnEnd: "AF",
        headerRow: 1,
        dataStartRow: 2,
        dataEndRow: 2000
      })
    : await deps.fetchRange(
        sheets,
        deps.toValuesApiRange(deps.TASK_ROUTES_SHEET, "A1:AF2000")
      );
  if (!values.length) throw deps.registryError("Task Routes");
  const headers = (values[0] || []).map(value => String(value || "").trim());
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.TASK_ROUTES_SHEET,
    actualHeader: headers,
    metadata: taskRoutesMetadata,
    fallbackColumns: deps.TASK_ROUTES_CANONICAL_COLUMNS
  });
  const map = deps.headerMap(headers, deps.TASK_ROUTES_SHEET);

  const rows = values
    .slice(1)
    .map(row => {
      const taskKey = deps.getCell(row, map, "Task Key");
      const activeRaw = deps.getCell(row, map, "active");
      const routeActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
      const additionStatus = deps.normalizeGovernedAdditionState(
        deps.getCell(row, map, "addition_status") ||
          deps.getCell(row, map, "governance_status") ||
          deps.getCell(row, map, "validation_status")
      );

      const routeRecord = {
        task_key: taskKey,
        route_key: taskKey,
        trigger_terms: deps.getCell(row, map, "Trigger Terms"),
        route_modules: deps.getCell(row, map, "Route Modules"),
        execution_layer: deps.getCell(row, map, "Execution Layer"),
        enabled: deps.getCell(row, map, "Enabled"),
        output_focus: deps.getCell(row, map, "Output Focus"),
        notes: deps.getCell(row, map, "Notes"),
        entry_sources: deps.getCell(row, map, "Entry Sources"),
        linked_starter_titles: deps.getCell(row, map, "Linked Starter Titles"),
        active_starter_count: deps.getCell(row, map, "Active Starter Count"),
        route_key_match_status: deps.getCell(row, map, "Route Key Match Status"),
        row_id: deps.getCell(row, map, "row_id"),
        route_id: deps.getCell(row, map, "route_id"),
        active: activeRaw,
        intent_key: deps.getCell(row, map, "intent_key"),
        brand_scope: deps.getCell(row, map, "brand_scope"),
        request_type: deps.getCell(row, map, "request_type"),
        route_mode: deps.getCell(row, map, "route_mode"),
        target_module: deps.getCell(row, map, "target_module"),
        workflow_key: deps.getCell(row, map, "workflow_key"),
        lifecycle_mode: deps.getCell(row, map, "lifecycle_mode"),
        memory_required: deps.getCell(row, map, "memory_required"),
        logging_required: deps.getCell(row, map, "logging_required"),
        review_required: deps.getCell(row, map, "review_required"),
        priority: deps.getCell(row, map, "priority"),
        allowed_states: deps.getCell(row, map, "allowed_states"),
        degraded_action: deps.getCell(row, map, "degraded_action"),
        blocked_action: deps.getCell(row, map, "blocked_action"),
        match_rule: deps.getCell(row, map, "match_rule"),
        route_source: deps.getCell(row, map, "route_source"),
        last_validated_at: deps.getCell(row, map, "last_validated_at"),
        addition_status: additionStatus,
        governance_status: deps.getCell(row, map, "governance_status"),
        validation_status: deps.getCell(row, map, "validation_status"),
        overlap_group: deps.getCell(row, map, "overlap_group"),
        integration_mode: deps.getCell(row, map, "integration_mode"),
        chain_candidate: deps.getCell(row, map, "chain_candidate"),
        graph_update_required: deps.getCell(row, map, "graph_update_required"),
        bindings_update_required: deps.getCell(row, map, "bindings_update_required"),
        policy_update_required: deps.getCell(row, map, "policy_update_required"),
        starter_update_required: deps.getCell(row, map, "starter_update_required"),
        reconciliation_required: deps.getCell(row, map, "reconciliation_required")
      };

      const deferredActivationRequired = deps.hasDeferredGovernedActivationDependencies(
        routeRecord,
        [
          "chain_candidate",
          "graph_update_required",
          "bindings_update_required",
          "policy_update_required",
          "starter_update_required",
          "reconciliation_required"
        ]
      );

      const executableAuthority =
        routeActive &&
        !deps.governedAdditionStateBlocksAuthority(routeRecord.addition_status) &&
        !deferredActivationRequired;

      return {
        ...routeRecord,
        executable_authority: executableAuthority
      };
    })
    .filter(
      row =>
        String(row.task_key || "").trim() ||
        String(row.route_id || "").trim() ||
        String(row.workflow_key || "").trim()
    );

  deps.assertSingleActiveRowByKey(rows, "route_id", "active", deps.TASK_ROUTES_SHEET);
  deps.assertSingleActiveRowByKey(rows, "task_key", "active", deps.TASK_ROUTES_SHEET);

  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

export async function loadWorkflowRegistry(sheets, options = {}, deps = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  if (_DATA_SOURCE !== "sheets") {
    const sqlRows = await sqlReadTableDirect("Workflow Registry");
    const rows = sqlRows.map(r => {
      const workflowActive = String(r.active || "").trim().toUpperCase() === "TRUE";
      const workflowRecord = {
        workflow_id: r.workflow_id || "",
        workflow_name: r.workflow_name || "",
        module_mode: r.module_mode || "",
        trigger_source: r.trigger_source || "",
        input_type: r.input_type || "",
        primary_objective: r.primary_objective || "",
        mapped_engines: r.mapped_engines || "",
        engine_order: r.engine_order || "",
        workflow_type: r.workflow_type || "",
        primary_output: r.primary_output || "",
        input_detection_rules: r.input_detection_rules || "",
        output_template: r.output_template || "",
        priority: r.priority || "",
        route_key: r.route_key || "",
        execution_mode: r.execution_mode || "",
        user_facing: r.user_facing || "",
        parent_layer: r.parent_layer || "",
        status: r.status || "",
        linked_workflows: r.linked_workflows || "",
        linked_engines: r.linked_engines || "",
        notes: r.notes || "",
        entry_priority_weight: r.entry_priority_weight || "",
        dependency_type: r.dependency_type || "",
        output_artifact_type: r.output_artifact_type || "",
        workflow_key: r.workflow_key || "",
        active: r.active || "",
        target_module: r.target_module || "",
        execution_class: r.execution_class || "",
        lifecycle_mode: r.lifecycle_mode || "",
        route_compatibility: r.route_compatibility || "",
        memory_required: r.memory_required || "",
        logging_required: r.logging_required || "",
        review_required: r.review_required || "",
        allowed_states: r.allowed_states || "",
        degraded_action: r.degraded_action || "",
        blocked_action: r.blocked_action || "",
        registry_source: r.registry_source || "",
        last_validated_at: r.last_validated_at || "",
        addition_status: "active",
        governance_status: "",
        validation_status: "",
        workflow_family: "",
        overlap_group: "",
        execution_path_role: "",
        chain_eligible: "",
        graph_update_required: "",
        bindings_update_required: "",
        repair_mapping_required: "",
        policy_dependency_required: "",
        policy_update_required: "",
        starter_update_required: "",
        reconciliation_required: ""
      };
      return { ...workflowRecord, executable_authority: workflowActive };
    }).filter(r => r.workflow_id || r.workflow_key);
    return includeCandidateInspection ? rows : rows.filter(r => r.executable_authority);
  }

  const workflowShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.WORKFLOW_REGISTRY_SHEET,
    deps.toValuesApiRange(deps.WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await deps.getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const values = typeof deps.fetchChunkedTable === "function"
    ? await deps.fetchChunkedTable(sheets, {
        spreadsheetId: deps.REGISTRY_SPREADSHEET_ID,
        sheetName: deps.WORKFLOW_REGISTRY_SHEET,
        columnStart: "A",
        columnEnd: "AL",
        headerRow: 1,
        dataStartRow: 2,
        dataEndRow: 2000
      })
    : await deps.fetchRange(
        sheets,
        deps.toValuesApiRange(deps.WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
      );
  if (!values.length) throw deps.registryError("Workflow Registry");
  const headers = (values[0] || []).map(value => String(value || "").trim());
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.WORKFLOW_REGISTRY_SHEET,
    actualHeader: headers,
    metadata: workflowRegistryMetadata,
    fallbackColumns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });
  const map = deps.headerMap(headers, deps.WORKFLOW_REGISTRY_SHEET);

  const rows = values
    .slice(1)
    .map(row => {
      const activeRaw = deps.getCell(row, map, "active");
      const workflowActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
      const additionStatus = deps.normalizeGovernedAdditionState(
        deps.getCell(row, map, "addition_status") ||
          deps.getCell(row, map, "governance_status") ||
          deps.getCell(row, map, "validation_status")
      );

      const workflowRecord = {
        workflow_id: deps.getCell(row, map, "Workflow ID"),
        workflow_name: deps.getCell(row, map, "Workflow Name"),
        module_mode: deps.getCell(row, map, "Module Mode"),
        trigger_source: deps.getCell(row, map, "Trigger Source"),
        input_type: deps.getCell(row, map, "Input Type"),
        primary_objective: deps.getCell(row, map, "Primary Objective"),
        mapped_engines: deps.getCell(row, map, "Mapped Engine(s)"),
        engine_order: deps.getCell(row, map, "Engine Order"),
        workflow_type: deps.getCell(row, map, "Workflow Type"),
        primary_output: deps.getCell(row, map, "Primary Output"),
        input_detection_rules: deps.getCell(row, map, "Input Detection Rules"),
        output_template: deps.getCell(row, map, "Output Template"),
        priority: deps.getCell(row, map, "Priority"),
        route_key: deps.getCell(row, map, "Route Key"),
        execution_mode: deps.getCell(row, map, "Execution Mode"),
        user_facing: deps.getCell(row, map, "User Facing"),
        parent_layer: deps.getCell(row, map, "Parent Layer"),
        status: deps.getCell(row, map, "Status"),
        linked_workflows: deps.getCell(row, map, "Linked Workflows"),
        linked_engines: deps.getCell(row, map, "Linked Engines"),
        notes: deps.getCell(row, map, "Notes"),
        entry_priority_weight: deps.getCell(row, map, "Entry Priority Weight"),
        dependency_type: deps.getCell(row, map, "Dependency Type"),
        output_artifact_type: deps.getCell(row, map, "Output Artifact Type"),
        workflow_key: deps.getCell(row, map, "workflow_key"),
        active: activeRaw,
        target_module: deps.getCell(row, map, "target_module"),
        execution_class: deps.getCell(row, map, "execution_class"),
        lifecycle_mode: deps.getCell(row, map, "lifecycle_mode"),
        route_compatibility: deps.getCell(row, map, "route_compatibility"),
        memory_required: deps.getCell(row, map, "memory_required"),
        logging_required: deps.getCell(row, map, "logging_required"),
        review_required: deps.getCell(row, map, "review_required"),
        allowed_states: deps.getCell(row, map, "allowed_states"),
        degraded_action: deps.getCell(row, map, "degraded_action"),
        blocked_action: deps.getCell(row, map, "blocked_action"),
        registry_source: deps.getCell(row, map, "registry_source"),
        last_validated_at: deps.getCell(row, map, "last_validated_at"),
        addition_status: additionStatus,
        governance_status: deps.getCell(row, map, "governance_status"),
        validation_status: deps.getCell(row, map, "validation_status"),
        workflow_family: deps.getCell(row, map, "workflow_family"),
        overlap_group: deps.getCell(row, map, "overlap_group"),
        execution_path_role: deps.getCell(row, map, "execution_path_role"),
        chain_eligible: deps.getCell(row, map, "chain_eligible"),
        graph_update_required: deps.getCell(row, map, "graph_update_required"),
        bindings_update_required: deps.getCell(row, map, "bindings_update_required"),
        repair_mapping_required: deps.getCell(row, map, "repair_mapping_required"),
        policy_dependency_required: deps.getCell(row, map, "policy_dependency_required"),
        policy_update_required: deps.getCell(row, map, "policy_update_required"),
        starter_update_required: deps.getCell(row, map, "starter_update_required"),
        reconciliation_required: deps.getCell(row, map, "reconciliation_required")
      };

      const deferredActivationRequired = deps.hasDeferredGovernedActivationDependencies(
        workflowRecord,
        [
          "chain_eligible",
          "graph_update_required",
          "bindings_update_required",
          "repair_mapping_required",
          "policy_dependency_required",
          "policy_update_required",
          "starter_update_required",
          "reconciliation_required"
        ]
      );

      const executableAuthority =
        workflowActive &&
        !deps.governedAdditionStateBlocksAuthority(workflowRecord.addition_status) &&
        !deferredActivationRequired;

      return {
        ...workflowRecord,
        executable_authority: executableAuthority
      };
    })
    .filter(
      row =>
        String(row.workflow_id || "").trim() ||
        String(row.workflow_key || "").trim()
    );

  deps.assertSingleActiveRowByKey(rows, "workflow_id", "active", deps.WORKFLOW_REGISTRY_SHEET);
  deps.assertSingleActiveRowByKey(rows, "workflow_key", "active", deps.WORKFLOW_REGISTRY_SHEET);

  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}
