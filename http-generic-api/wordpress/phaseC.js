// Auto-extracted from server.js — do not edit manually, use domain logic here.
import {
  toPositiveInt
} from "./shared.js";

export function resolveWordpressPhaseCPlan(payload = {}) {
  const migration = payload?.migration || {};
  const settings = migration.site_settings && typeof migration.site_settings === "object"
    ? migration.site_settings
    : {};

  return {
    enabled: settings.enabled === true,
    reconciliation_only:
      settings.reconciliation_only === undefined
        ? true
        : settings.reconciliation_only === true,
    apply: settings.apply === true,
    include_keys: Array.isArray(settings.include_keys)
      ? settings.include_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [
          "permalink_structure",
          "timezone_string",
          "language",
          "active_theme",
          "reading_settings",
          "writing_settings"
        ]
  };
}

export function assertWordpressPhaseCPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }

  if (plan.apply === true && plan.reconciliation_only === true) {
    blockingReasons.push("phase_c_apply_conflicts_with_reconciliation_only");
  }

  if (!Array.isArray(plan.include_keys) || plan.include_keys.length === 0) {
    blockingReasons.push("phase_c_no_settings_keys_requested");
  }

  return {
    phase_c_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_c_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseCGate(args = {}) {
  const phaseAFinalCutoverRecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBFinalOperatorHandoffBundle =
    args.phaseBFinalOperatorHandoffBundle &&
    typeof args.phaseBFinalOperatorHandoffBundle === "object"
      ? args.phaseBFinalOperatorHandoffBundle
      : {};
  const phaseCPlanStatus =
    args.phaseCPlanStatus && typeof args.phaseCPlanStatus === "object"
      ? args.phaseCPlanStatus
      : {};
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object"
      ? args.phaseCPlan
      : {};

  const blockingReasons = [...(phaseCPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_c");
  }

  if (
    phaseCPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  return {
    phase_c_gate_status:
      blockingReasons.length === 0
        ? "ready_for_settings_inventory"
        : "blocked",
    phase_c_gate_ready: blockingReasons.length === 0,
    reconciliation_only: phaseCPlan.reconciliation_only === true,
    blocking_reasons: blockingReasons
  };
}

export function normalizeWordpressSettingsInventoryRecord(args = {}) {
  return {
    setting_key: String(args.setting_key || "").trim(),
    source_value:
      args.source_value === undefined || args.source_value === null
        ? ""
        : args.source_value,
    destination_value:
      args.destination_value === undefined || args.destination_value === null
        ? ""
        : args.destination_value
  };
}

export function classifyWordpressSettingReconciliationRow(row = {}) {
  const sourceValue = row?.source_value;
  const destinationValue = row?.destination_value;

  const sourceText =
    typeof sourceValue === "object" ? JSON.stringify(sourceValue) : String(sourceValue ?? "");
  const destinationText =
    typeof destinationValue === "object"
      ? JSON.stringify(destinationValue)
      : String(destinationValue ?? "");

  const same = sourceText === destinationText;

  return {
    ...row,
    reconciliation_status: same ? "aligned" : "diff_detected",
    reconciliation_action: same ? "no_change" : "review_and_reconcile"
  };
}

export async function collectWordpressSiteSettingsInventory(args = {}) {
  const {
    wpContext = {},
    phaseCGate = {},
    phaseCPlan = {}
  } = args;

  if (phaseCGate.phase_c_gate_ready !== true) {
    return {
      phase_c_inventory_status: "blocked",
      inventory_rows: [],
      summary: {
        total_count: 0,
        aligned_count: 0,
        diff_count: 0
      },
      failures: [
        {
          code: "phase_c_settings_inventory_blocked",
          message: "Phase C settings inventory blocked by phase_c_gate.",
          blocking_reasons: phaseCGate.blocking_reasons || []
        }
      ]
    };
  }

  const includeKeys = new Set(phaseCPlan.include_keys || []);
  const sourceProfile = wpContext?.source || {};
  const destinationProfile = wpContext?.destination || {};

  const candidateRows = [];

  if (includeKeys.has("permalink_structure")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "permalink_structure",
        source_value: sourceProfile?.permalink_structure || "",
        destination_value: destinationProfile?.permalink_structure || ""
      })
    );
  }

  if (includeKeys.has("timezone_string")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "timezone_string",
        source_value: sourceProfile?.timezone_string || "",
        destination_value: destinationProfile?.timezone_string || ""
      })
    );
  }

  if (includeKeys.has("language")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "language",
        source_value: sourceProfile?.language || sourceProfile?.site_language || "",
        destination_value:
          destinationProfile?.language || destinationProfile?.site_language || ""
      })
    );
  }

  if (includeKeys.has("active_theme")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "active_theme",
        source_value: sourceProfile?.active_theme || "",
        destination_value: destinationProfile?.active_theme || ""
      })
    );
  }

  if (includeKeys.has("reading_settings")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "reading_settings",
        source_value: sourceProfile?.reading_settings || {},
        destination_value: destinationProfile?.reading_settings || {}
      })
    );
  }

  if (includeKeys.has("writing_settings")) {
    candidateRows.push(
      normalizeWordpressSettingsInventoryRecord({
        setting_key: "writing_settings",
        source_value: sourceProfile?.writing_settings || {},
        destination_value: destinationProfile?.writing_settings || {}
      })
    );
  }

  const inventoryRows = candidateRows.map(classifyWordpressSettingReconciliationRow);

  const summary = inventoryRows.reduce(
    (acc, row) => {
      acc.total_count += 1;
      if (String(row?.reconciliation_status || "").trim() === "aligned") {
        acc.aligned_count += 1;
      } else {
        acc.diff_count += 1;
      }
      return acc;
    },
    {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    }
  );

  return {
    phase_c_inventory_status: "completed",
    inventory_rows: inventoryRows,
    summary,
    failures: []
  };
}

export function buildWordpressPhaseCInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_c_settings_inventory",
    artifact_version: "v1",
    phase_c_gate_status: String(gate.phase_c_gate_status || "").trim(),
    phase_c_inventory_status: String(inventory.phase_c_inventory_status || "").trim(),
    reconciliation_only: gate.reconciliation_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0
          },
    inventory_rows: Array.isArray(inventory.inventory_rows)
      ? inventory.inventory_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressSettingValueForDiff(settingKey = "", value = "") {
  const key = String(settingKey || "").trim();

  if (key === "permalink_structure") {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  if (key === "timezone_string" || key === "language" || key === "active_theme") {
    return String(value || "").trim().toLowerCase();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return JSON.stringify(sorted);
  }

  if (Array.isArray(value)) {
    return JSON.stringify([...value]);
  }

  return String(value ?? "").trim();
}

export function classifyWordpressSettingReconciliationBucket(row = {}) {
  const key = String(row?.setting_key || "").trim();
  const sourceNormalized = normalizeWordpressSettingValueForDiff(
    key,
    row?.source_value
  );
  const destinationNormalized = normalizeWordpressSettingValueForDiff(
    key,
    row?.destination_value
  );

  const same = sourceNormalized === destinationNormalized;

  let bucket = "review_required";
  let bucketReason = "default_settings_review";

  if (same) {
    bucket = "already_aligned";
    bucketReason = "normalized_values_match";
  } else if (
    key === "permalink_structure" ||
    key === "timezone_string" ||
    key === "language"
  ) {
    bucket = "safe_reconcile_candidate";
    bucketReason = "core_setting_with_safe_reconciliation_path";
  } else if (key === "active_theme") {
    bucket = "environment_sensitive_review";
    bucketReason = "theme_setting_environment_sensitive";
  } else if (key === "reading_settings" || key === "writing_settings") {
    bucket = "structured_settings_review";
    bucketReason = "structured_settings_require_diff_review";
  }

  return {
    ...row,
    source_value_normalized: sourceNormalized,
    destination_value_normalized: destinationNormalized,
    diff_detected: !same,
    reconciliation_bucket: bucket,
    reconciliation_bucket_reason: bucketReason
  };
}

export function buildWordpressPhaseCNormalizedDiff(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(classifyWordpressSettingReconciliationBucket);

  const summary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const bucket = String(row?.reconciliation_bucket || "").trim();
      if (bucket === "already_aligned") acc.already_aligned_count += 1;
      else if (bucket === "safe_reconcile_candidate") acc.safe_reconcile_candidate_count += 1;
      else if (bucket === "environment_sensitive_review") acc.environment_sensitive_review_count += 1;
      else if (bucket === "structured_settings_review") acc.structured_settings_review_count += 1;
      else acc.review_required_count += 1;

      if (row?.diff_detected === true) acc.diff_count += 1;
      else acc.aligned_count += 1;

      return acc;
    },
    {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    }
  );

  const buckets = {
    already_aligned: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "already_aligned"
    ),
    safe_reconcile_candidate: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "safe_reconcile_candidate"
    ),
    environment_sensitive_review: normalizedRows.filter(
      row =>
        String(row?.reconciliation_bucket || "").trim() ===
        "environment_sensitive_review"
    ),
    structured_settings_review: normalizedRows.filter(
      row =>
        String(row?.reconciliation_bucket || "").trim() ===
        "structured_settings_review"
    ),
    review_required: normalizedRows.filter(
      row => String(row?.reconciliation_bucket || "").trim() === "review_required"
    )
  };

  return {
    normalized_diff_rows: normalizedRows,
    diff_summary: summary,
    reconciliation_buckets: buckets
  };
}

export function buildWordpressPhaseCDiffArtifact(args = {}) {
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_c_settings_diff",
    artifact_version: "v1",
    phase_c_gate_status: String(gate.phase_c_gate_status || "").trim(),
    reconciliation_only: gate.reconciliation_only === true,
    diff_summary:
      normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
        ? normalizedDiff.diff_summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0,
            already_aligned_count: 0,
            safe_reconcile_candidate_count: 0,
            environment_sensitive_review_count: 0,
            structured_settings_review_count: 0,
            review_required_count: 0
          },
    normalized_diff_rows: Array.isArray(normalizedDiff.normalized_diff_rows)
      ? normalizedDiff.normalized_diff_rows
      : [],
    reconciliation_buckets:
      normalizedDiff?.reconciliation_buckets &&
      typeof normalizedDiff.reconciliation_buckets === "object"
        ? normalizedDiff.reconciliation_buckets
        : {
            already_aligned: [],
            safe_reconcile_candidate: [],
            environment_sensitive_review: [],
            structured_settings_review: [],
            review_required: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseCReconciliationReadiness(args = {}) {
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};

  const summary =
    normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
      ? normalizedDiff.diff_summary
      : {};
  const buckets =
    normalizedDiff?.reconciliation_buckets &&
    typeof normalizedDiff.reconciliation_buckets === "object"
      ? normalizedDiff.reconciliation_buckets
      : {};

  const blockingReasons = [...(phaseCGate.blocking_reasons || [])];

  if (phaseCGate.phase_c_gate_ready !== true) {
    blockingReasons.push("phase_c_gate_not_ready");
  }

  if (phaseCPlan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }

  const environmentSensitiveCount = Array.isArray(buckets.environment_sensitive_review)
    ? buckets.environment_sensitive_review.length
    : 0;
  const structuredReviewCount = Array.isArray(buckets.structured_settings_review)
    ? buckets.structured_settings_review.length
    : 0;
  const reviewRequiredCount = Array.isArray(buckets.review_required)
    ? buckets.review_required.length
    : 0;
  const safeCandidateCount = Array.isArray(buckets.safe_reconcile_candidate)
    ? buckets.safe_reconcile_candidate.length
    : 0;

  if (environmentSensitiveCount > 0) {
    blockingReasons.push("environment_sensitive_settings_present");
  }
  if (structuredReviewCount > 0) {
    blockingReasons.push("structured_settings_review_present");
  }
  if (reviewRequiredCount > 0) {
    blockingReasons.push("general_settings_review_required");
  }

  const reconciliationReady = blockingReasons.length === 0;

  return {
    reconciliation_readiness_status: reconciliationReady
      ? "ready_for_safe_reconciliation"
      : "blocked_for_reconciliation",
    reconciliation_ready: reconciliationReady,
    safe_candidate_count: safeCandidateCount,
    environment_sensitive_count: environmentSensitiveCount,
    structured_review_count: structuredReviewCount,
    review_required_count: reviewRequiredCount,
    total_diff_count: Number(summary.diff_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseCSafeApplyCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 50));

  const buckets =
    normalizedDiff?.reconciliation_buckets &&
    typeof normalizedDiff.reconciliation_buckets === "object"
      ? normalizedDiff.reconciliation_buckets
      : {};

  if (readiness.reconciliation_ready !== true) {
    return {
      safe_apply_status: "blocked",
      candidate_count: 0,
      candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_c_reconciliation_not_ready"]
    };
  }

  const safeRows = Array.isArray(buckets.safe_reconcile_candidate)
    ? buckets.safe_reconcile_candidate
    : [];

  const candidates = safeRows.slice(0, limit).map(row => ({
    setting_key: String(row?.setting_key || "").trim(),
    source_value: row?.source_value ?? "",
    destination_value: row?.destination_value ?? "",
    source_value_normalized: row?.source_value_normalized ?? "",
    destination_value_normalized: row?.destination_value_normalized ?? "",
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    candidate_reason: "safe_reconcile_candidate"
  }));

  return {
    safe_apply_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseCReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeApplyCandidates =
    args.safeApplyCandidates && typeof args.safeApplyCandidates === "object"
      ? args.safeApplyCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_c_reconciliation_readiness",
    artifact_version: "v1",
    reconciliation_readiness_status: String(
      readiness.reconciliation_readiness_status || ""
    ).trim(),
    reconciliation_ready: readiness.reconciliation_ready === true,
    safe_candidate_count: Number(readiness.safe_candidate_count || 0),
    environment_sensitive_count: Number(readiness.environment_sensitive_count || 0),
    structured_review_count: Number(readiness.structured_review_count || 0),
    review_required_count: Number(readiness.review_required_count || 0),
    total_diff_count: Number(readiness.total_diff_count || 0),
    safe_apply_status: String(safeApplyCandidates.safe_apply_status || "").trim(),
    safe_apply_candidate_count: Number(safeApplyCandidates.candidate_count || 0),
    candidates: Array.isArray(safeApplyCandidates.candidates)
      ? safeApplyCandidates.candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeApplyCandidates.blocking_reasons)
        ? safeApplyCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressSettingReconciliationPayloadRow(row = {}) {
  const settingKey = String(row?.setting_key || "").trim();

  return {
    setting_key: settingKey,
    source_value: row?.source_value ?? "",
    destination_value: row?.destination_value ?? "",
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: "apply_source_value_to_destination",
    payload_shape: {
      key: settingKey,
      value: row?.source_value ?? "",
      mode: "safe_reconcile_candidate"
    }
  };
}

export function buildWordpressPhaseCReconciliationPayloadPlanner(args = {}) {
  const safeApplyCandidates =
    args.safeApplyCandidates && typeof args.safeApplyCandidates === "object"
      ? args.safeApplyCandidates
      : {};

  if (String(safeApplyCandidates.safe_apply_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      payload_rows: [],
      blocking_reasons: Array.isArray(safeApplyCandidates.blocking_reasons)
        ? safeApplyCandidates.blocking_reasons
        : ["phase_c_safe_apply_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeApplyCandidates.candidates)
    ? safeApplyCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressSettingReconciliationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseCReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_c_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    payload_rows: Array.isArray(planner.payload_rows)
      ? planner.payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseCExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const settings = migration.site_settings && typeof migration.site_settings === "object"
    ? migration.site_settings
    : {};
  const execution = settings.execution && typeof settings.execution === "object"
    ? settings.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 25))
  };
}

export function buildWordpressPhaseCExecutionGuard(args = {}) {
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseCPlan.enabled !== true) {
    blockingReasons.push("phase_c_not_enabled");
  }
  if (phaseCGate.phase_c_gate_ready !== true) {
    blockingReasons.push("phase_c_gate_not_ready");
  }
  if (readiness.reconciliation_ready !== true) {
    blockingReasons.push("phase_c_reconciliation_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_c_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_c_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_c_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseCPlan.reconciliation_only === true && phaseCPlan.apply === true) {
    blockingReasons.push("phase_c_plan_apply_conflicts_with_reconciliation_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_settings_reconciliation_execution"
      : "blocked_before_settings_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseCExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_c_execution_guard",
    artifact_version: "v1",
    execution_guard_status: String(guard.execution_guard_status || "").trim(),
    execution_guard_ready: guard.execution_guard_ready === true,
    dry_run_only: guard.dry_run_only === true,
    apply_requested: guard.apply_requested === true,
    candidate_limit: Number(guard.candidate_limit || 0),
    blocking_reasons: Array.isArray(guard.blocking_reasons)
      ? guard.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseCMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const payloadPlanner =
    args.payloadPlanner && typeof args.payloadPlanner === "object"
      ? args.payloadPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  if (executionGuard.execution_guard_ready !== true) {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_c_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_c_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      setting_key: String(row?.setting_key || "").trim(),
      reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
      reconciliation_action: String(row?.reconciliation_action || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (String(baseRecord.reconciliation_bucket || "").trim() !== "safe_reconcile_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_safe_reconcile_bucket"
      });
      continue;
    }

    if (String(baseRecord.reconciliation_action || "").trim() !== "apply_source_value_to_destination") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_reconciliation_action"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_reconcile_candidate_ready_for_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 25))
  );

  return {
    selector_status: "ready",
    selected_count: limitedSelected.length,
    rejected_count: rejected.length,
    selected_candidates: limitedSelected,
    rejected_candidates: rejected,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseCMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_c_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_candidates: Array.isArray(selector.selected_candidates)
      ? selector.selected_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressSettingMutationPayloadFromCandidate(row = {}) {
  const settingKey = String(row?.setting_key || "").trim();
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    setting_key: settingKey,
    mutation_mode: "safe_reconciliation",
    target_scope: "destination_site_setting",
    payload: {
      key: settingKey,
      value: Object.prototype.hasOwnProperty.call(payloadShape, "value")
        ? payloadShape.value
        : "",
      mode: String(payloadShape.mode || "safe_reconcile_candidate").trim()
    }
  };
}

export function buildWordpressPhaseCMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_c_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    setting_key: String(row?.setting_key || "").trim(),
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: String(row?.reconciliation_action || "").trim(),
    payload_reason: "composed_from_safe_reconcile_candidate",
    mutation_payload: buildWordpressSettingMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseCMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_c_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    composed_payloads: Array.isArray(composer.composed_payloads)
      ? composer.composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressSettingDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  return {
    setting_key: String(row?.setting_key || "").trim(),
    reconciliation_bucket: String(row?.reconciliation_bucket || "").trim(),
    reconciliation_action: String(row?.reconciliation_action || "").trim(),
    dry_run_result: "simulated_ready",
    reconciliation_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_apply_key: String(payload.key || "").trim(),
      expected_apply_mode: String(payload.mode || "").trim(),
      expected_source_value_applied: Object.prototype.hasOwnProperty.call(payload, "value")
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseCDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      reconciliation_evidence_preview_summary: {
        total_rows: 0,
        safe_reconcile_count: 0,
        expected_apply_key_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_c_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressSettingDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.reconciliation_evidence_preview &&
        typeof row.reconciliation_evidence_preview === "object"
          ? row.reconciliation_evidence_preview
          : {};

      acc.total_rows += 1;
      if (String(preview.expected_apply_mode || "").trim() === "safe_reconcile_candidate") {
        acc.safe_reconcile_count += 1;
      }
      if (String(preview.expected_apply_key || "").trim()) {
        acc.expected_apply_key_count += 1;
      }
      return acc;
    },
    {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    reconciliation_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseCDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_c_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    reconciliation_evidence_preview_summary:
      simulator?.reconciliation_evidence_preview_summary &&
      typeof simulator.reconciliation_evidence_preview_summary === "object"
        ? simulator.reconciliation_evidence_preview_summary
        : {
            total_rows: 0,
            safe_reconcile_count: 0,
            expected_apply_key_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseCFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseCPlan =
    args.phaseCPlan && typeof args.phaseCPlan === "object" ? args.phaseCPlan : {};
  const phaseCGate =
    args.phaseCGate && typeof args.phaseCGate === "object" ? args.phaseCGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const diffArtifact =
    args.diffArtifact && typeof args.diffArtifact === "object"
      ? args.diffArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const payloadArtifact =
    args.payloadArtifact && typeof args.payloadArtifact === "object"
      ? args.payloadArtifact
      : {};
  const executionGuardArtifact =
    args.executionGuardArtifact &&
    typeof args.executionGuardArtifact === "object"
      ? args.executionGuardArtifact
      : {};
  const mutationCandidateArtifact =
    args.mutationCandidateArtifact &&
    typeof args.mutationCandidateArtifact === "object"
      ? args.mutationCandidateArtifact
      : {};
  const mutationPayloadArtifact =
    args.mutationPayloadArtifact &&
    typeof args.mutationPayloadArtifact === "object"
      ? args.mutationPayloadArtifact
      : {};
  const dryRunExecutionArtifact =
    args.dryRunExecutionArtifact &&
    typeof args.dryRunExecutionArtifact === "object"
      ? args.dryRunExecutionArtifact
      : {};
  const normalizedDiff =
    args.normalizedDiff && typeof args.normalizedDiff === "object"
      ? args.normalizedDiff
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_c_final_operator_handoff",
    artifact_version: "v1",
    phase_c_enabled: phaseCPlan.enabled === true,
    phase_c_reconciliation_only: phaseCPlan.reconciliation_only === true,
    phase_c_apply_requested: phaseCPlan.apply === true,
    requested_settings_keys: Array.isArray(phaseCPlan.include_keys)
      ? phaseCPlan.include_keys
      : (
          Array.isArray(migration?.site_settings?.include_keys)
            ? migration.site_settings.include_keys
            : []
        ),
    phase_c_gate_status: String(phaseCGate.phase_c_gate_status || "").trim(),
    phase_c_inventory_status: String(inventoryArtifact.phase_c_inventory_status || "").trim(),
    phase_c_diff_status: String(diffArtifact.phase_c_gate_status || "").trim(),
    phase_c_reconciliation_readiness_status: String(
      readinessArtifact.reconciliation_readiness_status || ""
    ).trim(),
    phase_c_safe_apply_status: String(readinessArtifact.safe_apply_status || "").trim(),
    phase_c_payload_planner_status: String(
      payloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_c_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_c_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_c_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_c_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0
          },
    diff_summary:
      normalizedDiff?.diff_summary && typeof normalizedDiff.diff_summary === "object"
        ? normalizedDiff.diff_summary
        : {
            total_count: 0,
            aligned_count: 0,
            diff_count: 0,
            already_aligned_count: 0,
            safe_reconcile_candidate_count: 0,
            environment_sensitive_review_count: 0,
            structured_settings_review_count: 0,
            review_required_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_apply_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseCGate.blocking_reasons) ? phaseCGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(payloadArtifact.blocking_reasons)
        ? payloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.reconciliation_ready === true
        ? "review_safe_reconciliation_candidates"
        : "resolve_settings_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_settings_reconciliation_execution"
        ? "approve_settings_mutation_trial"
        : "hold_settings_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_settings_dry_run_preview"
        : "no_settings_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    diff_artifact: diffArtifact,
    readiness_artifact: readinessArtifact,
    payload_artifact: payloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}
