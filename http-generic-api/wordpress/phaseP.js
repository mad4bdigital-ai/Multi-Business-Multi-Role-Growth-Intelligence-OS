// Phase P — Final Orchestration / Production Readiness / Cutover surfaces

// ── P.1 Plan Resolution ───────────────────────────────────────────────────────

export function resolveWordpressPhasePPlan(payload = {}) {
  const migration = payload?.migration || {};
  const cutover =
    migration.production_cutover &&
    typeof migration.production_cutover === "object"
      ? migration.production_cutover
      : {};

  return {
    enabled: cutover.enabled === true,
    inventory_only:
      cutover.inventory_only === undefined ? true : cutover.inventory_only === true,
    apply: cutover.apply === true,
    include_dns_cutover: cutover.include_dns_cutover === undefined ? true : cutover.include_dns_cutover === true,
    include_ssl_verification: cutover.include_ssl_verification === undefined ? true : cutover.include_ssl_verification === true,
    include_cdn_flush: cutover.include_cdn_flush === undefined ? true : cutover.include_cdn_flush === true,
    include_monitoring_handoff: cutover.include_monitoring_handoff === undefined ? true : cutover.include_monitoring_handoff === true,
    include_stakeholder_notification: cutover.include_stakeholder_notification === undefined ? false : cutover.include_stakeholder_notification === true,
    require_all_phases_complete: cutover.require_all_phases_complete === undefined ? true : cutover.require_all_phases_complete === true,
    cutover_window_minutes: Number(cutover.cutover_window_minutes) || 60,
    rollback_window_hours: Number(cutover.rollback_window_hours) || 24,
    source_site: String(cutover.source_site || "").trim(),
    target_site: String(cutover.target_site || "").trim(),
    production_domain: String(cutover.production_domain || "").trim()
  };
}

export function assertWordpressPhasePPlan(plan = {}) {
  if (!plan.enabled) return;
  if (!plan.source_site) throw new Error("Phase P: source_site is required");
  if (!plan.target_site) throw new Error("Phase P: target_site is required");
  if (!plan.production_domain) throw new Error("Phase P: production_domain is required");
  if (plan.cutover_window_minutes < 15 || plan.cutover_window_minutes > 480) {
    throw new Error("Phase P: cutover_window_minutes must be between 15 and 480");
  }
  if (plan.rollback_window_hours < 1 || plan.rollback_window_hours > 168) {
    throw new Error("Phase P: rollback_window_hours must be between 1 and 168");
  }
}

export function buildWordpressPhasePGate(args = {}) {
  const { plan = {}, priorPhaseStatus = {} } = args;
  const blockers = [];

  if (!plan.enabled) {
    return { gate_open: true, skipped: true, reason: "Phase P disabled in plan" };
  }
  if (!plan.source_site) blockers.push("source_site missing");
  if (!plan.target_site) blockers.push("target_site missing");
  if (!plan.production_domain) blockers.push("production_domain missing");

  if (plan.require_all_phases_complete) {
    const requiredPhases = [
      { key: "phase_l", label: "Phase L (Backup/Recovery)" },
      { key: "phase_m", label: "Phase M (Deployment)" },
      { key: "phase_n", label: "Phase N (Data Integrity)" },
      { key: "phase_o", label: "Phase O (QA/Acceptance)" }
    ];
    for (const { key, label } of requiredPhases) {
      const status = priorPhaseStatus[`${key}_status`];
      if (priorPhaseStatus[`${key}_enabled`] && status !== "ready_for_execution" && status !== "skipped") {
        blockers.push(`${label} not in verified state (current: ${status || "unknown"})`);
      }
    }
  }

  return {
    gate_open: blockers.length === 0,
    blockers,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      production_domain: plan.production_domain,
      cutover_window_minutes: plan.cutover_window_minutes,
      rollback_window_hours: plan.rollback_window_hours,
      scopes: [
        plan.include_dns_cutover && "dns_cutover",
        plan.include_ssl_verification && "ssl_verification",
        plan.include_cdn_flush && "cdn_flush",
        plan.include_monitoring_handoff && "monitoring_handoff",
        plan.include_stakeholder_notification && "stakeholder_notification"
      ].filter(Boolean)
    }
  };
}

// ── P.2 Inventory ─────────────────────────────────────────────────────────────

export async function runWordpressProductionCutoverInventory(args = {}) {
  const { plan = {} } = args;
  if (!plan.enabled) return { skipped: true, inventory_rows: [] };

  const inventoryRows = [];
  const scannedAt = new Date().toISOString();

  const scopes = [
    plan.include_dns_cutover && { scope: "dns_cutover", label: "DNS Cutover", criticality: "critical" },
    plan.include_ssl_verification && { scope: "ssl_verification", label: "SSL Certificate Verification", criticality: "critical" },
    plan.include_cdn_flush && { scope: "cdn_flush", label: "CDN Cache Flush", criticality: "high" },
    plan.include_monitoring_handoff && { scope: "monitoring_handoff", label: "Monitoring Handoff", criticality: "high" },
    plan.include_stakeholder_notification && { scope: "stakeholder_notification", label: "Stakeholder Notification", criticality: "medium" }
  ].filter(Boolean);

  for (const { scope, label, criticality } of scopes) {
    inventoryRows.push({
      scope,
      label,
      criticality,
      source_site: plan.source_site,
      target_site: plan.target_site,
      production_domain: plan.production_domain,
      current_state: null,
      target_state: null,
      estimated_downtime_seconds: null,
      status: "pending_scan"
    });
  }

  return {
    skipped: false,
    source_site: plan.source_site,
    target_site: plan.target_site,
    production_domain: plan.production_domain,
    scanned_at: scannedAt,
    inventory_rows: inventoryRows,
    scope_count: inventoryRows.length
  };
}

export function buildWordpressPhasePNormalizedInventory(inventoryResult = {}) {
  if (inventoryResult.skipped) {
    return {
      skipped: true,
      normalized_cutover_scope_rows: [],
      normalized_risk_rows: []
    };
  }

  const normalizedCutoverScopeRows = (inventoryResult.inventory_rows || []).map(row => ({
    scope: String(row.scope || ""),
    label: String(row.label || ""),
    criticality: String(row.criticality || "medium"),
    source_site: String(row.source_site || ""),
    target_site: String(row.target_site || ""),
    production_domain: String(row.production_domain || ""),
    current_state: row.current_state,
    target_state: row.target_state,
    estimated_downtime_seconds: row.estimated_downtime_seconds !== null ? Number(row.estimated_downtime_seconds) : null,
    status: String(row.status || "pending_scan")
  }));

  const normalizedRiskRows = normalizedCutoverScopeRows
    .filter(r => r.criticality === "critical")
    .map(r => ({
      scope: r.scope,
      label: r.label,
      production_domain: r.production_domain,
      estimated_downtime_seconds: r.estimated_downtime_seconds,
      status: r.status
    }));

  const totalEstimatedDowntime = normalizedCutoverScopeRows
    .filter(r => r.estimated_downtime_seconds !== null)
    .reduce((acc, r) => acc + (r.estimated_downtime_seconds || 0), 0);

  return {
    skipped: false,
    normalized_cutover_scope_rows: normalizedCutoverScopeRows,
    normalized_risk_rows: normalizedRiskRows,
    total_scopes: normalizedCutoverScopeRows.length,
    critical_scope_count: normalizedRiskRows.length,
    total_estimated_downtime_seconds: totalEstimatedDowntime
  };
}

// ── P.3 Readiness Gate ────────────────────────────────────────────────────────

export function buildWordpressPhasePReadinessGate(args = {}) {
  const { plan = {}, normalizedInventory = {} } = args;
  if (!plan.enabled || normalizedInventory.skipped) {
    return { gate_open: true, skipped: true, readiness_status: "skipped" };
  }

  const scopeRows = normalizedInventory.normalized_cutover_scope_rows || [];
  const failedScopes = scopeRows.filter(r => r.status === "error");
  const totalDowntime = normalizedInventory.total_estimated_downtime_seconds || 0;

  const blockers = [];
  if (failedScopes.length > 0) {
    blockers.push(`${failedScopes.length} cutover scope(s) errored during scan`);
  }
  if (plan.include_dns_cutover && !scopeRows.find(r => r.scope === "dns_cutover")) {
    blockers.push("dns_cutover scope missing from inventory");
  }

  const warnings = [];
  if (totalDowntime > 300) {
    warnings.push(`Estimated downtime ${Math.round(totalDowntime / 60)}m — exceeds 5-minute SLA`);
  }

  return {
    gate_open: blockers.length === 0,
    readiness_status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    warnings,
    scope_count: scopeRows.length,
    critical_scope_count: normalizedInventory.critical_scope_count || 0,
    failed_scope_count: failedScopes.length,
    total_estimated_downtime_seconds: totalDowntime,
    cutover_window_minutes: plan.cutover_window_minutes
  };
}

export function buildWordpressPhasePSafeCandidates(args = {}) {
  const { plan = {}, normalizedInventory = {}, readinessGate = {} } = args;
  if (!plan.enabled || !readinessGate.gate_open) {
    return { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  }

  const scopeRows = normalizedInventory.normalized_cutover_scope_rows || [];

  const safeCandidates = scopeRows.filter(r =>
    r.status !== "error" && r.scope && r.production_domain
  );
  const unsafeCandidates = scopeRows.filter(r =>
    r.status === "error" || !r.scope || !r.production_domain
  );

  return {
    safe_candidates: safeCandidates,
    unsafe_candidates: unsafeCandidates,
    total_safe: safeCandidates.length,
    total_unsafe: unsafeCandidates.length,
    critical_safe_count: safeCandidates.filter(r => r.criticality === "critical").length
  };
}

// ── P.4 Reconciliation Planner ────────────────────────────────────────────────

export function buildWordpressPhasePReconciliationPayloadPlanner(args = {}) {
  const { plan = {}, safeCandidates = {}, normalizedInventory = {} } = args;
  if (!plan.enabled) {
    return { skipped: true, reconciliation_items: [] };
  }

  const candidates = safeCandidates.safe_candidates || [];

  const criticalityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const reconciliationItems = [...candidates]
    .sort((a, b) => (criticalityOrder[a.criticality] || 2) - (criticalityOrder[b.criticality] || 2))
    .map(candidate => ({
      scope: candidate.scope,
      label: candidate.label,
      criticality: candidate.criticality,
      source_site: candidate.source_site,
      target_site: candidate.target_site,
      production_domain: candidate.production_domain,
      action: plan.apply ? "execute_cutover" : "verify_only",
      estimated_downtime_seconds: candidate.estimated_downtime_seconds,
      rollback_window_hours: plan.rollback_window_hours,
      requires_confirmation: plan.apply === true && candidate.criticality === "critical"
    }));

  return {
    skipped: false,
    reconciliation_items: reconciliationItems,
    total_items: reconciliationItems.length,
    critical_items: reconciliationItems.filter(r => r.criticality === "critical").length,
    apply_items: reconciliationItems.filter(r => r.action === "execute_cutover").length,
    verify_only_items: reconciliationItems.filter(r => r.action === "verify_only").length,
    apply_mode: plan.apply,
    total_estimated_downtime_seconds: reconciliationItems
      .filter(r => r.estimated_downtime_seconds !== null)
      .reduce((acc, r) => acc + (r.estimated_downtime_seconds || 0), 0)
  };
}

// ── P.5 Execution Plan ────────────────────────────────────────────────────────

export function resolveWordpressPhasePExecutionPlan(args = {}) {
  const { plan = {}, reconciliationPlanner = {} } = args;
  if (!plan.enabled || reconciliationPlanner.skipped) {
    return { skipped: true, execution_steps: [], total_steps: 0 };
  }

  const items = reconciliationPlanner.reconciliation_items || [];

  const executionSteps = items.map((item, idx) => ({
    step_index: idx + 1,
    scope: item.scope,
    label: item.label,
    criticality: item.criticality,
    production_domain: item.production_domain,
    action: item.action,
    estimated_downtime_seconds: item.estimated_downtime_seconds,
    rollback_window_hours: item.rollback_window_hours,
    status: "pending",
    error: null,
    completed_at: null
  }));

  return {
    skipped: false,
    execution_steps: executionSteps,
    total_steps: executionSteps.length,
    critical_steps: executionSteps.filter(s => s.criticality === "critical").length,
    apply_mode: plan.apply,
    estimated_total_duration_minutes: Math.ceil(
      executionSteps.reduce((acc, s) => acc + ((s.estimated_downtime_seconds || 30) / 60), 0)
    )
  };
}

export function buildWordpressPhasePExecutionGuard(args = {}) {
  const { plan = {}, executionPlan = {}, safeCandidates = {} } = args;
  if (!plan.enabled || executionPlan.skipped) {
    return { guard_passed: true, skipped: true };
  }

  const violations = [];

  if (plan.apply && (safeCandidates.total_safe || 0) === 0) {
    violations.push("apply=true but no safe cutover candidates found");
  }
  if (plan.apply && !plan.production_domain) {
    violations.push("apply=true but production_domain is missing");
  }
  if (plan.apply && plan.include_dns_cutover && (safeCandidates.critical_safe_count || 0) === 0) {
    violations.push("dns_cutover required but no critical scope candidates available");
  }

  return {
    guard_passed: violations.length === 0,
    violations,
    step_count: executionPlan.total_steps || 0,
    critical_step_count: executionPlan.critical_steps || 0,
    estimated_total_duration_minutes: executionPlan.estimated_total_duration_minutes || 0,
    apply_mode: plan.apply
  };
}

// ── P.6 Mutation Candidate Selector ───────────────────────────────────────────

export function buildWordpressPhasePMutationCandidateSelector(args = {}) {
  const { plan = {}, executionPlan = {}, executionGuard = {} } = args;
  if (!plan.enabled || !executionGuard.guard_passed || executionPlan.skipped) {
    return { selected_mutations: [], total_selected: 0, blocked: true };
  }

  const steps = executionPlan.execution_steps || [];
  const selectedMutations = steps.filter(s => s.action === "execute_cutover");

  return {
    selected_mutations: selectedMutations,
    total_selected: selectedMutations.length,
    blocked: false,
    verify_only_count: steps.filter(s => s.action === "verify_only").length,
    critical_count: selectedMutations.filter(s => s.criticality === "critical").length
  };
}

export function buildWordpressPhasePMutationCandidateArtifact(selectorResult = {}) {
  return {
    mutations: selectorResult.selected_mutations || [],
    total: selectorResult.total_selected || 0,
    blocked: selectorResult.blocked === true,
    verify_only_count: selectorResult.verify_only_count || 0,
    critical_count: selectorResult.critical_count || 0,
    generated_at: new Date().toISOString()
  };
}

// ── P.7 Mutation Payload Composer ─────────────────────────────────────────────

export function buildWordpressPhasePMutationPayloadComposer(args = {}) {
  const { plan = {}, mutationCandidateArtifact = {} } = args;
  if (mutationCandidateArtifact.blocked || (mutationCandidateArtifact.total || 0) === 0) {
    return { payloads: [], total_payloads: 0, skipped: true };
  }

  const mutations = mutationCandidateArtifact.mutations || [];

  const payloads = mutations.map(m => ({
    scope: m.scope,
    label: m.label,
    criticality: m.criticality,
    production_domain: m.production_domain,
    source_site: m.source_site,
    target_site: m.target_site,
    operation: "cutover_execute",
    rollback_window_hours: plan.rollback_window_hours,
    cutover_window_minutes: plan.cutover_window_minutes,
    payload_version: "1.0",
    created_at: new Date().toISOString()
  }));

  return {
    payloads,
    total_payloads: payloads.length,
    skipped: false,
    apply_mode: plan.apply,
    production_domain: plan.production_domain
  };
}

export function buildWordpressPhasePMutationPayloadArtifact(composerResult = {}) {
  return {
    payloads: composerResult.payloads || [],
    total: composerResult.total_payloads || 0,
    skipped: composerResult.skipped === true,
    apply_mode: composerResult.apply_mode === true,
    production_domain: composerResult.production_domain || "",
    generated_at: new Date().toISOString()
  };
}

// ── P.8 Dry Run Execution Simulator ───────────────────────────────────────────

export function simulateWordpressProductionCutoverDryRunRow(args = {}) {
  const { payload = {}, rowIndex = 0 } = args;

  const wouldSucceed =
    Boolean(payload.scope) &&
    Boolean(payload.production_domain) &&
    Boolean(payload.target_site);

  const isCritical = payload.criticality === "critical";

  return {
    row_index: rowIndex,
    scope: payload.scope,
    label: payload.label,
    criticality: payload.criticality,
    production_domain: payload.production_domain,
    operation: payload.operation,
    would_succeed: wouldSucceed,
    is_critical: isCritical,
    simulated_error: wouldSucceed ? null : "missing required cutover parameters",
    simulated_downtime_seconds: wouldSucceed ? (isCritical ? 60 + rowIndex * 15 : 10 + rowIndex * 5) : 0,
    rollback_available: wouldSucceed && Boolean(payload.rollback_window_hours)
  };
}

export function buildWordpressPhasePDryRunExecutionSimulator(args = {}) {
  const { plan = {}, mutationPayloadArtifact = {} } = args;
  if (mutationPayloadArtifact.skipped || !plan.enabled) {
    return { skipped: true, dry_run_rows: [], summary: {} };
  }

  const payloads = mutationPayloadArtifact.payloads || [];
  const dryRunRows = payloads.map((payload, idx) =>
    simulateWordpressProductionCutoverDryRunRow({ payload, rowIndex: idx })
  );

  const successCount = dryRunRows.filter(r => r.would_succeed).length;
  const failCount = dryRunRows.length - successCount;
  const criticalSuccessCount = dryRunRows.filter(r => r.would_succeed && r.is_critical).length;
  const rollbackAvailableCount = dryRunRows.filter(r => r.rollback_available).length;
  const totalDowntime = dryRunRows.reduce(
    (acc, r) => acc + (r.simulated_downtime_seconds || 0), 0
  );

  return {
    skipped: false,
    dry_run_rows: dryRunRows,
    summary: {
      total: dryRunRows.length,
      would_succeed: successCount,
      would_fail: failCount,
      critical_success_count: criticalSuccessCount,
      rollback_available_count: rollbackAvailableCount,
      total_simulated_downtime_seconds: totalDowntime,
      cutover_feasible: failCount === 0 && criticalSuccessCount === dryRunRows.filter(r => r.is_critical).length
    }
  };
}

export function buildWordpressPhasePDryRunExecutionArtifact(simulatorResult = {}) {
  return {
    skipped: simulatorResult.skipped === true,
    dry_run_rows: simulatorResult.dry_run_rows || [],
    summary: simulatorResult.summary || {},
    generated_at: new Date().toISOString()
  };
}

// ── P.9 Final Operator Handoff Bundle ─────────────────────────────────────────

export function buildWordpressPhasePFinalOperatorHandoffBundle(args = {}) {
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
  const cutoverFeasible = dryRunSummary.cutover_feasible === true;

  const overallStatus =
    !enabled ? "skipped" :
    !gateOpen ? "gate_blocked" :
    readinessStatus === "blocked" ? "readiness_blocked" :
    !guardPassed ? "guard_blocked" :
    dryRunArtifact.skipped ? "dry_run_skipped" :
    (dryRunSummary.would_fail || 0) > 0 ? "dry_run_failures" :
    !cutoverFeasible ? "cutover_not_feasible" :
    "ready_for_execution";

  return {
    phase: "P",
    phase_name: "Final Orchestration / Production Readiness / Cutover",
    enabled,
    overall_status: overallStatus,
    gate_open: gateOpen,
    readiness_status: readinessStatus,
    guard_passed: guardPassed,
    cutover_feasible: cutoverFeasible,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      production_domain: plan.production_domain,
      cutover_window_minutes: plan.cutover_window_minutes,
      rollback_window_hours: plan.rollback_window_hours,
      require_all_phases_complete: plan.require_all_phases_complete,
      scopes: [
        plan.include_dns_cutover && "dns_cutover",
        plan.include_ssl_verification && "ssl_verification",
        plan.include_cdn_flush && "cdn_flush",
        plan.include_monitoring_handoff && "monitoring_handoff",
        plan.include_stakeholder_notification && "stakeholder_notification"
      ].filter(Boolean),
      apply_mode: plan.apply
    },
    inventory_summary: {
      total_scopes: normalizedInventory.total_scopes || 0,
      critical_scope_count: normalizedInventory.critical_scope_count || 0,
      total_estimated_downtime_seconds: normalizedInventory.total_estimated_downtime_seconds || 0
    },
    safe_candidate_count: safeCandidates.total_safe || 0,
    unsafe_candidate_count: safeCandidates.total_unsafe || 0,
    critical_safe_count: safeCandidates.critical_safe_count || 0,
    reconciliation_item_count: reconciliationPlanner.total_items || 0,
    critical_reconciliation_items: reconciliationPlanner.critical_items || 0,
    execution_step_count: executionPlan.total_steps || 0,
    estimated_total_duration_minutes: executionPlan.estimated_total_duration_minutes || 0,
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
