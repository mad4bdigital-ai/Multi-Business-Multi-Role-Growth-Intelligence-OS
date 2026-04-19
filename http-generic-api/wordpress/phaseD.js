// Auto-extracted from server.js — do not edit manually, use domain logic here.

export function normalizeWordpressFormType(value = "") {
  return normalizeWordpressPhaseAType(value);
}

export function isWordpressPhaseDFormType(value = "") {
  return WORDPRESS_PHASE_D_FORM_TYPES.has(normalizeWordpressFormType(value));
}

export function resolveWordpressPhaseDPlan(payload = {}) {
  const migration = payload?.migration || {};
  const forms = migration.forms_integrations && typeof migration.forms_integrations === "object"
    ? migration.forms_integrations
    : {};

  const requestedTypes = Array.isArray(forms.post_types)
    ? forms.post_types.map(x => normalizeWordpressFormType(x)).filter(Boolean)
    : [
        "wpcf7_contact_form",
        "wpforms",
        "fluentform",
        "gf_form",
        "elementor_form"
      ];

  return {
    enabled: forms.enabled === true,
    inventory_only:
      forms.inventory_only === undefined ? true : forms.inventory_only === true,
    apply: forms.apply === true,
    post_types: requestedTypes.filter(isWordpressPhaseDFormType),
    include_integrations:
      forms.include_integrations === undefined
        ? true
        : forms.include_integrations === true,
    max_items_per_type: Math.max(1, toPositiveInt(forms.max_items_per_type, 250))
  };
}

export function assertWordpressPhaseDPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_d_apply_conflicts_with_inventory_only");
  }

  if (!Array.isArray(plan.post_types) || plan.post_types.length === 0) {
    blockingReasons.push("phase_d_no_supported_form_types");
  }

  return {
    phase_d_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_d_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseDGate(args = {}) {
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
  const phaseCFinalOperatorHandoffBundle =
    args.phaseCFinalOperatorHandoffBundle &&
    typeof args.phaseCFinalOperatorHandoffBundle === "object"
      ? args.phaseCFinalOperatorHandoffBundle
      : {};
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDPlanStatus =
    args.phaseDPlanStatus && typeof args.phaseDPlanStatus === "object"
      ? args.phaseDPlanStatus
      : {};

  const blockingReasons = [...(phaseDPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_d");
  }

  if (
    phaseDPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseDPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  return {
    phase_d_gate_status:
      blockingReasons.length === 0 ? "ready_for_forms_inventory" : "blocked",
    phase_d_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseDPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressFormIntegrationSignals(item = {}) {
  const raw = JSON.stringify(item || {});

  return {
    has_email_routing:
      raw.includes("mail") || raw.includes("email") || raw.includes("recipient"),
    has_webhook:
      raw.includes("webhook") || raw.includes("zapier") || raw.includes("make.com"),
    has_recaptcha:
      raw.includes("recaptcha") || raw.includes("captcha"),
    has_smtp_dependency:
      raw.includes("smtp") || raw.includes("mailer"),
    has_crm_integration:
      raw.includes("hubspot") ||
      raw.includes("salesforce") ||
      raw.includes("mailchimp") ||
      raw.includes("crm"),
    has_payment_integration:
      raw.includes("stripe") ||
      raw.includes("paypal") ||
      raw.includes("payment"),
    has_file_upload:
      raw.includes("file") && raw.includes("upload"),
    has_conditional_logic:
      raw.includes("conditional") || raw.includes("logic")
  };
}

export function classifyWordpressFormInventoryRow(args = {}) {
  const item = args.item || {};
  const postType = normalizeWordpressFormType(args.postType);
  const integrations = inferWordpressFormIntegrationSignals(item);
  const integrationCount = Object.values(integrations).filter(v => v === true).length;

  return {
    post_type: postType,
    source_id: Number.isFinite(Number(item?.id)) ? Number(item.id) : null,
    slug: String(item?.slug || "").trim(),
    title: String(
      item?.title?.rendered ||
      item?.title ||
      item?.name ||
      item?.slug ||
      ""
    ).trim(),
    status: String(item?.status || "").trim(),
    integration_signals: integrations,
    integration_count: integrationCount,
    inventory_classification:
      integrationCount > 0 ? "integration_review_required" : "simple_form_candidate",
    migration_candidate: true
  };
}

export async function runWordpressFormsIntegrationsInventory(args = {}) {
  const {
    wpContext = {},
    phaseDPlan = {},
    phaseDGate = {}
  } = args;

  if (phaseDGate.phase_d_gate_ready !== true) {
    return {
      phase_d_inventory_status: "blocked",
      inventory_rows: [],
      inventory_counts: [],
      failures: [
        {
          code: "phase_d_forms_inventory_blocked",
          message: "Phase D forms/integrations inventory blocked by phase_d_gate.",
          blocking_reasons: phaseDGate.blocking_reasons || []
        }
      ]
    };
  }

  const inventoryRows = [];
  const inventoryCounts = [];
  const failures = [];

  for (const postType of phaseDPlan.post_types || []) {
    try {
      const itemsRaw = await listWordpressEntriesByType({
        siteRef: wpContext.source,
        postType,
        authRequired: false
      });

      const items = itemsRaw.slice(0, phaseDPlan.max_items_per_type);

      for (const item of items) {
        inventoryRows.push(
          classifyWordpressFormInventoryRow({
            postType,
            item
          })
        );
      }

      inventoryCounts.push({
        post_type: postType,
        discovered_count: itemsRaw.length,
        retained_count: items.length,
        inventory_only: phaseDPlan.inventory_only === true
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        code: err?.code || "wordpress_forms_inventory_failed",
        message: err?.message || "WordPress forms/integrations inventory failed."
      });
    }
  }

  return {
    phase_d_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    inventory_rows: inventoryRows,
    inventory_counts: inventoryCounts,
    failures
  };
}

export function buildWordpressPhaseDInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_d_forms_integrations_inventory",
    artifact_version: "v1",
    phase_d_gate_status: String(gate.phase_d_gate_status || "").trim(),
    phase_d_inventory_status: String(inventory.phase_d_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    inventory_counts: Array.isArray(inventory.inventory_counts)
      ? inventory.inventory_counts
      : [],
    inventory_rows: Array.isArray(inventory.inventory_rows)
      ? inventory.inventory_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function classifyWordpressFormMigrationStrategy(row = {}) {
  const postType = normalizeWordpressFormType(row?.post_type || "");
  const signals = normalizeWordpressFormIntegrationSignals(row?.integration_signals || {});

  let strategyScore = 0;
  const reasons = [];

  if (signals.has_email_routing) {
    strategyScore += 1;
    reasons.push("email_routing_present");
  }
  if (signals.has_webhook) {
    strategyScore += 2;
    reasons.push("webhook_present");
  }
  if (signals.has_recaptcha) {
    strategyScore += 2;
    reasons.push("recaptcha_present");
  }
  if (signals.has_smtp_dependency) {
    strategyScore += 2;
    reasons.push("smtp_dependency_present");
  }
  if (signals.has_crm_integration) {
    strategyScore += 3;
    reasons.push("crm_integration_present");
  }
  if (signals.has_payment_integration) {
    strategyScore += 4;
    reasons.push("payment_integration_present");
  }
  if (signals.has_file_upload) {
    strategyScore += 2;
    reasons.push("file_upload_present");
  }
  if (signals.has_conditional_logic) {
    strategyScore += 2;
    reasons.push("conditional_logic_present");
  }

  if (postType === "elementor_form") {
    strategyScore += 2;
    reasons.push("elementor_form_type");
  }
  if (postType === "gf_form") {
    strategyScore += 2;
    reasons.push("gravity_forms_type");
  }

  let migration_strategy = "simple_migrate_candidate";
  let migration_strategy_reason = "low_complexity_form";

  if (strategyScore >= 8) {
    migration_strategy = "rebuild_required";
    migration_strategy_reason = "high_integration_complexity";
  } else if (strategyScore >= 4) {
    migration_strategy = "reviewed_migrate_or_rebuild";
    migration_strategy_reason = "medium_integration_complexity";
  }

  if (signals.has_payment_integration) {
    migration_strategy = "rebuild_required";
    migration_strategy_reason = "payment_integrations_not_safe_for_direct_migration";
  }

  return {
    normalized_integration_signals: signals,
    integration_strategy_score: strategyScore,
    integration_strategy_reasons: reasons,
    migration_strategy,
    migration_strategy_reason
  };
}

export function buildWordpressPhaseDNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(row => {
    const strategy = classifyWordpressFormMigrationStrategy(row);
    return {
      ...row,
      integration_signals: strategy.normalized_integration_signals,
      integration_strategy_score: strategy.integration_strategy_score,
      integration_strategy_reasons: strategy.integration_strategy_reasons,
      migration_strategy: strategy.migration_strategy,
      migration_strategy_reason: strategy.migration_strategy_reason
    };
  });

  const summary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const strategy = String(row?.migration_strategy || "").trim();
      if (strategy === "simple_migrate_candidate") acc.simple_migrate_candidate_count += 1;
      else if (strategy === "reviewed_migrate_or_rebuild") acc.reviewed_migrate_or_rebuild_count += 1;
      else if (strategy === "rebuild_required") acc.rebuild_required_count += 1;

      return acc;
    },
    {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    }
  );

  const strategy_buckets = {
    simple_migrate_candidate: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "simple_migrate_candidate"
    ),
    reviewed_migrate_or_rebuild: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "reviewed_migrate_or_rebuild"
    ),
    rebuild_required: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "rebuild_required"
    )
  };

  return {
    normalized_inventory_rows: normalizedRows,
    strategy_summary: summary,
    strategy_buckets
  };
}

export function buildWordpressPhaseDNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_d_forms_integrations_strategy",
    artifact_version: "v1",
    phase_d_gate_status: String(gate.phase_d_gate_status || "").trim(),
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            simple_migrate_candidate_count: 0,
            reviewed_migrate_or_rebuild_count: 0,
            rebuild_required_count: 0
          },
    normalized_inventory_rows: Array.isArray(normalizedInventory.normalized_inventory_rows)
      ? normalizedInventory.normalized_inventory_rows
      : [],
    strategy_buckets:
      normalizedInventory?.strategy_buckets &&
      typeof normalizedInventory.strategy_buckets === "object"
        ? normalizedInventory.strategy_buckets
        : {
            simple_migrate_candidate: [],
            reviewed_migrate_or_rebuild: [],
            rebuild_required: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseDReadinessGate(args = {}) {
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const strategySummary =
    normalizedInventory?.strategy_summary &&
    typeof normalizedInventory.strategy_summary === "object"
      ? normalizedInventory.strategy_summary
      : {};
  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  const blockingReasons = [...(phaseDGate.blocking_reasons || [])];

  if (phaseDPlan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }

  const rebuildRequiredCount = Number(
    strategySummary.rebuild_required_count || 0
  );
  const reviewedCount = Number(
    strategySummary.reviewed_migrate_or_rebuild_count || 0
  );
  const simpleCount = Number(
    strategySummary.simple_migrate_candidate_count || 0
  );

  if (rebuildRequiredCount > 0) {
    blockingReasons.push("rebuild_required_integrations_present");
  }

  const readiness = blockingReasons.length === 0;

  const safeCandidates = Array.isArray(strategyBuckets.simple_migrate_candidate)
    ? strategyBuckets.simple_migrate_candidate
    : [];

  return {
    readiness_status: readiness
      ? "ready_for_safe_forms_migration"
      : "blocked_for_forms_migration",
    readiness_ready: readiness,
    simple_migrate_candidate_count: simpleCount,
    reviewed_migrate_or_rebuild_count: reviewedCount,
    rebuild_required_count: rebuildRequiredCount,
    safe_candidate_count: safeCandidates.length,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseDSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 50));

  const strategyBuckets =
    normalizedInventory?.strategy_buckets &&
    typeof normalizedInventory.strategy_buckets === "object"
      ? normalizedInventory.strategy_buckets
      : {};

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_d_readiness_not_ready"]
    };
  }

  const candidates = (
    Array.isArray(strategyBuckets.simple_migrate_candidate)
      ? strategyBuckets.simple_migrate_candidate
      : []
  )
    .slice(0, limit)
    .map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      inventory_classification: String(row?.inventory_classification || "").trim(),
      candidate_reason: "simple_migrate_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseDReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_d_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    simple_migrate_candidate_count: Number(
      readiness.simple_migrate_candidate_count || 0
    ),
    reviewed_migrate_or_rebuild_count: Number(
      readiness.reviewed_migrate_or_rebuild_count || 0
    ),
    rebuild_required_count: Number(readiness.rebuild_required_count || 0),
    safe_candidate_count: Number(readiness.safe_candidate_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidates: Array.isArray(safeCandidates.candidates)
      ? safeCandidates.candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressFormSafeMigrationPayloadRow(row = {}) {
  const postType = String(row?.post_type || "").trim();

  return {
    post_type: postType,
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    inventory_classification: String(row?.inventory_classification || "").trim(),
    payload_mode: "safe_form_migration_candidate",
    payload_shape: {
      post_type: postType,
      title: "preserve_from_source",
      slug: "preserve_from_source",
      status: "draft",
      content: "preserve_from_source",
      integrations: {
        email_routing: "preserve_if_supported",
        webhook: "review_if_present",
        recaptcha: "review_if_present",
        smtp: "environment_rebind_required",
        crm: "review_if_present",
        payment: "not_allowed_in_safe_candidates",
        file_upload: "review_if_present",
        conditional_logic: "preserve_if_supported"
      }
    }
  };
}

export function buildWordpressPhaseDMigrationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_d_safe_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeCandidates.candidates)
    ? safeCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressFormSafeMigrationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseDMigrationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_d_migration_payloads",
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

export function resolveWordpressPhaseDExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const forms = migration.forms_integrations && typeof migration.forms_integrations === "object"
    ? migration.forms_integrations
    : {};
  const execution = forms.execution && typeof forms.execution === "object"
    ? forms.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 25))
  };
}

export function buildWordpressPhaseDExecutionGuard(args = {}) {
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
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

  if (phaseDPlan.enabled !== true) {
    blockingReasons.push("phase_d_not_enabled");
  }
  if (phaseDGate.phase_d_gate_ready !== true) {
    blockingReasons.push("phase_d_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_d_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_d_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_d_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_d_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseDPlan.inventory_only === true && phaseDPlan.apply === true) {
    blockingReasons.push("phase_d_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_forms_migration_execution"
      : "blocked_before_forms_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseDExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_d_execution_guard",
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

export function buildWordpressPhaseDMutationCandidateSelector(args = {}) {
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
        : ["phase_d_execution_guard_not_ready"]
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
        : ["phase_d_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      payload_mode: String(row?.payload_mode || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (String(baseRecord.migration_strategy || "").trim() !== "simple_migrate_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_simple_migrate_strategy"
      });
      continue;
    }

    if (String(baseRecord.payload_mode || "").trim() !== "safe_form_migration_candidate") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_payload_mode"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_form_migration_candidate_ready_for_mutation"
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

export function buildWordpressPhaseDMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_d_mutation_candidates",
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

export function buildWordpressFormMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};
  const integrations =
    payloadShape?.integrations && typeof payloadShape.integrations === "object"
      ? payloadShape.integrations
      : {};

  return {
    post_type: String(row?.post_type || "").trim(),
    mutation_mode: "safe_form_migration",
    target_scope: "destination_form_entity",
    payload: {
      title: Object.prototype.hasOwnProperty.call(payloadShape, "title")
        ? payloadShape.title
        : "preserve_from_source",
      slug: Object.prototype.hasOwnProperty.call(payloadShape, "slug")
        ? payloadShape.slug
        : "preserve_from_source",
      status: Object.prototype.hasOwnProperty.call(payloadShape, "status")
        ? payloadShape.status
        : "draft",
      content: Object.prototype.hasOwnProperty.call(payloadShape, "content")
        ? payloadShape.content
        : "preserve_from_source",
      integrations: {
        email_routing: String(integrations.email_routing || "").trim(),
        webhook: String(integrations.webhook || "").trim(),
        recaptcha: String(integrations.recaptcha || "").trim(),
        smtp: String(integrations.smtp || "").trim(),
        crm: String(integrations.crm || "").trim(),
        payment: String(integrations.payment || "").trim(),
        file_upload: String(integrations.file_upload || "").trim(),
        conditional_logic: String(integrations.conditional_logic || "").trim()
      }
    }
  };
}

export function buildWordpressPhaseDMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_d_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_reason: "composed_from_safe_form_migration_candidate",
    mutation_payload: buildWordpressFormMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseDMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_d_mutation_payloads",
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

export function simulateWordpressFormDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};
  const integrations =
    payload?.integrations && typeof payload.integrations === "object"
      ? payload.integrations
      : {};

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    dry_run_result: "simulated_ready",
    integration_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_target_status: String(payload.status || "").trim(),
      expected_title_mode: String(payload.title || "").trim(),
      expected_slug_mode: String(payload.slug || "").trim(),
      expected_content_mode: String(payload.content || "").trim(),
      integrations_preview: {
        email_routing: String(integrations.email_routing || "").trim(),
        webhook: String(integrations.webhook || "").trim(),
        recaptcha: String(integrations.recaptcha || "").trim(),
        smtp: String(integrations.smtp || "").trim(),
        crm: String(integrations.crm || "").trim(),
        payment: String(integrations.payment || "").trim(),
        file_upload: String(integrations.file_upload || "").trim(),
        conditional_logic: String(integrations.conditional_logic || "").trim()
      }
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseDDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      integration_evidence_preview_summary: {
        total_rows: 0,
        expected_draft_count: 0,
        safe_form_migration_count: 0,
        smtp_rebind_required_count: 0,
        webhook_review_count: 0,
        recaptcha_review_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_d_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressFormDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.integration_evidence_preview &&
        typeof row.integration_evidence_preview === "object"
          ? row.integration_evidence_preview
          : {};
      const integrations =
        preview?.integrations_preview &&
        typeof preview.integrations_preview === "object"
          ? preview.integrations_preview
          : {};

      acc.total_rows += 1;

      if (String(preview.expected_target_status || "").trim() === "draft") {
        acc.expected_draft_count += 1;
      }
      if (String(preview.mutation_mode || "").trim() === "safe_form_migration") {
        acc.safe_form_migration_count += 1;
      }
      if (String(integrations.smtp || "").trim() === "environment_rebind_required") {
        acc.smtp_rebind_required_count += 1;
      }
      if (String(integrations.webhook || "").trim() === "review_if_present") {
        acc.webhook_review_count += 1;
      }
      if (String(integrations.recaptcha || "").trim() === "review_if_present") {
        acc.recaptcha_review_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    integration_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseDDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_d_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    integration_evidence_preview_summary:
      simulator?.integration_evidence_preview_summary &&
      typeof simulator.integration_evidence_preview_summary === "object"
        ? simulator.integration_evidence_preview_summary
        : {
            total_rows: 0,
            expected_draft_count: 0,
            safe_form_migration_count: 0,
            smtp_rebind_required_count: 0,
            webhook_review_count: 0,
            recaptcha_review_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export async function runSshWpCliMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  return {
    ok: true,
    transport: "ssh_wpcli",
    message: "SSH/WP-CLI migration plan prepared.",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "ssh_wpcli"),
    runtime_delta: {},
    settings_delta: {},
    plugin_delta: {}
  };
}

export function buildWordpressPhaseDFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseDPlan =
    args.phaseDPlan && typeof args.phaseDPlan === "object" ? args.phaseDPlan : {};
  const phaseDGate =
    args.phaseDGate && typeof args.phaseDGate === "object" ? args.phaseDGate : {};
  const inventoryArtifact =
    args.inventoryArtifact && typeof args.inventoryArtifact === "object"
      ? args.inventoryArtifact
      : {};
  const normalizedInventoryArtifact =
    args.normalizedInventoryArtifact &&
    typeof args.normalizedInventoryArtifact === "object"
      ? args.normalizedInventoryArtifact
      : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const migrationPayloadArtifact =
    args.migrationPayloadArtifact &&
    typeof args.migrationPayloadArtifact === "object"
      ? args.migrationPayloadArtifact
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
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_d_final_operator_handoff",
    artifact_version: "v1",
    phase_d_enabled: phaseDPlan.enabled === true,
    phase_d_inventory_only: phaseDPlan.inventory_only === true,
    phase_d_apply_requested: phaseDPlan.apply === true,
    requested_form_post_types: Array.isArray(phaseDPlan.post_types)
      ? phaseDPlan.post_types
      : (
          Array.isArray(migration?.forms_integrations?.post_types)
            ? migration.forms_integrations.post_types
            : []
        ),
    phase_d_gate_status: String(phaseDGate.phase_d_gate_status || "").trim(),
    phase_d_inventory_status: String(inventoryArtifact.phase_d_inventory_status || "").trim(),
    phase_d_strategy_status: String(
      normalizedInventoryArtifact.phase_d_gate_status || ""
    ).trim(),
    phase_d_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_d_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_d_payload_planner_status: String(
      migrationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_d_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_d_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_d_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_d_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_counts: Array.isArray(inventoryArtifact.inventory_counts)
      ? inventoryArtifact.inventory_counts
      : [],
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            simple_migrate_candidate_count: 0,
            reviewed_migrate_or_rebuild_count: 0,
            rebuild_required_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseDGate.blocking_reasons) ? phaseDGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(migrationPayloadArtifact.blocking_reasons)
        ? migrationPayloadArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mutationCandidateArtifact.blocking_reasons)
        ? mutationCandidateArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_forms_candidates"
        : "resolve_forms_migration_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_forms_migration_execution"
        ? "approve_forms_mutation_trial"
        : "hold_forms_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_forms_dry_run_preview"
        : "no_forms_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    migration_payload_artifact: migrationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}
