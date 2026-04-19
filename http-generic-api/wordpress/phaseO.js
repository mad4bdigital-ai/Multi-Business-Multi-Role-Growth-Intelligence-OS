// Phase O — Quality Assurance / Smoke Tests / Acceptance surfaces

// ── O.1 Plan Resolution ───────────────────────────────────────────────────────

export function resolveWordpressPhaseOPlan(payload = {}) {
  const migration = payload?.migration || {};
  const qa =
    migration.qa_acceptance &&
    typeof migration.qa_acceptance === "object"
      ? migration.qa_acceptance
      : {};

  return {
    enabled: qa.enabled === true,
    inventory_only:
      qa.inventory_only === undefined ? true : qa.inventory_only === true,
    apply: qa.apply === true,
    include_smoke_tests: qa.include_smoke_tests === undefined ? true : qa.include_smoke_tests === true,
    include_content_spot_checks: qa.include_content_spot_checks === undefined ? true : qa.include_content_spot_checks === true,
    include_form_validation: qa.include_form_validation === undefined ? false : qa.include_form_validation === true,
    include_redirect_checks: qa.include_redirect_checks === undefined ? true : qa.include_redirect_checks === true,
    include_performance_checks: qa.include_performance_checks === undefined ? false : qa.include_performance_checks === true,
    include_seo_checks: qa.include_seo_checks === undefined ? true : qa.include_seo_checks === true,
    include_analytics_checks: qa.include_analytics_checks === undefined ? false : qa.include_analytics_checks === true,
    acceptance_threshold_percent: Number(qa.acceptance_threshold_percent) || 95,
    block_on_failure: qa.block_on_failure === undefined ? true : qa.block_on_failure === true,
    source_site: String(qa.source_site || "").trim(),
    target_site: String(qa.target_site || "").trim()
  };
}

export function assertWordpressPhaseOPlan(plan = {}) {
  if (!plan.enabled) return;
  if (!plan.source_site) throw new Error("Phase O: source_site is required");
  if (!plan.target_site) throw new Error("Phase O: target_site is required");
  if (plan.acceptance_threshold_percent < 50 || plan.acceptance_threshold_percent > 100) {
    throw new Error("Phase O: acceptance_threshold_percent must be between 50 and 100");
  }
  if (!plan.include_smoke_tests && !plan.include_content_spot_checks && !plan.include_redirect_checks) {
    throw new Error("Phase O: at least one QA check type must be enabled");
  }
}

export function buildWordpressPhaseOGate(args = {}) {
  const { plan = {}, priorPhaseStatus = {} } = args;
  const blockers = [];

  if (!plan.enabled) {
    return { gate_open: true, skipped: true, reason: "Phase O disabled in plan" };
  }
  if (!plan.source_site) blockers.push("source_site missing");
  if (!plan.target_site) blockers.push("target_site missing");
  if (priorPhaseStatus.phase_n_enabled && priorPhaseStatus.phase_n_status !== "ready_for_execution" && priorPhaseStatus.phase_n_status !== "skipped") {
    blockers.push("Phase N data integrity not verified");
  }

  return {
    gate_open: blockers.length === 0,
    blockers,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      acceptance_threshold_percent: plan.acceptance_threshold_percent,
      block_on_failure: plan.block_on_failure,
      checks: [
        plan.include_smoke_tests && "smoke_tests",
        plan.include_content_spot_checks && "content_spot_checks",
        plan.include_form_validation && "form_validation",
        plan.include_redirect_checks && "redirect_checks",
        plan.include_performance_checks && "performance_checks",
        plan.include_seo_checks && "seo_checks",
        plan.include_analytics_checks && "analytics_checks"
      ].filter(Boolean)
    }
  };
}

// ── O.2 Inventory ─────────────────────────────────────────────────────────────

export async function runWordpressQaAcceptanceInventory(args = {}) {
  const { plan = {} } = args;
  if (!plan.enabled) return { skipped: true, inventory_rows: [] };

  const inventoryRows = [];
  const scannedAt = new Date().toISOString();

  const checks = [
    plan.include_smoke_tests && { check: "smoke_tests", label: "Smoke Test Suite", priority: "critical" },
    plan.include_content_spot_checks && { check: "content_spot_checks", label: "Content Spot Checks", priority: "high" },
    plan.include_form_validation && { check: "form_validation", label: "Form Validation", priority: "high" },
    plan.include_redirect_checks && { check: "redirect_checks", label: "Redirect Chain Checks", priority: "medium" },
    plan.include_performance_checks && { check: "performance_checks", label: "Performance Baseline Checks", priority: "medium" },
    plan.include_seo_checks && { check: "seo_checks", label: "SEO Meta Checks", priority: "medium" },
    plan.include_analytics_checks && { check: "analytics_checks", label: "Analytics Tag Checks", priority: "low" }
  ].filter(Boolean);

  for (const { check, label, priority } of checks) {
    inventoryRows.push({
      check,
      label,
      priority,
      source_site: plan.source_site,
      target_site: plan.target_site,
      test_cases_available: 0,
      test_cases_run: 0,
      passed: 0,
      failed: 0,
      pass_rate_percent: null,
      within_threshold: null,
      status: "pending_scan"
    });
  }

  return {
    skipped: false,
    source_site: plan.source_site,
    target_site: plan.target_site,
    scanned_at: scannedAt,
    inventory_rows: inventoryRows,
    check_count: inventoryRows.length
  };
}

export function buildWordpressPhaseONormalizedInventory(inventoryResult = {}) {
  if (inventoryResult.skipped) {
    return {
      skipped: true,
      normalized_qa_check_rows: [],
      normalized_failure_rows: []
    };
  }

  const normalizedQaCheckRows = (inventoryResult.inventory_rows || []).map(row => ({
    check: String(row.check || ""),
    label: String(row.label || ""),
    priority: String(row.priority || "medium"),
    source_site: String(row.source_site || ""),
    target_site: String(row.target_site || ""),
    test_cases_available: Number(row.test_cases_available || 0),
    test_cases_run: Number(row.test_cases_run || 0),
    passed: Number(row.passed || 0),
    failed: Number(row.failed || 0),
    pass_rate_percent: row.pass_rate_percent !== null ? Number(row.pass_rate_percent) : null,
    within_threshold: row.within_threshold,
    status: String(row.status || "pending_scan")
  }));

  const normalizedFailureRows = normalizedQaCheckRows
    .filter(r => r.failed > 0)
    .map(r => ({
      check: r.check,
      label: r.label,
      priority: r.priority,
      failed: r.failed,
      pass_rate_percent: r.pass_rate_percent,
      within_threshold: r.within_threshold,
      is_critical: r.priority === "critical"
    }));

  const criticalFailures = normalizedFailureRows.filter(r => r.is_critical).length;

  return {
    skipped: false,
    normalized_qa_check_rows: normalizedQaCheckRows,
    normalized_failure_rows: normalizedFailureRows,
    total_checks: normalizedQaCheckRows.length,
    total_failures: normalizedFailureRows.length,
    critical_failures: criticalFailures,
    out_of_threshold_count: normalizedQaCheckRows.filter(r => r.within_threshold === false).length
  };
}

// ── O.3 Readiness Gate ────────────────────────────────────────────────────────

export function buildWordpressPhaseOReadinessGate(args = {}) {
  const { plan = {}, normalizedInventory = {} } = args;
  if (!plan.enabled || normalizedInventory.skipped) {
    return { gate_open: true, skipped: true, readiness_status: "skipped" };
  }

  const checkRows = normalizedInventory.normalized_qa_check_rows || [];
  const failedScans = checkRows.filter(r => r.status === "error");
  const criticalFailures = normalizedInventory.critical_failures || 0;
  const outOfThreshold = normalizedInventory.out_of_threshold_count || 0;

  const blockers = [];
  if (failedScans.length > 0) {
    blockers.push(`${failedScans.length} QA check(s) errored during scan`);
  }
  if (plan.block_on_failure && criticalFailures > 0) {
    blockers.push(`${criticalFailures} critical QA failure(s) — block_on_failure=true`);
  }

  const warnings = outOfThreshold > 0
    ? [`${outOfThreshold} check(s) below acceptance threshold of ${plan.acceptance_threshold_percent}%`]
    : [];

  return {
    gate_open: blockers.length === 0,
    readiness_status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    warnings,
    check_count: checkRows.length,
    critical_failures: criticalFailures,
    out_of_threshold_count: outOfThreshold,
    failed_scan_count: failedScans.length,
    acceptance_threshold_percent: plan.acceptance_threshold_percent
  };
}

export function buildWordpressPhaseOSafeCandidates(args = {}) {
  const { plan = {}, normalizedInventory = {}, readinessGate = {} } = args;
  if (!plan.enabled || !readinessGate.gate_open) {
    return { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  }

  const checkRows = normalizedInventory.normalized_qa_check_rows || [];

  const safeCandidates = checkRows.filter(r =>
    r.status !== "error" && r.check && r.target_site
  );
  const unsafeCandidates = checkRows.filter(r =>
    r.status === "error" || !r.check || !r.target_site
  );

  return {
    safe_candidates: safeCandidates,
    unsafe_candidates: unsafeCandidates,
    total_safe: safeCandidates.length,
    total_unsafe: unsafeCandidates.length,
    failing_count: safeCandidates.filter(r => r.within_threshold === false).length
  };
}

// ── O.4 Reconciliation Planner ────────────────────────────────────────────────

export function buildWordpressPhaseOReconciliationPayloadPlanner(args = {}) {
  const { plan = {}, safeCandidates = {}, normalizedInventory = {} } = args;
  if (!plan.enabled) {
    return { skipped: true, reconciliation_items: [] };
  }

  const candidates = safeCandidates.safe_candidates || [];

  const reconciliationItems = candidates.map(candidate => ({
    check: candidate.check,
    label: candidate.label,
    priority: candidate.priority,
    source_site: candidate.source_site,
    target_site: candidate.target_site,
    action: plan.apply ? "run_qa_checks" : "verify_only",
    pass_rate_percent: candidate.pass_rate_percent,
    within_threshold: candidate.within_threshold,
    acceptance_threshold_percent: plan.acceptance_threshold_percent,
    block_on_failure: plan.block_on_failure
  }));

  return {
    skipped: false,
    reconciliation_items: reconciliationItems,
    total_items: reconciliationItems.length,
    apply_items: reconciliationItems.filter(r => r.action === "run_qa_checks").length,
    verify_only_items: reconciliationItems.filter(r => r.action === "verify_only").length,
    apply_mode: plan.apply
  };
}

// ── O.5 Execution Plan ────────────────────────────────────────────────────────

export function resolveWordpressPhaseOExecutionPlan(args = {}) {
  const { plan = {}, reconciliationPlanner = {} } = args;
  if (!plan.enabled || reconciliationPlanner.skipped) {
    return { skipped: true, execution_steps: [], total_steps: 0 };
  }

  const items = reconciliationPlanner.reconciliation_items || [];

  const sortOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const executionSteps = [...items]
    .sort((a, b) => (sortOrder[a.priority] || 2) - (sortOrder[b.priority] || 2))
    .map((item, idx) => ({
      step_index: idx + 1,
      check: item.check,
      label: item.label,
      priority: item.priority,
      target_site: item.target_site,
      action: item.action,
      block_on_failure: item.block_on_failure,
      status: "pending",
      error: null
    }));

  return {
    skipped: false,
    execution_steps: executionSteps,
    total_steps: executionSteps.length,
    critical_steps: executionSteps.filter(s => s.priority === "critical").length,
    apply_mode: plan.apply,
    estimated_duration_minutes: executionSteps.length * 2
  };
}

export function buildWordpressPhaseOExecutionGuard(args = {}) {
  const { plan = {}, executionPlan = {}, safeCandidates = {} } = args;
  if (!plan.enabled || executionPlan.skipped) {
    return { guard_passed: true, skipped: true };
  }

  const violations = [];

  if (plan.apply && (safeCandidates.total_safe || 0) === 0) {
    violations.push("apply=true but no safe QA check candidates found");
  }
  if (plan.apply && !plan.target_site) {
    violations.push("apply=true but target_site is missing");
  }
  if ((executionPlan.total_steps || 0) > 50) {
    violations.push(`too many QA steps: ${executionPlan.total_steps} (max 50)`);
  }

  return {
    guard_passed: violations.length === 0,
    violations,
    step_count: executionPlan.total_steps || 0,
    critical_step_count: executionPlan.critical_steps || 0,
    apply_mode: plan.apply
  };
}

// ── O.6 Mutation Candidate Selector ───────────────────────────────────────────

export function buildWordpressPhaseOMutationCandidateSelector(args = {}) {
  const { plan = {}, executionPlan = {}, executionGuard = {} } = args;
  if (!plan.enabled || !executionGuard.guard_passed || executionPlan.skipped) {
    return { selected_mutations: [], total_selected: 0, blocked: true };
  }

  const steps = executionPlan.execution_steps || [];
  const selectedMutations = steps.filter(s => s.action === "run_qa_checks");

  return {
    selected_mutations: selectedMutations,
    total_selected: selectedMutations.length,
    blocked: false,
    verify_only_count: steps.filter(s => s.action === "verify_only").length,
    critical_count: selectedMutations.filter(s => s.priority === "critical").length
  };
}

export function buildWordpressPhaseOMutationCandidateArtifact(selectorResult = {}) {
  return {
    mutations: selectorResult.selected_mutations || [],
    total: selectorResult.total_selected || 0,
    blocked: selectorResult.blocked === true,
    verify_only_count: selectorResult.verify_only_count || 0,
    critical_count: selectorResult.critical_count || 0,
    generated_at: new Date().toISOString()
  };
}

// ── O.7 Mutation Payload Composer ─────────────────────────────────────────────

export function buildWordpressPhaseOMutationPayloadComposer(args = {}) {
  const { plan = {}, mutationCandidateArtifact = {} } = args;
  if (mutationCandidateArtifact.blocked || (mutationCandidateArtifact.total || 0) === 0) {
    return { payloads: [], total_payloads: 0, skipped: true };
  }

  const mutations = mutationCandidateArtifact.mutations || [];

  const payloads = mutations.map(m => ({
    check: m.check,
    label: m.label,
    priority: m.priority,
    target_site: m.target_site,
    operation: "qa_check_run",
    block_on_failure: m.block_on_failure,
    acceptance_threshold_percent: plan.acceptance_threshold_percent,
    payload_version: "1.0",
    created_at: new Date().toISOString()
  }));

  return {
    payloads,
    total_payloads: payloads.length,
    skipped: false,
    apply_mode: plan.apply,
    acceptance_threshold_percent: plan.acceptance_threshold_percent
  };
}

export function buildWordpressPhaseOMutationPayloadArtifact(composerResult = {}) {
  return {
    payloads: composerResult.payloads || [],
    total: composerResult.total_payloads || 0,
    skipped: composerResult.skipped === true,
    apply_mode: composerResult.apply_mode === true,
    acceptance_threshold_percent: composerResult.acceptance_threshold_percent || 95,
    generated_at: new Date().toISOString()
  };
}

// ── O.8 Dry Run Execution Simulator ───────────────────────────────────────────

export function simulateWordpressQaAcceptanceDryRunRow(args = {}) {
  const { payload = {}, rowIndex = 0 } = args;

  const wouldSucceed =
    Boolean(payload.check) &&
    Boolean(payload.target_site);

  const simulatedPassRate = wouldSucceed ? 97 - rowIndex : 0;
  const withinThreshold = simulatedPassRate >= (payload.acceptance_threshold_percent || 95);

  return {
    row_index: rowIndex,
    check: payload.check,
    label: payload.label,
    priority: payload.priority,
    target_site: payload.target_site,
    operation: payload.operation,
    would_succeed: wouldSucceed,
    simulated_pass_rate_percent: wouldSucceed ? simulatedPassRate : null,
    would_pass_threshold: wouldSucceed ? withinThreshold : false,
    simulated_error: wouldSucceed ? null : "missing required QA check parameters",
    simulated_duration_seconds: wouldSucceed ? 5 + rowIndex * 2 : 0
  };
}

export function buildWordpressPhaseODryRunExecutionSimulator(args = {}) {
  const { plan = {}, mutationPayloadArtifact = {} } = args;
  if (mutationPayloadArtifact.skipped || !plan.enabled) {
    return { skipped: true, dry_run_rows: [], summary: {} };
  }

  const payloads = mutationPayloadArtifact.payloads || [];
  const dryRunRows = payloads.map((payload, idx) =>
    simulateWordpressQaAcceptanceDryRunRow({ payload, rowIndex: idx })
  );

  const successCount = dryRunRows.filter(r => r.would_succeed).length;
  const failCount = dryRunRows.length - successCount;
  const passingThreshold = dryRunRows.filter(r => r.would_pass_threshold).length;

  return {
    skipped: false,
    dry_run_rows: dryRunRows,
    summary: {
      total: dryRunRows.length,
      would_succeed: successCount,
      would_fail: failCount,
      passing_threshold: passingThreshold,
      failing_threshold: dryRunRows.length - passingThreshold,
      estimated_total_duration_seconds: dryRunRows.reduce(
        (acc, r) => acc + (r.simulated_duration_seconds || 0), 0
      )
    }
  };
}

export function buildWordpressPhaseODryRunExecutionArtifact(simulatorResult = {}) {
  return {
    skipped: simulatorResult.skipped === true,
    dry_run_rows: simulatorResult.dry_run_rows || [],
    summary: simulatorResult.summary || {},
    generated_at: new Date().toISOString()
  };
}

// ── O.9 Final Operator Handoff Bundle ─────────────────────────────────────────

export function buildWordpressPhaseOFinalOperatorHandoffBundle(args = {}) {
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
    phase: "O",
    phase_name: "Quality Assurance / Smoke Tests / Acceptance",
    enabled,
    overall_status: overallStatus,
    gate_open: gateOpen,
    readiness_status: readinessStatus,
    guard_passed: guardPassed,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      acceptance_threshold_percent: plan.acceptance_threshold_percent,
      block_on_failure: plan.block_on_failure,
      checks: [
        plan.include_smoke_tests && "smoke_tests",
        plan.include_content_spot_checks && "content_spot_checks",
        plan.include_form_validation && "form_validation",
        plan.include_redirect_checks && "redirect_checks",
        plan.include_performance_checks && "performance_checks",
        plan.include_seo_checks && "seo_checks",
        plan.include_analytics_checks && "analytics_checks"
      ].filter(Boolean),
      apply_mode: plan.apply
    },
    inventory_summary: {
      total_checks: normalizedInventory.total_checks || 0,
      total_failures: normalizedInventory.total_failures || 0,
      critical_failures: normalizedInventory.critical_failures || 0,
      out_of_threshold_count: normalizedInventory.out_of_threshold_count || 0
    },
    safe_candidate_count: safeCandidates.total_safe || 0,
    unsafe_candidate_count: safeCandidates.total_unsafe || 0,
    failing_count: safeCandidates.failing_count || 0,
    reconciliation_item_count: reconciliationPlanner.total_items || 0,
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
