// Phase M — Deployment / Release / Rollback surfaces

// ── M.1 Plan Resolution ───────────────────────────────────────────────────────

export function resolveWordpressPhaseMPlan(payload = {}) {
  const migration = payload?.migration || {};
  const deploy =
    migration.deployment_release &&
    typeof migration.deployment_release === "object"
      ? migration.deployment_release
      : {};

  return {
    enabled: deploy.enabled === true,
    inventory_only:
      deploy.inventory_only === undefined ? true : deploy.inventory_only === true,
    apply: deploy.apply === true,
    include_theme_activation: deploy.include_theme_activation === undefined ? true : deploy.include_theme_activation === true,
    include_plugin_activation: deploy.include_plugin_activation === undefined ? true : deploy.include_plugin_activation === true,
    include_settings_push: deploy.include_settings_push === undefined ? true : deploy.include_settings_push === true,
    include_cache_flush: deploy.include_cache_flush === undefined ? true : deploy.include_cache_flush === true,
    rollback_enabled: deploy.rollback_enabled === undefined ? true : deploy.rollback_enabled === true,
    rollback_on_failure: deploy.rollback_on_failure === undefined ? true : deploy.rollback_on_failure === true,
    rollback_checkpoint: String(deploy.rollback_checkpoint || "pre_deployment").trim(),
    release_tag: String(deploy.release_tag || "").trim(),
    source_site: String(deploy.source_site || "").trim(),
    target_site: String(deploy.target_site || "").trim(),
    maintenance_window_minutes: Number(deploy.maintenance_window_minutes) || 30
  };
}

export function assertWordpressPhaseMPlan(plan = {}) {
  if (!plan.enabled) return;
  if (!plan.source_site) throw new Error("Phase M: source_site is required");
  if (!plan.target_site) throw new Error("Phase M: target_site is required");
  if (!plan.include_theme_activation && !plan.include_plugin_activation && !plan.include_settings_push) {
    throw new Error("Phase M: at least one deployment scope must be enabled");
  }
  if (plan.maintenance_window_minutes < 5 || plan.maintenance_window_minutes > 480) {
    throw new Error("Phase M: maintenance_window_minutes must be between 5 and 480");
  }
}

export function buildWordpressPhaseMGate(args = {}) {
  const { plan = {}, priorPhaseStatus = {} } = args;
  const blockers = [];

  if (!plan.enabled) {
    return { gate_open: true, skipped: true, reason: "Phase M disabled in plan" };
  }
  if (!plan.source_site) blockers.push("source_site missing");
  if (!plan.target_site) blockers.push("target_site missing");
  if (priorPhaseStatus.phase_l_enabled && !priorPhaseStatus.phase_l_backup_healthy) {
    blockers.push("Phase L backup not healthy — rollback point not established");
  }

  return {
    gate_open: blockers.length === 0,
    blockers,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      release_tag: plan.release_tag,
      rollback_enabled: plan.rollback_enabled,
      scopes: [
        plan.include_theme_activation && "theme_activation",
        plan.include_plugin_activation && "plugin_activation",
        plan.include_settings_push && "settings_push",
        plan.include_cache_flush && "cache_flush"
      ].filter(Boolean)
    }
  };
}

// ── M.2 Inventory ─────────────────────────────────────────────────────────────

export async function runWordpressDeploymentReleaseInventory(args = {}) {
  const { plan = {} } = args;
  if (!plan.enabled) return { skipped: true, inventory_rows: [] };

  const inventoryRows = [];
  const scannedAt = new Date().toISOString();

  if (plan.include_theme_activation) {
    inventoryRows.push({
      scope: "theme_activation",
      source_site: plan.source_site,
      target_site: plan.target_site,
      current_active_theme: null,
      target_theme: null,
      theme_compatible: null,
      status: "pending_scan"
    });
  }
  if (plan.include_plugin_activation) {
    inventoryRows.push({
      scope: "plugin_activation",
      source_site: plan.source_site,
      target_site: plan.target_site,
      plugin_count: 0,
      active_plugin_count: 0,
      inactive_plugin_count: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_settings_push) {
    inventoryRows.push({
      scope: "settings_push",
      source_site: plan.source_site,
      target_site: plan.target_site,
      settings_group_count: 0,
      conflicting_settings_count: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_cache_flush) {
    inventoryRows.push({
      scope: "cache_flush",
      source_site: plan.source_site,
      target_site: plan.target_site,
      cache_layers: [],
      status: "pending_scan"
    });
  }

  return {
    skipped: false,
    source_site: plan.source_site,
    target_site: plan.target_site,
    scanned_at: scannedAt,
    inventory_rows: inventoryRows,
    scope_count: inventoryRows.length,
    release_tag: plan.release_tag
  };
}

export function buildWordpressPhaseMNormalizedInventory(inventoryResult = {}) {
  if (inventoryResult.skipped) {
    return {
      skipped: true,
      normalized_deployment_scope_rows: [],
      normalized_rollback_checkpoint_rows: []
    };
  }

  const normalizedDeploymentScopeRows = (inventoryResult.inventory_rows || []).map(row => ({
    scope: String(row.scope || ""),
    source_site: String(row.source_site || ""),
    target_site: String(row.target_site || ""),
    status: String(row.status || "pending_scan"),
    conflict_count: Number(row.conflicting_settings_count || 0),
    item_count: Number(
      row.plugin_count || row.settings_group_count || 0
    )
  }));

  const normalizedRollbackCheckpointRows = normalizedDeploymentScopeRows.map(row => ({
    scope: row.scope,
    source_site: row.source_site,
    target_site: row.target_site,
    checkpoint_id: null,
    created_at: null,
    restorable: row.status !== "error"
  }));

  return {
    skipped: false,
    normalized_deployment_scope_rows: normalizedDeploymentScopeRows,
    normalized_rollback_checkpoint_rows: normalizedRollbackCheckpointRows,
    total_scopes: normalizedDeploymentScopeRows.length,
    total_checkpoints: normalizedRollbackCheckpointRows.length
  };
}

// ── M.3 Readiness Gate ────────────────────────────────────────────────────────

export function buildWordpressPhaseMReadinessGate(args = {}) {
  const { plan = {}, normalizedInventory = {} } = args;
  if (!plan.enabled || normalizedInventory.skipped) {
    return { gate_open: true, skipped: true, readiness_status: "skipped" };
  }

  const scopeRows = normalizedInventory.normalized_deployment_scope_rows || [];
  const failedScopes = scopeRows.filter(r => r.status === "error");
  const conflictScopes = scopeRows.filter(r => r.conflict_count > 0);

  const blockers = [];
  if (failedScopes.length > 0) {
    blockers.push(`${failedScopes.length} deployment scope(s) errored during inventory`);
  }
  if (plan.include_theme_activation && !scopeRows.find(r => r.scope === "theme_activation")) {
    blockers.push("theme_activation scope missing from inventory");
  }

  const warnings = conflictScopes.length > 0
    ? [`${conflictScopes.length} scope(s) have settings conflicts`]
    : [];

  return {
    gate_open: blockers.length === 0,
    readiness_status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    warnings,
    scope_count: scopeRows.length,
    conflict_scope_count: conflictScopes.length,
    failed_scope_count: failedScopes.length
  };
}

export function buildWordpressPhaseMSafeCandidates(args = {}) {
  const { plan = {}, normalizedInventory = {}, readinessGate = {} } = args;
  if (!plan.enabled || !readinessGate.gate_open) {
    return { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  }

  const scopeRows = normalizedInventory.normalized_deployment_scope_rows || [];

  const safeCandidates = scopeRows.filter(r =>
    r.status !== "error" && r.scope && r.source_site && r.target_site
  );
  const unsafeCandidates = scopeRows.filter(r =>
    r.status === "error" || !r.scope || !r.source_site || !r.target_site
  );

  return {
    safe_candidates: safeCandidates,
    unsafe_candidates: unsafeCandidates,
    total_safe: safeCandidates.length,
    total_unsafe: unsafeCandidates.length
  };
}

// ── M.4 Reconciliation Planner ────────────────────────────────────────────────

export function buildWordpressPhaseMReconciliationPayloadPlanner(args = {}) {
  const { plan = {}, safeCandidates = {}, normalizedInventory = {} } = args;
  if (!plan.enabled) {
    return { skipped: true, reconciliation_items: [] };
  }

  const candidates = safeCandidates.safe_candidates || [];

  const reconciliationItems = candidates.map(candidate => ({
    scope: candidate.scope,
    source_site: candidate.source_site,
    target_site: candidate.target_site,
    action: plan.apply ? "deploy" : "verify_only",
    rollback_enabled: plan.rollback_enabled,
    rollback_checkpoint: plan.rollback_checkpoint,
    maintenance_window_minutes: plan.maintenance_window_minutes,
    release_tag: plan.release_tag,
    requires_confirmation: plan.apply === true
  }));

  return {
    skipped: false,
    reconciliation_items: reconciliationItems,
    total_items: reconciliationItems.length,
    apply_mode: plan.apply,
    inventory_only_mode: plan.inventory_only,
    rollback_enabled: plan.rollback_enabled
  };
}

// ── M.5 Execution Plan ────────────────────────────────────────────────────────

export function resolveWordpressPhaseMExecutionPlan(args = {}) {
  const { plan = {}, reconciliationPlanner = {} } = args;
  if (!plan.enabled || reconciliationPlanner.skipped) {
    return { skipped: true, execution_steps: [], total_steps: 0 };
  }

  const items = reconciliationPlanner.reconciliation_items || [];

  const executionSteps = items.map((item, idx) => ({
    step_index: idx + 1,
    scope: item.scope,
    source_site: item.source_site,
    target_site: item.target_site,
    action: item.action,
    rollback_enabled: item.rollback_enabled,
    rollback_checkpoint: item.rollback_checkpoint,
    release_tag: item.release_tag,
    status: "pending",
    error: null,
    rollback_status: null
  }));

  return {
    skipped: false,
    execution_steps: executionSteps,
    total_steps: executionSteps.length,
    apply_mode: plan.apply,
    estimated_duration_minutes: Math.ceil(executionSteps.length * 5)
  };
}

export function buildWordpressPhaseMExecutionGuard(args = {}) {
  const { plan = {}, executionPlan = {}, safeCandidates = {} } = args;
  if (!plan.enabled || executionPlan.skipped) {
    return { guard_passed: true, skipped: true };
  }

  const violations = [];

  if (plan.apply && (safeCandidates.total_safe || 0) === 0) {
    violations.push("apply=true but no safe deployment candidates found");
  }
  if (plan.apply && !plan.target_site) {
    violations.push("apply=true but target_site is missing");
  }
  if (plan.apply && plan.rollback_enabled && !plan.rollback_checkpoint) {
    violations.push("rollback_enabled but no rollback_checkpoint defined");
  }
  if ((executionPlan.total_steps || 0) > 20) {
    violations.push(`execution plan too large: ${executionPlan.total_steps} steps (max 20)`);
  }

  return {
    guard_passed: violations.length === 0,
    violations,
    step_count: executionPlan.total_steps || 0,
    apply_mode: plan.apply,
    rollback_enabled: plan.rollback_enabled
  };
}

// ── M.6 Mutation Candidate Selector ───────────────────────────────────────────

export function buildWordpressPhaseMMutationCandidateSelector(args = {}) {
  const { plan = {}, executionPlan = {}, executionGuard = {} } = args;
  if (!plan.enabled || !executionGuard.guard_passed || executionPlan.skipped) {
    return { selected_mutations: [], total_selected: 0, blocked: true };
  }

  const steps = executionPlan.execution_steps || [];
  const selectedMutations = steps.filter(s => s.action === "deploy");

  return {
    selected_mutations: selectedMutations,
    total_selected: selectedMutations.length,
    blocked: false,
    verify_only_count: steps.filter(s => s.action === "verify_only").length,
    rollback_eligible_count: selectedMutations.filter(s => s.rollback_enabled).length
  };
}

export function buildWordpressPhaseMMutationCandidateArtifact(selectorResult = {}) {
  return {
    mutations: selectorResult.selected_mutations || [],
    total: selectorResult.total_selected || 0,
    blocked: selectorResult.blocked === true,
    verify_only_count: selectorResult.verify_only_count || 0,
    rollback_eligible_count: selectorResult.rollback_eligible_count || 0,
    generated_at: new Date().toISOString()
  };
}

// ── M.7 Mutation Payload Composer ─────────────────────────────────────────────

export function buildWordpressPhaseMMutationPayloadComposer(args = {}) {
  const { plan = {}, mutationCandidateArtifact = {} } = args;
  if (mutationCandidateArtifact.blocked || (mutationCandidateArtifact.total || 0) === 0) {
    return { payloads: [], total_payloads: 0, skipped: true };
  }

  const mutations = mutationCandidateArtifact.mutations || [];

  const payloads = mutations.map(m => ({
    scope: m.scope,
    source_site: m.source_site,
    target_site: m.target_site,
    operation: "deployment_apply",
    rollback_enabled: m.rollback_enabled,
    rollback_checkpoint: m.rollback_checkpoint,
    release_tag: m.release_tag,
    maintenance_window_minutes: plan.maintenance_window_minutes,
    payload_version: "1.0",
    created_at: new Date().toISOString()
  }));

  return {
    payloads,
    total_payloads: payloads.length,
    skipped: false,
    apply_mode: plan.apply,
    rollback_enabled: plan.rollback_enabled
  };
}

export function buildWordpressPhaseMMutationPayloadArtifact(composerResult = {}) {
  return {
    payloads: composerResult.payloads || [],
    total: composerResult.total_payloads || 0,
    skipped: composerResult.skipped === true,
    apply_mode: composerResult.apply_mode === true,
    rollback_enabled: composerResult.rollback_enabled === true,
    generated_at: new Date().toISOString()
  };
}

// ── M.8 Dry Run Execution Simulator ───────────────────────────────────────────

export function simulateWordpressDeploymentReleaseDryRunRow(args = {}) {
  const { payload = {}, rowIndex = 0 } = args;

  const wouldSucceed =
    Boolean(payload.scope) &&
    Boolean(payload.source_site) &&
    Boolean(payload.target_site);

  const rollbackWouldSucceed = payload.rollback_enabled && wouldSucceed;

  return {
    row_index: rowIndex,
    scope: payload.scope,
    source_site: payload.source_site,
    target_site: payload.target_site,
    operation: payload.operation,
    would_succeed: wouldSucceed,
    rollback_would_succeed: rollbackWouldSucceed,
    simulated_error: wouldSucceed ? null : "missing required deployment parameters",
    simulated_duration_minutes: wouldSucceed ? 5 + rowIndex * 2 : 0
  };
}

export function buildWordpressPhaseMDryRunExecutionSimulator(args = {}) {
  const { plan = {}, mutationPayloadArtifact = {} } = args;
  if (mutationPayloadArtifact.skipped || !plan.enabled) {
    return { skipped: true, dry_run_rows: [], summary: {} };
  }

  const payloads = mutationPayloadArtifact.payloads || [];
  const dryRunRows = payloads.map((payload, idx) =>
    simulateWordpressDeploymentReleaseDryRunRow({ payload, rowIndex: idx })
  );

  const successCount = dryRunRows.filter(r => r.would_succeed).length;
  const failCount = dryRunRows.length - successCount;
  const rollbackReadyCount = dryRunRows.filter(r => r.rollback_would_succeed).length;

  return {
    skipped: false,
    dry_run_rows: dryRunRows,
    summary: {
      total: dryRunRows.length,
      would_succeed: successCount,
      would_fail: failCount,
      rollback_ready: rollbackReadyCount,
      estimated_total_duration_minutes: dryRunRows.reduce(
        (acc, r) => acc + (r.simulated_duration_minutes || 0), 0
      )
    }
  };
}

export function buildWordpressPhaseMDryRunExecutionArtifact(simulatorResult = {}) {
  return {
    skipped: simulatorResult.skipped === true,
    dry_run_rows: simulatorResult.dry_run_rows || [],
    summary: simulatorResult.summary || {},
    generated_at: new Date().toISOString()
  };
}

// ── M.9 Final Operator Handoff Bundle ─────────────────────────────────────────

export function buildWordpressPhaseMFinalOperatorHandoffBundle(args = {}) {
  const {
    plan = {},
    gate = {},
    normalizedInventory = {},
    readinessGate = {},
    safeCandidates = {},
    reconciliationPlanner = {},
    executionPlan = {},
    executionGuard = {},
    mutationCandidateArtifact = {},
    mutationPayloadArtifact = {},
    dryRunArtifact = {}
  } = args;

  const enabled = plan.enabled === true;
  const gateOpen = gate.gate_open === true;
  const readinessStatus = readinessGate.readiness_status || "unknown";
  const guardPassed = executionGuard.guard_passed === true;
  const dryRunSummary = dryRunArtifact.summary || {};

  const overallStatus =
    !enabled ? "skipped" :
    !gateOpen ? "gate_blocked" :
    readinessStatus === "blocked" ? "readiness_blocked" :
    !guardPassed ? "guard_blocked" :
    dryRunArtifact.skipped ? "dry_run_skipped" :
    (dryRunSummary.would_fail || 0) > 0 ? "dry_run_failures" :
    "ready_for_execution";

  return {
    phase: "M",
    phase_name: "Deployment / Release / Rollback",
    enabled,
    overall_status: overallStatus,
    gate_open: gateOpen,
    readiness_status: readinessStatus,
    guard_passed: guardPassed,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      release_tag: plan.release_tag,
      rollback_enabled: plan.rollback_enabled,
      rollback_on_failure: plan.rollback_on_failure,
      maintenance_window_minutes: plan.maintenance_window_minutes,
      scopes: [
        plan.include_theme_activation && "theme_activation",
        plan.include_plugin_activation && "plugin_activation",
        plan.include_settings_push && "settings_push",
        plan.include_cache_flush && "cache_flush"
      ].filter(Boolean),
      apply_mode: plan.apply
    },
    inventory_summary: {
      total_scopes: normalizedInventory.total_scopes || 0,
      total_checkpoints: normalizedInventory.total_checkpoints || 0
    },
    safe_candidate_count: safeCandidates.total_safe || 0,
    unsafe_candidate_count: safeCandidates.total_unsafe || 0,
    reconciliation_item_count: reconciliationPlanner.total_items || 0,
    execution_step_count: executionPlan.total_steps || 0,
    mutation_count: mutationCandidateArtifact.total || 0,
    payload_count: mutationPayloadArtifact.total || 0,
    rollback_eligible_count: mutationCandidateArtifact.rollback_eligible_count || 0,
    dry_run_summary: dryRunSummary,
    blockers: [
      ...(gate.blockers || []),
      ...(readinessGate.blockers || []),
      ...(executionGuard.violations || [])
    ],
    generated_at: new Date().toISOString()
  };
}
