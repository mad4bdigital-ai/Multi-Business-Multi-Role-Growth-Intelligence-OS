// Auto-extracted from server.js — do not edit manually, use domain logic here.

export function resolveWordpressPhaseHPlan(payload = {}) {
  const migration = payload?.migration || {};
  const analytics = migration.analytics_tracking && typeof migration.analytics_tracking === "object"
    ? migration.analytics_tracking
    : {};

  return {
    enabled: analytics.enabled === true,
    inventory_only:
      analytics.inventory_only === undefined ? true : analytics.inventory_only === true,
    apply: analytics.apply === true,
    include_google_analytics:
      analytics.include_google_analytics === undefined
        ? true
        : analytics.include_google_analytics === true,
    include_gtm:
      analytics.include_gtm === undefined ? true : analytics.include_gtm === true,
    include_meta_pixel:
      analytics.include_meta_pixel === undefined
        ? true
        : analytics.include_meta_pixel === true,
    include_tiktok_pixel:
      analytics.include_tiktok_pixel === true,
    include_custom_tracking:
      analytics.include_custom_tracking === undefined
        ? true
        : analytics.include_custom_tracking === true,
    max_items: Math.max(1, toPositiveInt(analytics.max_items, 500))
  };
}

export function assertWordpressPhaseHPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_h_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_google_analytics !== true &&
    plan.include_gtm !== true &&
    plan.include_meta_pixel !== true &&
    plan.include_tiktok_pixel !== true &&
    plan.include_custom_tracking !== true
  ) {
    blockingReasons.push("phase_h_no_inventory_scope_selected");
  }

  return {
    phase_h_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_h_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseHGate(args = {}) {
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
  const phaseDFinalOperatorHandoffBundle =
    args.phaseDFinalOperatorHandoffBundle &&
    typeof args.phaseDFinalOperatorHandoffBundle === "object"
      ? args.phaseDFinalOperatorHandoffBundle
      : {};
  const phaseEFinalOperatorHandoffBundle =
    args.phaseEFinalOperatorHandoffBundle &&
    typeof args.phaseEFinalOperatorHandoffBundle === "object"
      ? args.phaseEFinalOperatorHandoffBundle
      : {};
  const phaseFFinalOperatorHandoffBundle =
    args.phaseFFinalOperatorHandoffBundle &&
    typeof args.phaseFFinalOperatorHandoffBundle === "object"
      ? args.phaseFFinalOperatorHandoffBundle
      : {};
  const phaseGFinalOperatorHandoffBundle =
    args.phaseGFinalOperatorHandoffBundle &&
    typeof args.phaseGFinalOperatorHandoffBundle === "object"
      ? args.phaseGFinalOperatorHandoffBundle
      : {};
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHPlanStatus =
    args.phaseHPlanStatus && typeof args.phaseHPlanStatus === "object"
      ? args.phaseHPlanStatus
      : {};

  const blockingReasons = [...(phaseHPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_h");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  if (
    phaseHPlan.enabled === true &&
    phaseGFinalOperatorHandoffBundle.phase_g_enabled === true &&
    String(phaseGFinalOperatorHandoffBundle.phase_g_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_g_seo_stage_blocked");
  }

  return {
    phase_h_gate_status:
      blockingReasons.length === 0
        ? "ready_for_analytics_tracking_inventory"
        : "blocked",
    phase_h_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseHPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressAnalyticsPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_site_kit: normalized.some(x => x.includes("google-site-kit")),
    has_gtm_plugin: normalized.some(x => x.includes("google-tag-manager")),
    has_pixel_plugin: normalized.some(
      x => x.includes("facebook-for-woocommerce") || x.includes("pixel")
    ),
    has_cookie_plugin: normalized.some(
      x =>
        x.includes("cookieyes") ||
        x.includes("complianz") ||
        x.includes("cookie-notice")
    ),
    has_ga_plugin: normalized.some(
      x =>
        x.includes("ga-google-analytics") ||
        x.includes("monsterinsights") ||
        x.includes("site-kit")
    )
  };
}

export function buildWordpressTrackingRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const tracking =
    siteProfile?.tracking_surfaces &&
    typeof siteProfile.tracking_surfaces === "object" &&
    !Array.isArray(siteProfile.tracking_surfaces)
      ? siteProfile.tracking_surfaces
      : {};

  const trackers = [
    "google_analytics",
    "gtm",
    "meta_pixel",
    "tiktok_pixel",
    "custom_tracking"
  ];

  for (const key of trackers.slice(0, limit)) {
    if (!Object.prototype.hasOwnProperty.call(tracking, key)) continue;
    const value =
      tracking[key] && typeof tracking[key] === "object" && !Array.isArray(tracking[key])
        ? tracking[key]
        : {};

    rows.push({
      entity_type: "tracking_surface",
      tracking_key: String(key || "").trim(),
      tracking_id: String(
        value.tracking_id || value.id || value.container_id || ""
      ).trim(),
      implementation_mode: String(value.implementation_mode || value.mode || "").trim(),
      location_hint: String(value.location_hint || value.location || "").trim(),
      consent_required:
        value.consent_required === true ||
        String(value.consent_required || "").trim().toLowerCase() === "true",
      inventory_classification: "tracking_surface"
    });
  }

  return rows;
}

export function buildWordpressConsentRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const consent =
    siteProfile?.consent_surfaces &&
    typeof siteProfile.consent_surfaces === "object" &&
    !Array.isArray(siteProfile.consent_surfaces)
      ? siteProfile.consent_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(consent).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "consent_surface",
      consent_key: String(key || "").trim(),
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      region_scope: String(value.region_scope || "").trim(),
      blocks_tracking_before_consent:
        value.blocks_tracking_before_consent === true ||
        String(value.blocks_tracking_before_consent || "").trim().toLowerCase() ===
          "true",
      inventory_classification: "consent_surface"
    });
  }

  return rows;
}

export async function runWordpressAnalyticsTrackingInventory(args = {}) {
  const {
    wpContext = {},
    phaseHPlan = {},
    phaseHGate = {}
  } = args;

  if (phaseHGate.phase_h_gate_ready !== true) {
    return {
      phase_h_inventory_status: "blocked",
      plugin_signals: {},
      tracking_rows: [],
      consent_rows: [],
      summary: {
        tracking_count: 0,
        consent_count: 0
      },
      failures: [
        {
          code: "phase_h_analytics_inventory_blocked",
          message: "Phase H analytics/tracking inventory blocked by phase_h_gate.",
          blocking_reasons: phaseHGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressAnalyticsPluginSignals(sourceProfile);
    const trackingRows = buildWordpressTrackingRows(sourceProfile, phaseHPlan.max_items).filter(
      row =>
        (phaseHPlan.include_google_analytics === true &&
          row.tracking_key === "google_analytics") ||
        (phaseHPlan.include_gtm === true && row.tracking_key === "gtm") ||
        (phaseHPlan.include_meta_pixel === true && row.tracking_key === "meta_pixel") ||
        (phaseHPlan.include_tiktok_pixel === true && row.tracking_key === "tiktok_pixel") ||
        (phaseHPlan.include_custom_tracking === true &&
          row.tracking_key === "custom_tracking")
    );
    const consentRows = buildWordpressConsentRows(sourceProfile, phaseHPlan.max_items);

    return {
      phase_h_inventory_status: "completed",
      plugin_signals: pluginSignals,
      tracking_rows: trackingRows,
      consent_rows: consentRows,
      summary: {
        tracking_count: trackingRows.length,
        consent_count: consentRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_analytics_inventory_failed",
      message: err?.message || "WordPress analytics/tracking inventory failed."
    });

    return {
      phase_h_inventory_status: "completed_with_failures",
      plugin_signals: {},
      tracking_rows: [],
      consent_rows: [],
      summary: {
        tracking_count: 0,
        consent_count: 0
      },
      failures
    };
  }
}

export function buildWordpressPhaseHInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_h_analytics_tracking_inventory",
    artifact_version: "v1",
    phase_h_gate_status: String(gate.phase_h_gate_status || "").trim(),
    phase_h_inventory_status: String(inventory.phase_h_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            tracking_count: 0,
            consent_count: 0
          },
    tracking_rows: Array.isArray(inventory.tracking_rows) ? inventory.tracking_rows : [],
    consent_rows: Array.isArray(inventory.consent_rows) ? inventory.consent_rows : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressTrackingTextValue(value = "") {
  return String(value ?? "").trim();
}

export function classifyWordpressTrackingRisk(row = {}) {
  const trackingKey = normalizeWordpressTrackingTextValue(row?.tracking_key);
  const trackingId = normalizeWordpressTrackingTextValue(row?.tracking_id);
  const implementationMode = normalizeWordpressTrackingTextValue(
    row?.implementation_mode
  );
  const locationHint = normalizeWordpressTrackingTextValue(row?.location_hint);
  const consentRequired = row?.consent_required === true;

  let riskScore = 0;
  const reasons = [];

  if (!trackingId) {
    riskScore += 3;
    reasons.push("missing_tracking_id");
  }

  if (!implementationMode) {
    riskScore += 2;
    reasons.push("missing_implementation_mode");
  } else if (
    implementationMode === "hardcoded" ||
    implementationMode === "theme_code" ||
    implementationMode === "template_injection"
  ) {
    riskScore += 2;
    reasons.push("hardcoded_implementation_mode");
  } else if (
    implementationMode === "plugin" ||
    implementationMode === "gtm" ||
    implementationMode === "consent_manager"
  ) {
    riskScore += 1;
    reasons.push("managed_implementation_mode");
  }

  if (!locationHint) {
    riskScore += 1;
    reasons.push("missing_location_hint");
  }

  if (
    (trackingKey === "meta_pixel" || trackingKey === "tiktok_pixel") &&
    consentRequired !== true
  ) {
    riskScore += 3;
    reasons.push("marketing_tracker_without_consent_requirement");
  }

  if (trackingKey === "custom_tracking") {
    riskScore += 2;
    reasons.push("custom_tracking_surface");
  }

  let tracking_risk_class = "low";
  if (riskScore >= 5) tracking_risk_class = "high";
  else if (riskScore >= 2) tracking_risk_class = "medium";

  return {
    tracking_key: trackingKey,
    tracking_id: trackingId,
    implementation_mode: implementationMode,
    location_hint: locationHint,
    consent_required: consentRequired,
    tracking_risk_score: riskScore,
    tracking_risk_class,
    tracking_risk_reasons: reasons
  };
}

export function classifyWordpressConsentRisk(row = {}) {
  const consentKey = normalizeWordpressTrackingTextValue(row?.consent_key);
  const provider = normalizeWordpressTrackingTextValue(row?.provider);
  const mode = normalizeWordpressTrackingTextValue(row?.mode);
  const regionScope = normalizeWordpressTrackingTextValue(row?.region_scope);
  const blocksTrackingBeforeConsent = row?.blocks_tracking_before_consent === true;

  let riskScore = 0;
  const reasons = [];

  if (!provider) {
    riskScore += 2;
    reasons.push("missing_consent_provider");
  }

  if (!mode) {
    riskScore += 1;
    reasons.push("missing_consent_mode");
  }

  if (!regionScope) {
    riskScore += 1;
    reasons.push("missing_region_scope");
  }

  if (blocksTrackingBeforeConsent !== true) {
    riskScore += 3;
    reasons.push("tracking_not_blocked_before_consent");
  }

  if (consentKey === "custom_consent") {
    riskScore += 2;
    reasons.push("custom_consent_surface");
  }

  let consent_risk_class = "low";
  if (riskScore >= 5) consent_risk_class = "high";
  else if (riskScore >= 2) consent_risk_class = "medium";

  return {
    consent_key: consentKey,
    provider,
    mode,
    region_scope: regionScope,
    blocks_tracking_before_consent: blocksTrackingBeforeConsent,
    consent_risk_score: riskScore,
    consent_risk_class,
    consent_risk_reasons: reasons
  };
}

export function buildWordpressPhaseHNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const trackingRows = Array.isArray(inventory.tracking_rows)
    ? inventory.tracking_rows
    : [];
  const consentRows = Array.isArray(inventory.consent_rows)
    ? inventory.consent_rows
    : [];

  const normalizedTrackingRows = trackingRows.map(row => {
    const risk = classifyWordpressTrackingRisk(row);
    return {
      ...row,
      tracking_key: risk.tracking_key,
      tracking_id: risk.tracking_id,
      implementation_mode: risk.implementation_mode,
      location_hint: risk.location_hint,
      consent_required: risk.consent_required,
      tracking_risk_score: risk.tracking_risk_score,
      tracking_risk_class: risk.tracking_risk_class,
      tracking_risk_reasons: risk.tracking_risk_reasons
    };
  });

  const normalizedConsentRows = consentRows.map(row => {
    const risk = classifyWordpressConsentRisk(row);
    return {
      ...row,
      consent_key: risk.consent_key,
      provider: risk.provider,
      mode: risk.mode,
      region_scope: risk.region_scope,
      blocks_tracking_before_consent: risk.blocks_tracking_before_consent,
      consent_risk_score: risk.consent_risk_score,
      consent_risk_class: risk.consent_risk_class,
      consent_risk_reasons: risk.consent_risk_reasons
    };
  });

  const riskSummary = {
    tracking_total_count: normalizedTrackingRows.length,
    tracking_high_risk_count: normalizedTrackingRows.filter(
      x => String(x?.tracking_risk_class || "").trim() === "high"
    ).length,
    tracking_medium_risk_count: normalizedTrackingRows.filter(
      x => String(x?.tracking_risk_class || "").trim() === "medium"
    ).length,
    consent_total_count: normalizedConsentRows.length,
    consent_high_risk_count: normalizedConsentRows.filter(
      x => String(x?.consent_risk_class || "").trim() === "high"
    ).length,
    consent_medium_risk_count: normalizedConsentRows.filter(
      x => String(x?.consent_risk_class || "").trim() === "medium"
    ).length
  };

  return {
    normalized_tracking_rows: normalizedTrackingRows,
    normalized_consent_rows: normalizedConsentRows,
    risk_summary: riskSummary
  };
}

export function buildWordpressPhaseHNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_h_analytics_tracking_strategy",
    artifact_version: "v1",
    phase_h_gate_status: String(gate.phase_h_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            tracking_total_count: 0,
            tracking_high_risk_count: 0,
            tracking_medium_risk_count: 0,
            consent_total_count: 0,
            consent_high_risk_count: 0,
            consent_medium_risk_count: 0
          },
    normalized_tracking_rows: Array.isArray(normalizedInventory.normalized_tracking_rows)
      ? normalizedInventory.normalized_tracking_rows
      : [],
    normalized_consent_rows: Array.isArray(normalizedInventory.normalized_consent_rows)
      ? normalizedInventory.normalized_consent_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseHReadinessGate(args = {}) {
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHGate =
    args.phaseHGate && typeof args.phaseHGate === "object" ? args.phaseHGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseHGate.blocking_reasons || [])];

  if (phaseHPlan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }

  const trackingHighRiskCount = Number(riskSummary.tracking_high_risk_count || 0);
  const consentHighRiskCount = Number(riskSummary.consent_high_risk_count || 0);

  if (trackingHighRiskCount > 0) {
    blockingReasons.push("high_risk_tracking_surfaces_present");
  }
  if (consentHighRiskCount > 0) {
    blockingReasons.push("high_risk_consent_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_analytics_tracking_reconciliation"
      : "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: readiness,
    tracking_high_risk_count: trackingHighRiskCount,
    tracking_medium_risk_count: Number(riskSummary.tracking_medium_risk_count || 0),
    consent_high_risk_count: consentHighRiskCount,
    consent_medium_risk_count: Number(riskSummary.consent_medium_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseHSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      tracking_candidates: [],
      consent_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_h_readiness_not_ready"]
    };
  }

  const normalizedTrackingRows = Array.isArray(normalizedInventory.normalized_tracking_rows)
    ? normalizedInventory.normalized_tracking_rows
    : [];
  const normalizedConsentRows = Array.isArray(normalizedInventory.normalized_consent_rows)
    ? normalizedInventory.normalized_consent_rows
    : [];

  const trackingCandidates = normalizedTrackingRows
    .filter(row => String(row?.tracking_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "tracking_surface",
      tracking_key: String(row?.tracking_key || "").trim(),
      tracking_id: String(row?.tracking_id || "").trim(),
      implementation_mode: String(row?.implementation_mode || "").trim(),
      location_hint: String(row?.location_hint || "").trim(),
      consent_required: row?.consent_required === true,
      tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
      candidate_reason: "non_high_risk_tracking_candidate"
    }));

  const consentCandidates = normalizedConsentRows
    .filter(row => String(row?.consent_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "consent_surface",
      consent_key: String(row?.consent_key || "").trim(),
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      region_scope: String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
      consent_risk_class: String(row?.consent_risk_class || "").trim(),
      candidate_reason: "non_high_risk_consent_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: trackingCandidates.length + consentCandidates.length,
    tracking_candidates: trackingCandidates,
    consent_candidates: consentCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseHReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_h_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    tracking_high_risk_count: Number(readiness.tracking_high_risk_count || 0),
    tracking_medium_risk_count: Number(readiness.tracking_medium_risk_count || 0),
    consent_high_risk_count: Number(readiness.consent_high_risk_count || 0),
    consent_medium_risk_count: Number(readiness.consent_medium_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    tracking_candidates: Array.isArray(safeCandidates.tracking_candidates)
      ? safeCandidates.tracking_candidates
      : [],
    consent_candidates: Array.isArray(safeCandidates.consent_candidates)
      ? safeCandidates.consent_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressTrackingReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "tracking_surface",
    tracking_key: String(row?.tracking_key || "").trim(),
    tracking_id: String(row?.tracking_id || "").trim(),
    implementation_mode: String(row?.implementation_mode || "").trim(),
    location_hint: String(row?.location_hint || "").trim(),
    consent_required: row?.consent_required === true,
    tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
    payload_mode: "safe_tracking_reconciliation_candidate",
    payload_shape: {
      tracking_key: String(row?.tracking_key || "").trim(),
      tracking_id: String(row?.tracking_id || "").trim(),
      implementation_mode: String(row?.implementation_mode || "").trim(),
      location_hint: String(row?.location_hint || "").trim(),
      consent_required: row?.consent_required === true,
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressConsentReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    payload_mode: "safe_consent_reconciliation_candidate",
    payload_shape: {
      consent_key: String(row?.consent_key || "").trim(),
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      region_scope: String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: row?.blocks_tracking_before_consent === true,
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseHReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      tracking_payload_rows: [],
      consent_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_h_safe_candidates_not_ready"]
    };
  }

  const trackingCandidates = Array.isArray(safeCandidates.tracking_candidates)
    ? safeCandidates.tracking_candidates
    : [];
  const consentCandidates = Array.isArray(safeCandidates.consent_candidates)
    ? safeCandidates.consent_candidates
    : [];

  const trackingPayloadRows = trackingCandidates.map(
    buildWordpressTrackingReconciliationPayloadRow
  );
  const consentPayloadRows = consentCandidates.map(
    buildWordpressConsentReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count: trackingPayloadRows.length + consentPayloadRows.length,
    tracking_payload_rows: trackingPayloadRows,
    consent_payload_rows: consentPayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseHReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_h_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    tracking_payload_rows: Array.isArray(planner.tracking_payload_rows)
      ? planner.tracking_payload_rows
      : [],
    consent_payload_rows: Array.isArray(planner.consent_payload_rows)
      ? planner.consent_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseHExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const analyticsTracking =
    migration.analytics_tracking && typeof migration.analytics_tracking === "object"
      ? migration.analytics_tracking
      : {};
  const execution =
    analyticsTracking.execution && typeof analyticsTracking.execution === "object"
      ? analyticsTracking.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

export function buildWordpressPhaseHExecutionGuard(args = {}) {
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHGate =
    args.phaseHGate && typeof args.phaseHGate === "object" ? args.phaseHGate : {};
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

  if (phaseHPlan.enabled !== true) {
    blockingReasons.push("phase_h_not_enabled");
  }
  if (phaseHGate.phase_h_gate_ready !== true) {
    blockingReasons.push("phase_h_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_h_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_h_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_h_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_h_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseHPlan.inventory_only === true && phaseHPlan.apply === true) {
    blockingReasons.push("phase_h_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_analytics_tracking_reconciliation_execution"
      : "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseHExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_h_execution_guard",
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

export function buildWordpressTrackingMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_tracking_reconciliation",
    target_scope: "destination_wordpress_tracking_surface",
    payload: {
      tracking_key: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_key")
        ? payloadShape.tracking_key
        : String(row?.tracking_key || "").trim(),
      tracking_id: Object.prototype.hasOwnProperty.call(payloadShape, "tracking_id")
        ? payloadShape.tracking_id
        : String(row?.tracking_id || "").trim(),
      implementation_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "implementation_mode"
      )
        ? payloadShape.implementation_mode
        : String(row?.implementation_mode || "").trim(),
      location_hint: Object.prototype.hasOwnProperty.call(payloadShape, "location_hint")
        ? payloadShape.location_hint
        : String(row?.location_hint || "").trim(),
      consent_required: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "consent_required"
      )
        ? payloadShape.consent_required === true
        : row?.consent_required === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressConsentMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_consent_reconciliation",
    target_scope: "destination_wordpress_consent_surface",
    payload: {
      consent_key: Object.prototype.hasOwnProperty.call(payloadShape, "consent_key")
        ? payloadShape.consent_key
        : String(row?.consent_key || "").trim(),
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      region_scope: Object.prototype.hasOwnProperty.call(payloadShape, "region_scope")
        ? payloadShape.region_scope
        : String(row?.region_scope || "").trim(),
      blocks_tracking_before_consent: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "blocks_tracking_before_consent"
      )
        ? payloadShape.blocks_tracking_before_consent === true
        : row?.blocks_tracking_before_consent === true,
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseHMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      tracking_composed_payloads: [],
      consent_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_h_mutation_candidates_not_ready"]
    };
  }

  const selectedTrackingCandidates = Array.isArray(selector.selected_tracking_candidates)
    ? selector.selected_tracking_candidates
    : [];
  const selectedConsentCandidates = Array.isArray(selector.selected_consent_candidates)
    ? selector.selected_consent_candidates
    : [];

  const trackingComposedPayloads = selectedTrackingCandidates.map(row => ({
    entity_type: "tracking_surface",
    tracking_key: String(row?.tracking_key || "").trim(),
    tracking_id: String(row?.tracking_id || "").trim(),
    implementation_mode: String(row?.implementation_mode || "").trim(),
    location_hint: String(row?.location_hint || "").trim(),
    tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
    payload_reason: "composed_from_safe_tracking_candidate",
    mutation_payload: buildWordpressTrackingMutationPayloadFromCandidate(row)
  }));

  const consentComposedPayloads = selectedConsentCandidates.map(row => ({
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    payload_reason: "composed_from_safe_consent_candidate",
    mutation_payload: buildWordpressConsentMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: trackingComposedPayloads.length + consentComposedPayloads.length,
    tracking_composed_payloads: trackingComposedPayloads,
    consent_composed_payloads: consentComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseHMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_h_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    tracking_composed_payloads: Array.isArray(composer.tracking_composed_payloads)
      ? composer.tracking_composed_payloads
      : [],
    consent_composed_payloads: Array.isArray(composer.consent_composed_payloads)
      ? composer.consent_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseHMutationCandidateSelector(args = {}) {
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
      selected_tracking_candidates: [],
      selected_consent_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_h_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_tracking_candidates: [],
      selected_consent_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_h_payload_planner_not_ready"]
    };
  }

  const trackingPayloadRows = Array.isArray(payloadPlanner.tracking_payload_rows)
    ? payloadPlanner.tracking_payload_rows
    : [];
  const consentPayloadRows = Array.isArray(payloadPlanner.consent_payload_rows)
    ? payloadPlanner.consent_payload_rows
    : [];

  const selectedTrackingCandidates = [];
  const selectedConsentCandidates = [];
  const rejectedCandidates = [];

  for (const row of trackingPayloadRows) {
    const trackingRiskClass = String(row?.tracking_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (trackingRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "tracking_surface",
        tracking_key: String(row?.tracking_key || "").trim(),
        rejection_reason: "high_risk_tracking_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_tracking_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "tracking_surface",
        tracking_key: String(row?.tracking_key || "").trim(),
        rejection_reason: "unsupported_tracking_payload_mode"
      });
      continue;
    }

    selectedTrackingCandidates.push({
      ...row,
      candidate_reason: "safe_tracking_candidate_ready_for_mutation"
    });
  }

  for (const row of consentPayloadRows) {
    const consentRiskClass = String(row?.consent_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (consentRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "consent_surface",
        consent_key: String(row?.consent_key || "").trim(),
        rejection_reason: "high_risk_consent_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_consent_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "consent_surface",
        consent_key: String(row?.consent_key || "").trim(),
        rejection_reason: "unsupported_consent_payload_mode"
      });
      continue;
    }

    selectedConsentCandidates.push({
      ...row,
      candidate_reason: "safe_consent_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedTrackingCandidates =
    selectedTrackingCandidates.slice(0, candidateLimit);
  const limitedSelectedConsentCandidates =
    selectedConsentCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedTrackingCandidates.length +
      limitedSelectedConsentCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_tracking_candidates: limitedSelectedTrackingCandidates,
    selected_consent_candidates: limitedSelectedConsentCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseHMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_h_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_tracking_candidates: Array.isArray(selector.selected_tracking_candidates)
      ? selector.selected_tracking_candidates
      : [],
    selected_consent_candidates: Array.isArray(selector.selected_consent_candidates)
      ? selector.selected_consent_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}


export function simulateWordpressAnalyticsTrackingDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "tracking_surface") {
    return {
      entity_type: "tracking_surface",
      tracking_key: String(row?.tracking_key || "").trim(),
      tracking_id: String(row?.tracking_id || "").trim(),
      implementation_mode: String(row?.implementation_mode || "").trim(),
      location_hint: String(row?.location_hint || "").trim(),
      tracking_risk_class: String(row?.tracking_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_tracking_key: String(payload.tracking_key || "").trim(),
        expected_tracking_id: String(payload.tracking_id || "").trim(),
        expected_implementation_mode: String(payload.implementation_mode || "").trim(),
        expected_location_hint: String(payload.location_hint || "").trim(),
        expected_consent_required:
          payload?.consent_required === true ? "true" : "false",
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: "consent_surface",
    consent_key: String(row?.consent_key || "").trim(),
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    region_scope: String(row?.region_scope || "").trim(),
    consent_risk_class: String(row?.consent_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_consent_key: String(payload.consent_key || "").trim(),
      expected_provider: String(payload.provider || "").trim(),
      expected_mode: String(payload.mode || "").trim(),
      expected_region_scope: String(payload.region_scope || "").trim(),
      expected_blocks_tracking_before_consent:
        payload?.blocks_tracking_before_consent === true ? "true" : "false",
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseHDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_tracking_rows: [],
      simulated_consent_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        tracking_rows: 0,
        consent_rows: 0,
        preserve_from_source_count: 0,
        consent_required_true_count: 0,
        blocks_before_consent_true_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_h_mutation_payloads_not_ready"]
    };
  }

  const trackingRows = Array.isArray(composer.tracking_composed_payloads)
    ? composer.tracking_composed_payloads
    : [];
  const consentRows = Array.isArray(composer.consent_composed_payloads)
    ? composer.consent_composed_payloads
    : [];

  const simulatedTrackingRows = trackingRows.map(simulateWordpressAnalyticsTrackingDryRunRow);
  const simulatedConsentRows = consentRows.map(simulateWordpressAnalyticsTrackingDryRunRow);

  const allRows = [...simulatedTrackingRows, ...simulatedConsentRows];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "tracking_surface") acc.tracking_rows += 1;
      else if (entityType === "consent_surface") acc.consent_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (String(preview.expected_apply_mode || "").trim() === "preserve_from_source") {
        acc.preserve_from_source_count += 1;
      }

      if (String(preview.expected_consent_required || "").trim() === "true") {
        acc.consent_required_true_count += 1;
      }

      if (
        String(preview.expected_blocks_tracking_before_consent || "").trim() === "true"
      ) {
        acc.blocks_before_consent_true_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      tracking_rows: 0,
      consent_rows: 0,
      preserve_from_source_count: 0,
      consent_required_true_count: 0,
      blocks_before_consent_true_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_tracking_rows: simulatedTrackingRows,
    simulated_consent_rows: simulatedConsentRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseHDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_h_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_tracking_rows: Array.isArray(simulator.simulated_tracking_rows)
      ? simulator.simulated_tracking_rows
      : [],
    simulated_consent_rows: Array.isArray(simulator.simulated_consent_rows)
      ? simulator.simulated_consent_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            tracking_rows: 0,
            consent_rows: 0,
            preserve_from_source_count: 0,
            consent_required_true_count: 0,
            blocks_before_consent_true_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseHFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseHPlan =
    args.phaseHPlan && typeof args.phaseHPlan === "object" ? args.phaseHPlan : {};
  const phaseHGate =
    args.phaseHGate && typeof args.phaseHGate === "object" ? args.phaseHGate : {};
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
  const reconciliationPayloadArtifact =
    args.reconciliationPayloadArtifact &&
    typeof args.reconciliationPayloadArtifact === "object"
      ? args.reconciliationPayloadArtifact
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
    artifact_type: "wordpress_phase_h_final_operator_handoff",
    artifact_version: "v1",
    phase_h_enabled: phaseHPlan.enabled === true,
    phase_h_inventory_only: phaseHPlan.inventory_only === true,
    phase_h_apply_requested: phaseHPlan.apply === true,
    requested_tracking_scope: {
      include_google_analytics: phaseHPlan.include_google_analytics === true,
      include_gtm: phaseHPlan.include_gtm === true,
      include_meta_pixel: phaseHPlan.include_meta_pixel === true,
      include_tiktok_pixel: phaseHPlan.include_tiktok_pixel === true,
      include_custom_tracking: phaseHPlan.include_custom_tracking === true,
      max_items: Number(phaseHPlan.max_items || 0)
    },
    requested_tracking_config:
      migration?.analytics_tracking && typeof migration.analytics_tracking === "object"
        ? migration.analytics_tracking
        : {},
    phase_h_gate_status: String(phaseHGate.phase_h_gate_status || "").trim(),
    phase_h_inventory_status: String(inventoryArtifact.phase_h_inventory_status || "").trim(),
    phase_h_strategy_status: String(
      normalizedInventoryArtifact.phase_h_gate_status || ""
    ).trim(),
    phase_h_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_h_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_h_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_h_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_h_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_h_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_h_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            tracking_count: 0,
            consent_count: 0
          },
    plugin_signals:
      inventoryArtifact?.plugin_signals && typeof inventoryArtifact.plugin_signals === "object"
        ? inventoryArtifact.plugin_signals
        : {},
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            tracking_total_count: 0,
            tracking_high_risk_count: 0,
            tracking_medium_risk_count: 0,
            consent_total_count: 0,
            consent_high_risk_count: 0,
            consent_medium_risk_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseHGate.blocking_reasons) ? phaseHGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(reconciliationPayloadArtifact.blocking_reasons)
        ? reconciliationPayloadArtifact.blocking_reasons
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
        ? "review_safe_analytics_tracking_candidates"
        : "resolve_analytics_tracking_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_analytics_tracking_reconciliation_execution"
        ? "approve_analytics_tracking_mutation_trial"
        : "hold_analytics_tracking_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_analytics_tracking_dry_run_preview"
        : "no_analytics_tracking_dry_run_preview_available"
    ],
    inventory_artifact: inventoryArtifact,
    normalized_inventory_artifact: normalizedInventoryArtifact,
    readiness_artifact: readinessArtifact,
    reconciliation_payload_artifact: reconciliationPayloadArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}