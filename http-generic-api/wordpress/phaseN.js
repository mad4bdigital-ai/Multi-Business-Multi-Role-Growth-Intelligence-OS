// Phase N — Data Integrity / Reconciliation Controls surfaces

// ── N.1 Plan Resolution ───────────────────────────────────────────────────────

export function resolveWordpressPhaseNPlan(payload = {}) {
  const migration = payload?.migration || {};
  const integrity =
    migration.data_integrity &&
    typeof migration.data_integrity === "object"
      ? migration.data_integrity
      : {};

  return {
    enabled: integrity.enabled === true,
    inventory_only:
      integrity.inventory_only === undefined ? true : integrity.inventory_only === true,
    apply: integrity.apply === true,
    include_post_count_reconciliation: integrity.include_post_count_reconciliation === undefined ? true : integrity.include_post_count_reconciliation === true,
    include_media_reconciliation: integrity.include_media_reconciliation === undefined ? true : integrity.include_media_reconciliation === true,
    include_taxonomy_reconciliation: integrity.include_taxonomy_reconciliation === undefined ? true : integrity.include_taxonomy_reconciliation === true,
    include_user_reconciliation: integrity.include_user_reconciliation === undefined ? true : integrity.include_user_reconciliation === true,
    include_meta_reconciliation: integrity.include_meta_reconciliation === undefined ? false : integrity.include_meta_reconciliation === true,
    include_settings_reconciliation: integrity.include_settings_reconciliation === undefined ? true : integrity.include_settings_reconciliation === true,
    drift_tolerance_percent: Number(integrity.drift_tolerance_percent) || 5,
    auto_repair: integrity.auto_repair === true,
    source_site: String(integrity.source_site || "").trim(),
    target_site: String(integrity.target_site || "").trim()
  };
}

export function assertWordpressPhaseNPlan(plan = {}) {
  if (!plan.enabled) return;
  if (!plan.source_site) throw new Error("Phase N: source_site is required");
  if (!plan.target_site) throw new Error("Phase N: target_site is required");
  if (plan.drift_tolerance_percent < 0 || plan.drift_tolerance_percent > 50) {
    throw new Error("Phase N: drift_tolerance_percent must be between 0 and 50");
  }
  if (!plan.include_post_count_reconciliation && !plan.include_media_reconciliation && !plan.include_taxonomy_reconciliation) {
    throw new Error("Phase N: at least one reconciliation scope must be enabled");
  }
}

export function buildWordpressPhaseNGate(args = {}) {
  const { plan = {}, priorPhaseStatus = {} } = args;
  const blockers = [];

  if (!plan.enabled) {
    return { gate_open: true, skipped: true, reason: "Phase N disabled in plan" };
  }
  if (!plan.source_site) blockers.push("source_site missing");
  if (!plan.target_site) blockers.push("target_site missing");
  if (priorPhaseStatus.phase_m_enabled && priorPhaseStatus.phase_m_status !== "ready_for_execution" && priorPhaseStatus.phase_m_status !== "skipped") {
    blockers.push("Phase M deployment not in a verified state");
  }

  return {
    gate_open: blockers.length === 0,
    blockers,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      drift_tolerance_percent: plan.drift_tolerance_percent,
      auto_repair: plan.auto_repair,
      scopes: [
        plan.include_post_count_reconciliation && "post_count",
        plan.include_media_reconciliation && "media",
        plan.include_taxonomy_reconciliation && "taxonomy",
        plan.include_user_reconciliation && "users",
        plan.include_meta_reconciliation && "meta",
        plan.include_settings_reconciliation && "settings"
      ].filter(Boolean)
    }
  };
}

// ── N.2 Inventory ─────────────────────────────────────────────────────────────

export async function runWordpressDataIntegrityInventory(args = {}) {
  const { plan = {} } = args;
  if (!plan.enabled) return { skipped: true, inventory_rows: [] };

  const inventoryRows = [];
  const scannedAt = new Date().toISOString();

  const scopes = [
    plan.include_post_count_reconciliation && { scope: "post_count", label: "Post Count Reconciliation" },
    plan.include_media_reconciliation && { scope: "media", label: "Media Reconciliation" },
    plan.include_taxonomy_reconciliation && { scope: "taxonomy", label: "Taxonomy Reconciliation" },
    plan.include_user_reconciliation && { scope: "users", label: "User Reconciliation" },
    plan.include_meta_reconciliation && { scope: "meta", label: "Meta Reconciliation" },
    plan.include_settings_reconciliation && { scope: "settings", label: "Settings Reconciliation" }
  ].filter(Boolean);

  for (const { scope, label } of scopes) {
    inventoryRows.push({
      scope,
      label,
      source_site: plan.source_site,
      target_site: plan.target_site,
      source_count: null,
      target_count: null,
      drift_count: null,
      drift_percent: null,
      within_tolerance: null,
      status: "pending_scan"
    });
  }

  return {
    skipped: false,
    source_site: plan.source_site,
    target_site: plan.target_site,
    scanned_at: scannedAt,
    inventory_rows: inventoryRows,
    scope_count: inventoryRows.length
  };
}

export function buildWordpressPhaseNNormalizedInventory(inventoryResult = {}) {
  if (inventoryResult.skipped) {
    return {
      skipped: true,
      normalized_integrity_scope_rows: [],
      normalized_drift_rows: []
    };
  }

  const normalizedIntegrityScopeRows = (inventoryResult.inventory_rows || []).map(row => ({
    scope: String(row.scope || ""),
    label: String(row.label || ""),
    source_site: String(row.source_site || ""),
    target_site: String(row.target_site || ""),
    source_count: row.source_count !== null ? Number(row.source_count) : null,
    target_count: row.target_count !== null ? Number(row.target_count) : null,
    drift_count: row.drift_count !== null ? Number(row.drift_count) : null,
    drift_percent: row.drift_percent !== null ? Number(row.drift_percent) : null,
    within_tolerance: row.within_tolerance,
    status: String(row.status || "pending_scan")
  }));

  const normalizedDriftRows = normalizedIntegrityScopeRows
    .filter(r => r.drift_count !== null && r.drift_count > 0)
    .map(r => ({
      scope: r.scope,
      source_site: r.source_site,
      target_site: r.target_site,
      drift_count: r.drift_count,
      drift_percent: r.drift_percent,
      within_tolerance: r.within_tolerance,
      requires_repair: r.within_tolerance === false
    }));

  return {
    skipped: false,
    normalized_integrity_scope_rows: normalizedIntegrityScopeRows,
    normalized_drift_rows: normalizedDriftRows,
    total_scopes: normalizedIntegrityScopeRows.length,
    total_drift_items: normalizedDriftRows.length,
    out_of_tolerance_count: normalizedDriftRows.filter(r => !r.within_tolerance).length
  };
}

// ── N.3 Readiness Gate ────────────────────────────────────────────────────────

export function buildWordpressPhaseNReadinessGate(args = {}) {
  const { plan = {}, normalizedInventory = {} } = args;
  if (!plan.enabled || normalizedInventory.skipped) {
    return { gate_open: true, skipped: true, readiness_status: "skipped" };
  }

  const scopeRows = normalizedInventory.normalized_integrity_scope_rows || [];
  const failedScopes = scopeRows.filter(r => r.status === "error");
  const outOfTolerance = (normalizedInventory.out_of_tolerance_count || 0);

  const blockers = [];
  if (failedScopes.length > 0) {
    blockers.push(`${failedScopes.length} integrity scope(s) errored during scan`);
  }

  const warnings = outOfTolerance > 0
    ? [`${outOfTolerance} scope(s) exceed drift tolerance of ${plan.drift_tolerance_percent}%`]
    : [];

  return {
    gate_open: blockers.length === 0,
    readiness_status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    warnings,
    scope_count: scopeRows.length,
    out_of_tolerance_count: outOfTolerance,
    failed_scope_count: failedScopes.length,
    drift_tolerance_percent: plan.drift_tolerance_percent
  };
}

export function buildWordpressPhaseNSafeCandidates(args = {}) {
  const { plan = {}, normalizedInventory = {}, readinessGate = {} } = args;
  if (!plan.enabled || !readinessGate.gate_open) {
    return { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  }

  const scopeRows = normalizedInventory.normalized_integrity_scope_rows || [];

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
    total_unsafe: unsafeCandidates.length,
    repair_needed_count: safeCandidates.filter(r => r.within_tolerance === false).length
  };
}

// ── N.4 Reconciliation Planner ────────────────────────────────────────────────

export function buildWordpressPhaseNReconciliationPayloadPlanner(args = {}) {
  const { plan = {}, safeCandidates = {}, normalizedInventory = {} } = args;
  if (!plan.enabled) {
    return { skipped: true, reconciliation_items: [] };
  }

  const candidates = safeCandidates.safe_candidates || [];

  const reconciliationItems = candidates.map(candidate => {
    const requiresRepair = candidate.within_tolerance === false;
    return {
      scope: candidate.scope,
      source_site: candidate.source_site,
      target_site: candidate.target_site,
      action: plan.apply && plan.auto_repair && requiresRepair ? "repair" : "verify_only",
      drift_count: candidate.drift_count,
      drift_percent: candidate.drift_percent,
      within_tolerance: candidate.within_tolerance,
      drift_tolerance_percent: plan.drift_tolerance_percent,
      requires_confirmation: plan.apply === true && requiresRepair
    };
  });

  return {
    skipped: false,
    reconciliation_items: reconciliationItems,
    total_items: reconciliationItems.length,
    repair_items: reconciliationItems.filter(r => r.action === "repair").length,
    verify_only_items: reconciliationItems.filter(r => r.action === "verify_only").length,
    apply_mode: plan.apply,
    auto_repair: plan.auto_repair
  };
}

// ── N.5 Execution Plan ────────────────────────────────────────────────────────

export function resolveWordpressPhaseNExecutionPlan(args = {}) {
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
    drift_count: item.drift_count,
    drift_percent: item.drift_percent,
    within_tolerance: item.within_tolerance,
    status: "pending",
    error: null
  }));

  return {
    skipped: false,
    execution_steps: executionSteps,
    total_steps: executionSteps.length,
    repair_steps: executionSteps.filter(s => s.action === "repair").length,
    apply_mode: plan.apply,
    estimated_duration_minutes: executionSteps.length * 3
  };
}

export function buildWordpressPhaseNExecutionGuard(args = {}) {
  const { plan = {}, executionPlan = {}, safeCandidates = {} } = args;
  if (!plan.enabled || executionPlan.skipped) {
    return { guard_passed: true, skipped: true };
  }

  const violations = [];

  if (plan.apply && (safeCandidates.total_safe || 0) === 0) {
    violations.push("apply=true but no safe integrity candidates found");
  }
  if (plan.apply && plan.auto_repair && !plan.target_site) {
    violations.push("auto_repair=true but target_site is missing");
  }
  if ((executionPlan.repair_steps || 0) > 100) {
    violations.push(`too many repair steps: ${executionPlan.repair_steps} (max 100)`);
  }

  return {
    guard_passed: violations.length === 0,
    violations,
    step_count: executionPlan.total_steps || 0,
    repair_step_count: executionPlan.repair_steps || 0,
    apply_mode: plan.apply,
    auto_repair: plan.auto_repair
  };
}

// ── N.6 Mutation Candidate Selector ───────────────────────────────────────────

export function buildWordpressPhaseNMutationCandidateSelector(args = {}) {
  const { plan = {}, executionPlan = {}, executionGuard = {} } = args;
  if (!plan.enabled || !executionGuard.guard_passed || executionPlan.skipped) {
    return { selected_mutations: [], total_selected: 0, blocked: true };
  }

  const steps = executionPlan.execution_steps || [];
  const selectedMutations = steps.filter(s => s.action === "repair");

  return {
    selected_mutations: selectedMutations,
    total_selected: selectedMutations.length,
    blocked: false,
    verify_only_count: steps.filter(s => s.action === "verify_only").length,
    out_of_tolerance_count: steps.filter(s => !s.within_tolerance).length
  };
}

export function buildWordpressPhaseNMutationCandidateArtifact(selectorResult = {}) {
  return {
    mutations: selectorResult.selected_mutations || [],
    total: selectorResult.total_selected || 0,
    blocked: selectorResult.blocked === true,
    verify_only_count: selectorResult.verify_only_count || 0,
    out_of_tolerance_count: selectorResult.out_of_tolerance_count || 0,
    generated_at: new Date().toISOString()
  };
}

// ── N.7 Mutation Payload Composer ─────────────────────────────────────────────

export function buildWordpressPhaseNMutationPayloadComposer(args = {}) {
  const { plan = {}, mutationCandidateArtifact = {} } = args;
  if (mutationCandidateArtifact.blocked || (mutationCandidateArtifact.total || 0) === 0) {
    return { payloads: [], total_payloads: 0, skipped: true };
  }

  const mutations = mutationCandidateArtifact.mutations || [];

  const payloads = mutations.map(m => ({
    scope: m.scope,
    source_site: m.source_site,
    target_site: m.target_site,
    operation: "integrity_repair",
    drift_count: m.drift_count,
    drift_percent: m.drift_percent,
    payload_version: "1.0",
    created_at: new Date().toISOString()
  }));

  return {
    payloads,
    total_payloads: payloads.length,
    skipped: false,
    apply_mode: plan.apply,
    auto_repair: plan.auto_repair
  };
}

export function buildWordpressPhaseNMutationPayloadArtifact(composerResult = {}) {
  return {
    payloads: composerResult.payloads || [],
    total: composerResult.total_payloads || 0,
    skipped: composerResult.skipped === true,
    apply_mode: composerResult.apply_mode === true,
    auto_repair: composerResult.auto_repair === true,
    generated_at: new Date().toISOString()
  };
}

// ── N.8 Dry Run Execution Simulator ───────────────────────────────────────────

export function simulateWordpressDataIntegrityDryRunRow(args = {}) {
  const { payload = {}, rowIndex = 0 } = args;

  const wouldSucceed =
    Boolean(payload.scope) &&
    Boolean(payload.source_site) &&
    Boolean(payload.target_site);

  return {
    row_index: rowIndex,
    scope: payload.scope,
    source_site: payload.source_site,
    target_site: payload.target_site,
    operation: payload.operation,
    drift_count: payload.drift_count,
    would_succeed: wouldSucceed,
    simulated_error: wouldSucceed ? null : "missing required integrity repair parameters",
    simulated_duration_seconds: wouldSucceed ? 10 + rowIndex * 3 : 0
  };
}

export function buildWordpressPhaseNDryRunExecutionSimulator(args = {}) {
  const { plan = {}, mutationPayloadArtifact = {} } = args;
  if (mutationPayloadArtifact.skipped || !plan.enabled) {
    return { skipped: true, dry_run_rows: [], summary: {} };
  }

  const payloads = mutationPayloadArtifact.payloads || [];
  const dryRunRows = payloads.map((payload, idx) =>
    simulateWordpressDataIntegrityDryRunRow({ payload, rowIndex: idx })
  );

  const successCount = dryRunRows.filter(r => r.would_succeed).length;
  const failCount = dryRunRows.length - successCount;
  const totalDriftRepaired = dryRunRows
    .filter(r => r.would_succeed)
    .reduce((acc, r) => acc + (r.drift_count || 0), 0);

  return {
    skipped: false,
    dry_run_rows: dryRunRows,
    summary: {
      total: dryRunRows.length,
      would_succeed: successCount,
      would_fail: failCount,
      total_drift_items_repaired: totalDriftRepaired,
      estimated_total_duration_seconds: dryRunRows.reduce(
        (acc, r) => acc + (r.simulated_duration_seconds || 0), 0
      )
    }
  };
}

export function buildWordpressPhaseNDryRunExecutionArtifact(simulatorResult = {}) {
  return {
    skipped: simulatorResult.skipped === true,
    dry_run_rows: simulatorResult.dry_run_rows || [],
    summary: simulatorResult.summary || {},
    generated_at: new Date().toISOString()
  };
}

// ── N.9 Final Operator Handoff Bundle ─────────────────────────────────────────

export function buildWordpressPhaseNFinalOperatorHandoffBundle(args = {}) {
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
    phase: "N",
    phase_name: "Data Integrity / Reconciliation Controls",
    enabled,
    overall_status: overallStatus,
    gate_open: gateOpen,
    readiness_status: readinessStatus,
    guard_passed: guardPassed,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      drift_tolerance_percent: plan.drift_tolerance_percent,
      auto_repair: plan.auto_repair,
      scopes: [
        plan.include_post_count_reconciliation && "post_count",
        plan.include_media_reconciliation && "media",
        plan.include_taxonomy_reconciliation && "taxonomy",
        plan.include_user_reconciliation && "users",
        plan.include_meta_reconciliation && "meta",
        plan.include_settings_reconciliation && "settings"
      ].filter(Boolean),
      apply_mode: plan.apply
    },
    inventory_summary: {
      total_scopes: normalizedInventory.total_scopes || 0,
      total_drift_items: normalizedInventory.total_drift_items || 0,
      out_of_tolerance_count: normalizedInventory.out_of_tolerance_count || 0
    },
    safe_candidate_count: safeCandidates.total_safe || 0,
    unsafe_candidate_count: safeCandidates.total_unsafe || 0,
    repair_needed_count: safeCandidates.repair_needed_count || 0,
    reconciliation_item_count: reconciliationPlanner.total_items || 0,
    repair_items: reconciliationPlanner.repair_items || 0,
    execution_step_count: executionPlan.total_steps || 0,
    mutation_count: mutationCandidateArtifact.total || 0,
    payload_count: mutationPayloadArtifact.total || 0,
    dry_run_summary: dryRunSummary,
    warnings: readinessGate.warnings || [],
    blockers: [
      ...(gate.blockers || []),
      ...(readinessGate.blockers || []),
      ...(executionGuard.violations || [])
    ],
    generated_at: new Date().toISOString()
  };
}
