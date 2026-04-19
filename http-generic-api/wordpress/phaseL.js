// Phase L — Backup / Recovery surfaces
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID,
  MAX_TIMEOUT_SECONDS
} from "../config.js";

// ── L.1 Plan Resolution ───────────────────────────────────────────────────────

export function resolveWordpressPhaseLPlan(payload = {}) {
  const migration = payload?.migration || {};
  const backup =
    migration.backup_recovery &&
    typeof migration.backup_recovery === "object"
      ? migration.backup_recovery
      : {};

  return {
    enabled: backup.enabled === true,
    inventory_only:
      backup.inventory_only === undefined ? true : backup.inventory_only === true,
    apply: backup.apply === true,
    include_database: backup.include_database === undefined ? true : backup.include_database === true,
    include_files: backup.include_files === undefined ? true : backup.include_files === true,
    include_media: backup.include_media === undefined ? true : backup.include_media === true,
    include_plugins: backup.include_plugins === undefined ? true : backup.include_plugins === true,
    include_themes: backup.include_themes === undefined ? true : backup.include_themes === true,
    recovery_point_count: Number(backup.recovery_point_count) || 3,
    retention_days: Number(backup.retention_days) || 30,
    source_site: String(backup.source_site || "").trim(),
    target_site: String(backup.target_site || "").trim()
  };
}

export function assertWordpressPhaseLPlan(plan = {}) {
  if (!plan.enabled) return;
  if (!plan.source_site) throw new Error("Phase L: source_site is required");
  if (!plan.include_database && !plan.include_files && !plan.include_media) {
    throw new Error("Phase L: at least one backup scope must be enabled");
  }
  if (plan.recovery_point_count < 1 || plan.recovery_point_count > 10) {
    throw new Error("Phase L: recovery_point_count must be between 1 and 10");
  }
}

export function buildWordpressPhaseLGate(args = {}) {
  const { plan = {}, priorPhaseStatus = {} } = args;
  const blockers = [];

  if (!plan.enabled) {
    return { gate_open: true, skipped: true, reason: "Phase L disabled in plan" };
  }
  if (!plan.source_site) blockers.push("source_site missing");
  if (!plan.include_database && !plan.include_files) blockers.push("no backup scope selected");
  if (priorPhaseStatus.phase_k_enabled && !priorPhaseStatus.phase_k_observability_healthy) {
    blockers.push("Phase K observability not healthy");
  }

  return {
    gate_open: blockers.length === 0,
    blockers,
    plan_summary: {
      source_site: plan.source_site,
      scopes: [
        plan.include_database && "database",
        plan.include_files && "files",
        plan.include_media && "media",
        plan.include_plugins && "plugins",
        plan.include_themes && "themes"
      ].filter(Boolean)
    }
  };
}

// ── L.2 Inventory ─────────────────────────────────────────────────────────────

export async function runWordpressBackupRecoveryInventory(args = {}) {
  const { plan = {}, sheets } = args;
  if (!plan.enabled) return { skipped: true, inventory_rows: [] };

  const inventoryRows = [];
  const startedAt = new Date().toISOString();

  if (plan.include_database) {
    inventoryRows.push({
      scope: "database",
      source_site: plan.source_site,
      estimated_size_mb: null,
      last_backup_date: null,
      recovery_points_available: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_files) {
    inventoryRows.push({
      scope: "files",
      source_site: plan.source_site,
      estimated_size_mb: null,
      last_backup_date: null,
      recovery_points_available: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_media) {
    inventoryRows.push({
      scope: "media",
      source_site: plan.source_site,
      estimated_size_mb: null,
      last_backup_date: null,
      recovery_points_available: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_plugins) {
    inventoryRows.push({
      scope: "plugins",
      source_site: plan.source_site,
      estimated_size_mb: null,
      last_backup_date: null,
      recovery_points_available: 0,
      status: "pending_scan"
    });
  }
  if (plan.include_themes) {
    inventoryRows.push({
      scope: "themes",
      source_site: plan.source_site,
      estimated_size_mb: null,
      last_backup_date: null,
      recovery_points_available: 0,
      status: "pending_scan"
    });
  }

  return {
    skipped: false,
    source_site: plan.source_site,
    scanned_at: startedAt,
    inventory_rows: inventoryRows,
    scope_count: inventoryRows.length
  };
}

export function buildWordpressPhaseLNormalizedInventory(inventoryResult = {}) {
  if (inventoryResult.skipped) {
    return { skipped: true, normalized_backup_scope_rows: [], normalized_recovery_point_rows: [] };
  }

  const normalizedBackupScopeRows = (inventoryResult.inventory_rows || []).map(row => ({
    scope: String(row.scope || ""),
    source_site: String(row.source_site || ""),
    estimated_size_mb: row.estimated_size_mb !== null ? Number(row.estimated_size_mb) : null,
    last_backup_date: String(row.last_backup_date || ""),
    recovery_points_available: Number(row.recovery_points_available || 0),
    status: String(row.status || "pending_scan")
  }));

  const normalizedRecoveryPointRows = normalizedBackupScopeRows.flatMap(row =>
    Array.from({ length: row.recovery_points_available }, (_, i) => ({
      scope: row.scope,
      source_site: row.source_site,
      recovery_point_index: i + 1,
      snapshot_id: null,
      created_at: null,
      size_mb: null
    }))
  );

  return {
    skipped: false,
    normalized_backup_scope_rows: normalizedBackupScopeRows,
    normalized_recovery_point_rows: normalizedRecoveryPointRows,
    total_scopes: normalizedBackupScopeRows.length,
    total_recovery_points: normalizedRecoveryPointRows.length
  };
}

// ── L.3 Readiness Gate ────────────────────────────────────────────────────────

export function buildWordpressPhaseLReadinessGate(args = {}) {
  const { plan = {}, normalizedInventory = {} } = args;
  if (!plan.enabled || normalizedInventory.skipped) {
    return { gate_open: true, skipped: true, readiness_status: "skipped" };
  }

  const scopeRows = normalizedInventory.normalized_backup_scope_rows || [];
  const failedScopes = scopeRows.filter(r => r.status === "error");
  const pendingScopes = scopeRows.filter(r => r.status === "pending_scan");

  const blockers = [];
  if (failedScopes.length > 0) {
    blockers.push(`${failedScopes.length} backup scope(s) errored during inventory`);
  }
  if (plan.include_database && !scopeRows.find(r => r.scope === "database")) {
    blockers.push("database scope missing from inventory");
  }

  return {
    gate_open: blockers.length === 0,
    readiness_status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    scope_count: scopeRows.length,
    pending_scope_count: pendingScopes.length,
    failed_scope_count: failedScopes.length
  };
}

export function buildWordpressPhaseLSafeCandidates(args = {}) {
  const { plan = {}, normalizedInventory = {}, readinessGate = {} } = args;
  if (!plan.enabled || !readinessGate.gate_open) {
    return { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  }

  const scopeRows = normalizedInventory.normalized_backup_scope_rows || [];

  const safeCandidates = scopeRows.filter(r =>
    r.status !== "error" && r.scope && r.source_site
  );
  const unsafeCandidates = scopeRows.filter(r =>
    r.status === "error" || !r.scope || !r.source_site
  );

  return {
    safe_candidates: safeCandidates,
    unsafe_candidates: unsafeCandidates,
    total_safe: safeCandidates.length,
    total_unsafe: unsafeCandidates.length
  };
}

// ── L.4 Reconciliation Planner ────────────────────────────────────────────────

export function buildWordpressPhaseLReconciliationPayloadPlanner(args = {}) {
  const { plan = {}, safeCandidates = {}, normalizedInventory = {} } = args;
  if (!plan.enabled) {
    return { skipped: true, reconciliation_items: [] };
  }

  const candidates = safeCandidates.safe_candidates || [];

  const reconciliationItems = candidates.map(candidate => ({
    scope: candidate.scope,
    source_site: candidate.source_site,
    target_site: plan.target_site || plan.source_site,
    action: plan.apply ? "create_backup" : "verify_only",
    retention_days: plan.retention_days,
    recovery_point_count: plan.recovery_point_count,
    requires_confirmation: plan.apply === true,
    estimated_size_mb: candidate.estimated_size_mb
  }));

  return {
    skipped: false,
    reconciliation_items: reconciliationItems,
    total_items: reconciliationItems.length,
    apply_mode: plan.apply,
    inventory_only_mode: plan.inventory_only
  };
}

// ── L.5 Execution Plan ────────────────────────────────────────────────────────

export function resolveWordpressPhaseLExecutionPlan(args = {}) {
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
    retention_days: item.retention_days,
    recovery_point_count: item.recovery_point_count,
    status: "pending",
    error: null
  }));

  return {
    skipped: false,
    execution_steps: executionSteps,
    total_steps: executionSteps.length,
    apply_mode: plan.apply,
    estimated_duration_seconds: executionSteps.length * 30
  };
}

export function buildWordpressPhaseLExecutionGuard(args = {}) {
  const { plan = {}, executionPlan = {}, safeCandidates = {} } = args;
  if (!plan.enabled || executionPlan.skipped) {
    return { guard_passed: true, skipped: true };
  }

  const violations = [];

  if (plan.apply && (safeCandidates.total_safe || 0) === 0) {
    violations.push("apply=true but no safe backup candidates found");
  }
  if (plan.apply && !plan.source_site) {
    violations.push("apply=true but source_site is missing");
  }
  if ((executionPlan.total_steps || 0) > 50) {
    violations.push(`execution plan too large: ${executionPlan.total_steps} steps (max 50)`);
  }

  return {
    guard_passed: violations.length === 0,
    violations,
    step_count: executionPlan.total_steps || 0,
    apply_mode: plan.apply
  };
}

// ── L.6 Mutation Candidate Selector ───────────────────────────────────────────

export function buildWordpressPhaseLMutationCandidateSelector(args = {}) {
  const { plan = {}, executionPlan = {}, executionGuard = {} } = args;
  if (!plan.enabled || !executionGuard.guard_passed || executionPlan.skipped) {
    return { selected_mutations: [], total_selected: 0, blocked: true };
  }

  const steps = executionPlan.execution_steps || [];
  const selectedMutations = steps.filter(s => s.action === "create_backup");

  return {
    selected_mutations: selectedMutations,
    total_selected: selectedMutations.length,
    blocked: false,
    verify_only_count: steps.filter(s => s.action === "verify_only").length
  };
}

export function buildWordpressPhaseLMutationCandidateArtifact(selectorResult = {}) {
  return {
    mutations: selectorResult.selected_mutations || [],
    total: selectorResult.total_selected || 0,
    blocked: selectorResult.blocked === true,
    verify_only_count: selectorResult.verify_only_count || 0,
    generated_at: new Date().toISOString()
  };
}

// ── L.7 Mutation Payload Composer ─────────────────────────────────────────────

export function buildWordpressPhaseLMutationPayloadComposer(args = {}) {
  const { plan = {}, mutationCandidateArtifact = {} } = args;
  if (mutationCandidateArtifact.blocked || (mutationCandidateArtifact.total || 0) === 0) {
    return { payloads: [], total_payloads: 0, skipped: true };
  }

  const mutations = mutationCandidateArtifact.mutations || [];

  const payloads = mutations.map(m => ({
    scope: m.scope,
    source_site: m.source_site,
    target_site: m.target_site,
    operation: "backup_create",
    retention_days: m.retention_days,
    recovery_point_count: m.recovery_point_count,
    payload_version: "1.0",
    created_at: new Date().toISOString()
  }));

  return {
    payloads,
    total_payloads: payloads.length,
    skipped: false,
    apply_mode: plan.apply
  };
}

export function buildWordpressPhaseLMutationPayloadArtifact(composerResult = {}) {
  return {
    payloads: composerResult.payloads || [],
    total: composerResult.total_payloads || 0,
    skipped: composerResult.skipped === true,
    apply_mode: composerResult.apply_mode === true,
    generated_at: new Date().toISOString()
  };
}

// ── L.8 Dry Run Execution Simulator ───────────────────────────────────────────

export function simulateWordpressBackupRecoveryDryRunRow(args = {}) {
  const { payload = {}, rowIndex = 0 } = args;

  const wouldSucceed =
    Boolean(payload.scope) &&
    Boolean(payload.source_site) &&
    payload.retention_days > 0 &&
    payload.recovery_point_count > 0;

  return {
    row_index: rowIndex,
    scope: payload.scope,
    source_site: payload.source_site,
    operation: payload.operation,
    would_succeed: wouldSucceed,
    simulated_error: wouldSucceed ? null : "missing required backup parameters",
    simulated_duration_seconds: wouldSucceed ? 30 + rowIndex * 5 : 0
  };
}

export function buildWordpressPhaseLDryRunExecutionSimulator(args = {}) {
  const { plan = {}, mutationPayloadArtifact = {} } = args;
  if (mutationPayloadArtifact.skipped || !plan.enabled) {
    return { skipped: true, dry_run_rows: [], summary: {} };
  }

  const payloads = mutationPayloadArtifact.payloads || [];
  const dryRunRows = payloads.map((payload, idx) =>
    simulateWordpressBackupRecoveryDryRunRow({ payload, rowIndex: idx })
  );

  const successCount = dryRunRows.filter(r => r.would_succeed).length;
  const failCount = dryRunRows.length - successCount;

  return {
    skipped: false,
    dry_run_rows: dryRunRows,
    summary: {
      total: dryRunRows.length,
      would_succeed: successCount,
      would_fail: failCount,
      estimated_total_duration_seconds: dryRunRows.reduce(
        (acc, r) => acc + (r.simulated_duration_seconds || 0), 0
      )
    }
  };
}

export function buildWordpressPhaseLDryRunExecutionArtifact(simulatorResult = {}) {
  return {
    skipped: simulatorResult.skipped === true,
    dry_run_rows: simulatorResult.dry_run_rows || [],
    summary: simulatorResult.summary || {},
    generated_at: new Date().toISOString()
  };
}

// ── L.9 Final Operator Handoff Bundle ─────────────────────────────────────────

export function buildWordpressPhaseLFinalOperatorHandoffBundle(args = {}) {
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
    phase: "L",
    phase_name: "Backup / Recovery",
    enabled,
    overall_status: overallStatus,
    gate_open: gateOpen,
    readiness_status: readinessStatus,
    guard_passed: guardPassed,
    plan_summary: {
      source_site: plan.source_site,
      target_site: plan.target_site,
      scopes: [
        plan.include_database && "database",
        plan.include_files && "files",
        plan.include_media && "media",
        plan.include_plugins && "plugins",
        plan.include_themes && "themes"
      ].filter(Boolean),
      apply_mode: plan.apply,
      recovery_point_count: plan.recovery_point_count,
      retention_days: plan.retention_days
    },
    inventory_summary: {
      total_scopes: normalizedInventory.total_scopes || 0,
      total_recovery_points: normalizedInventory.total_recovery_points || 0
    },
    safe_candidate_count: safeCandidates.total_safe || 0,
    unsafe_candidate_count: safeCandidates.total_unsafe || 0,
    reconciliation_item_count: reconciliationPlanner.total_items || 0,
    execution_step_count: executionPlan.total_steps || 0,
    mutation_count: mutationCandidateArtifact.total || 0,
    payload_count: mutationPayloadArtifact.total || 0,
    dry_run_summary: dryRunSummary,
    blockers: [
      ...(gate.blockers || []),
      ...(readinessGate.blockers || []),
      ...(executionGuard.violations || [])
    ],
    generated_at: new Date().toISOString()
  };
}
