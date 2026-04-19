// Auto-extracted from server.js — do not edit manually, use domain logic here.
import {
  toPositiveInt
} from "./shared.js";

export function resolveWordpressPhaseGPlan(payload = {}) {
  const migration = payload?.migration || {};
  const seo = migration.seo_surfaces && typeof migration.seo_surfaces === "object"
    ? migration.seo_surfaces
    : {};

  return {
    enabled: seo.enabled === true,
    inventory_only:
      seo.inventory_only === undefined ? true : seo.inventory_only === true,
    apply: seo.apply === true,
    include_redirects:
      seo.include_redirects === undefined ? true : seo.include_redirects === true,
    include_metadata:
      seo.include_metadata === undefined ? true : seo.include_metadata === true,
    include_taxonomy_seo:
      seo.include_taxonomy_seo === undefined ? true : seo.include_taxonomy_seo === true,
    include_post_type_seo:
      seo.include_post_type_seo === undefined ? true : seo.include_post_type_seo === true,
    max_items: Math.max(1, toPositiveInt(seo.max_items, 1000))
  };
}

export function assertWordpressPhaseGPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_g_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_redirects !== true &&
    plan.include_metadata !== true &&
    plan.include_taxonomy_seo !== true &&
    plan.include_post_type_seo !== true
  ) {
    blockingReasons.push("phase_g_no_inventory_scope_selected");
  }

  return {
    phase_g_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_g_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseGGate(args = {}) {
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
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGPlanStatus =
    args.phaseGPlanStatus && typeof args.phaseGPlanStatus === "object"
      ? args.phaseGPlanStatus
      : {};

  const blockingReasons = [...(phaseGPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_g");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseGPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  return {
    phase_g_gate_status:
      blockingReasons.length === 0 ? "ready_for_seo_inventory" : "blocked",
    phase_g_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseGPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressSeoPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_yoast:
      normalized.some(x => x.includes("wordpress-seo") || x.includes("yoast")),
    has_rank_math:
      normalized.some(x => x.includes("seo-by-rank-math") || x.includes("rank-math")),
    has_aioseo:
      normalized.some(x => x.includes("all-in-one-seo") || x.includes("aioseo")),
    has_redirection:
      normalized.some(x => x.includes("redirection")),
    has_seopress:
      normalized.some(x => x.includes("wp-seopress") || x.includes("seopress"))
  };
}

export function buildWordpressSeoMetadataRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const seoMetadata =
    siteProfile?.seo_metadata &&
    typeof siteProfile.seo_metadata === "object" &&
    !Array.isArray(siteProfile.seo_metadata)
      ? siteProfile.seo_metadata
      : {};

  for (const [entityKey, entityValue] of Object.entries(seoMetadata).slice(0, limit)) {
    const value =
      entityValue && typeof entityValue === "object" && !Array.isArray(entityValue)
        ? entityValue
        : {};

    rows.push({
      entity_type: "seo_metadata",
      entity_key: String(entityKey || "").trim(),
      title_template: String(value.title_template || value.title || "").trim(),
      meta_description_template: String(
        value.meta_description_template || value.meta_description || ""
      ).trim(),
      robots: String(value.robots || "").trim(),
      canonical_mode: String(value.canonical_mode || "").trim(),
      inventory_classification: "metadata_surface"
    });
  }

  return rows;
}

export function buildWordpressRedirectRows(siteProfile = {}, limit = 1000) {
  const redirectsRaw = Array.isArray(siteProfile?.redirects) ? siteProfile.redirects : [];

  return redirectsRaw.slice(0, limit).map(row => ({
    entity_type: "redirect",
    source_path: String(row?.source_path || row?.source || "").trim(),
    target_path: String(row?.target_path || row?.target || "").trim(),
    redirect_type: String(row?.redirect_type || row?.type || "301").trim(),
    status: String(row?.status || "").trim(),
    inventory_classification: "redirect_surface"
  }));
}

export function buildWordpressTaxonomySeoRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const taxonomySeo =
    siteProfile?.taxonomy_seo &&
    typeof siteProfile.taxonomy_seo === "object" &&
    !Array.isArray(siteProfile.taxonomy_seo)
      ? siteProfile.taxonomy_seo
      : {};

  for (const [taxonomyKey, taxonomyValue] of Object.entries(taxonomySeo).slice(0, limit)) {
    const value =
      taxonomyValue && typeof taxonomyValue === "object" && !Array.isArray(taxonomyValue)
        ? taxonomyValue
        : {};

    rows.push({
      entity_type: "taxonomy_seo",
      taxonomy_key: String(taxonomyKey || "").trim(),
      title_template: String(value.title_template || "").trim(),
      meta_description_template: String(value.meta_description_template || "").trim(),
      robots: String(value.robots || "").trim(),
      inventory_classification: "taxonomy_seo_surface"
    });
  }

  return rows;
}

export function buildWordpressPostTypeSeoRows(siteProfile = {}, limit = 1000) {
  const rows = [];
  const postTypeSeo =
    siteProfile?.post_type_seo &&
    typeof postTypeSeo === "object" &&
    !Array.isArray(postTypeSeo)
      ? postTypeSeo
      : {};

  for (const [postTypeKey, postTypeValue] of Object.entries(postTypeSeo).slice(0, limit)) {
    const value =
      postTypeValue && typeof postTypeValue === "object" && !Array.isArray(postTypeValue)
        ? postTypeValue
        : {};

    rows.push({
      entity_type: "post_type_seo",
      post_type_key: String(postTypeKey || "").trim(),
      title_template: String(value.title_template || "").trim(),
      meta_description_template: String(value.meta_description_template || "").trim(),
      robots: String(value.robots || "").trim(),
      inventory_classification: "post_type_seo_surface"
    });
  }

  return rows;
}

export async function runWordpressSeoInventory(args = {}) {
  const {
    wpContext = {},
    phaseGPlan = {},
    phaseGGate = {}
  } = args;

  if (phaseGGate.phase_g_gate_ready !== true) {
    return {
      phase_g_inventory_status: "blocked",
      plugin_signals: {},
      redirect_rows: [],
      metadata_rows: [],
      taxonomy_seo_rows: [],
      post_type_seo_rows: [],
      summary: {
        redirect_count: 0,
        metadata_count: 0,
        taxonomy_seo_count: 0,
        post_type_seo_count: 0
      },
      failures: [
        {
          code: "phase_g_seo_inventory_blocked",
          message: "Phase G SEO inventory blocked by phase_g_gate.",
          blocking_reasons: phaseGGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressSeoPluginSignals(sourceProfile);
    const redirectRows =
      phaseGPlan.include_redirects === true
        ? buildWordpressRedirectRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const metadataRows =
      phaseGPlan.include_metadata === true
        ? buildWordpressSeoMetadataRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const taxonomySeoRows =
      phaseGPlan.include_taxonomy_seo === true
        ? buildWordpressTaxonomySeoRows(sourceProfile, phaseGPlan.max_items)
        : [];
    const postTypeSeoRows =
      phaseGPlan.include_post_type_seo === true
        ? buildWordpressPostTypeSeoRows(sourceProfile, phaseGPlan.max_items)
        : [];

    return {
      phase_g_inventory_status: "completed",
      plugin_signals: pluginSignals,
      redirect_rows: redirectRows,
      metadata_rows: metadataRows,
      taxonomy_seo_rows: taxonomySeoRows,
      post_type_seo_rows: postTypeSeoRows,
      summary: {
        redirect_count: redirectRows.length,
        metadata_count: metadataRows.length,
        taxonomy_seo_count: taxonomySeoRows.length,
        post_type_seo_count: postTypeSeoRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_seo_inventory_failed",
      message: err?.message || "WordPress SEO inventory failed."
    });

    return {
      phase_g_inventory_status: "completed_with_failures",
      plugin_signals: {},
      redirect_rows: [],
      metadata_rows: [],
      taxonomy_seo_rows: [],
      post_type_seo_rows: [],
      summary: {
        redirect_count: 0,
        metadata_count: 0,
        taxonomy_seo_count: 0,
        post_type_seo_count: 0
      },
      failures
    };
  }
}

export function buildWordpressPhaseGInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_g_seo_inventory",
    artifact_version: "v1",
    phase_g_gate_status: String(gate.phase_g_gate_status || "").trim(),
    phase_g_inventory_status: String(inventory.phase_g_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    redirect_rows: Array.isArray(inventory.redirect_rows) ? inventory.redirect_rows : [],
    metadata_rows: Array.isArray(inventory.metadata_rows) ? inventory.metadata_rows : [],
    taxonomy_seo_rows: Array.isArray(inventory.taxonomy_seo_rows)
      ? inventory.taxonomy_seo_rows
      : [],
    post_type_seo_rows: Array.isArray(inventory.post_type_seo_rows)
      ? inventory.post_type_seo_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressSeoTextValue(value = "") {
  return String(value ?? "").trim();
}

export function classifyWordpressRedirectRisk(row = {}) {
  const redirectType = String(row?.redirect_type || "").trim();
  const sourcePath = String(row?.source_path || "").trim();
  const targetPath = String(row?.target_path || "").trim();

  let riskScore = 0;
  const reasons = [];

  if (redirectType === "301" || redirectType === "308") {
    riskScore += 1;
    reasons.push("permanent_redirect");
  } else {
    riskScore += 2;
    reasons.push("non_permanent_redirect");
  }

  if (!sourcePath || !targetPath) {
    riskScore += 3;
    reasons.push("missing_redirect_path");
  }

  if (/^https?:\/\//i.test(targetPath)) {
    riskScore += 2;
    reasons.push("absolute_target_path");
  }

  let seo_risk_class = "low";
  if (riskScore >= 4) seo_risk_class = "high";
  else if (riskScore >= 2) seo_risk_class = "medium";

  return {
    seo_risk_score: riskScore,
    seo_risk_class,
    seo_risk_reasons: reasons
  };
}

export function classifyWordpressMetadataRisk(row = {}) {
  const titleTemplate = normalizeWordpressSeoTextValue(row?.title_template);
  const metaDescriptionTemplate = normalizeWordpressSeoTextValue(
    row?.meta_description_template
  );
  const canonicalMode = normalizeWordpressSeoTextValue(row?.canonical_mode);

  let riskScore = 0;
  const reasons = [];

  if (!titleTemplate) {
    riskScore += 2;
    reasons.push("missing_title_template");
  }
  if (!metaDescriptionTemplate) {
    riskScore += 1;
    reasons.push("missing_meta_description_template");
  }
  if (!canonicalMode) {
    riskScore += 1;
    reasons.push("missing_canonical_mode");
  }

  let seo_risk_class = "low";
  if (riskScore >= 3) seo_risk_class = "high";
  else if (riskScore >= 1) seo_risk_class = "medium";

  return {
    title_template: titleTemplate,
    meta_description_template: metaDescriptionTemplate,
    canonical_mode: canonicalMode,
    seo_risk_score: riskScore,
    seo_risk_class,
    seo_risk_reasons: reasons
  };
}

export function buildWordpressPhaseGNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const redirectRows = Array.isArray(inventory.redirect_rows)
    ? inventory.redirect_rows
    : [];
  const metadataRows = Array.isArray(inventory.metadata_rows)
    ? inventory.metadata_rows
    : [];
  const taxonomySeoRows = Array.isArray(inventory.taxonomy_seo_rows)
    ? inventory.taxonomy_seo_rows
    : [];
  const postTypeSeoRows = Array.isArray(inventory.post_type_seo_rows)
    ? inventory.post_type_seo_rows
    : [];

  const normalizedRedirectRows = redirectRows.map(row => {
    const risk = classifyWordpressRedirectRisk(row);
    return {
      ...row,
      seo_risk_score: risk.seo_risk_score,
      seo_risk_class: risk.seo_risk_class,
      seo_risk_reasons: risk.seo_risk_reasons
    };
  });

  const normalizeMetadataLikeRow = row => {
    const risk = classifyWordpressMetadataRisk(row);
    return {
      ...row,
      title_template: risk.title_template,
      meta_description_template: risk.meta_description_template,
      canonical_mode: risk.canonical_mode,
      seo_risk_score: risk.seo_risk_score,
      seo_risk_class: risk.seo_risk_class,
      seo_risk_reasons: risk.seo_risk_reasons
    };
  };

  const normalizedMetadataRows = metadataRows.map(normalizeMetadataLikeRow);
  const normalizedTaxonomySeoRows = taxonomySeoRows.map(normalizeMetadataLikeRow);
  const normalizedPostTypeSeoRows = postTypeSeoRows.map(normalizeMetadataLikeRow);

  const allRows = [
    ...normalizedRedirectRows,
    ...normalizedMetadataRows,
    ...normalizedTaxonomySeoRows,
    ...normalizedPostTypeSeoRows
  ];

  const riskSummary = allRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const riskClass = String(row?.seo_risk_class || "").trim();
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "redirect") acc.redirect_count += 1;
      else if (entityType === "seo_metadata") acc.metadata_count += 1;
      else if (entityType === "taxonomy_seo") acc.taxonomy_seo_count += 1;
      else if (entityType === "post_type_seo") acc.post_type_seo_count += 1;

      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    }
  );

  return {
    normalized_redirect_rows: normalizedRedirectRows,
    normalized_metadata_rows: normalizedMetadataRows,
    normalized_taxonomy_seo_rows: normalizedTaxonomySeoRows,
    normalized_post_type_seo_rows: normalizedPostTypeSeoRows,
    risk_summary: riskSummary
  };
}

export function buildWordpressPhaseGNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_g_seo_strategy",
    artifact_version: "v1",
    phase_g_gate_status: String(gate.phase_g_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    normalized_redirect_rows: Array.isArray(normalizedInventory.normalized_redirect_rows)
      ? normalizedInventory.normalized_redirect_rows
      : [],
    normalized_metadata_rows: Array.isArray(normalizedInventory.normalized_metadata_rows)
      ? normalizedInventory.normalized_metadata_rows
      : [],
    normalized_taxonomy_seo_rows: Array.isArray(
      normalizedInventory.normalized_taxonomy_seo_rows
    )
      ? normalizedInventory.normalized_taxonomy_seo_rows
      : [],
    normalized_post_type_seo_rows: Array.isArray(
      normalizedInventory.normalized_post_type_seo_rows
    )
      ? normalizedInventory.normalized_post_type_seo_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseGReadinessGate(args = {}) {
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseGGate.blocking_reasons || [])];

  if (phaseGPlan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }

  const highRiskCount = Number(riskSummary.high_risk_count || 0);
  const mediumRiskCount = Number(riskSummary.medium_risk_count || 0);

  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_seo_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_seo_reconciliation"
      : "blocked_for_seo_reconciliation",
    readiness_ready: readiness,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: Number(riskSummary.low_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseGSafeCandidates(args = {}) {
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
      redirect_candidates: [],
      metadata_candidates: [],
      taxonomy_seo_candidates: [],
      post_type_seo_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_g_readiness_not_ready"]
    };
  }

  const normalizedRedirectRows = Array.isArray(normalizedInventory.normalized_redirect_rows)
    ? normalizedInventory.normalized_redirect_rows
    : [];
  const normalizedMetadataRows = Array.isArray(normalizedInventory.normalized_metadata_rows)
    ? normalizedInventory.normalized_metadata_rows
    : [];
  const normalizedTaxonomySeoRows = Array.isArray(
    normalizedInventory.normalized_taxonomy_seo_rows
  )
    ? normalizedInventory.normalized_taxonomy_seo_rows
    : [];
  const normalizedPostTypeSeoRows = Array.isArray(
    normalizedInventory.normalized_post_type_seo_rows
  )
    ? normalizedInventory.normalized_post_type_seo_rows
    : [];

  const redirectCandidates = normalizedRedirectRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "redirect",
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_redirect_candidate"
    }));

  const metadataCandidates = normalizedMetadataRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "seo_metadata",
      entity_key: String(row?.entity_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      canonical_mode: String(row?.canonical_mode || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_metadata_candidate"
    }));

  const taxonomySeoCandidates = normalizedTaxonomySeoRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "taxonomy_seo",
      taxonomy_key: String(row?.taxonomy_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_taxonomy_seo_candidate"
    }));

  const postTypeSeoCandidates = normalizedPostTypeSeoRows
    .filter(row => String(row?.seo_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "post_type_seo",
      post_type_key: String(row?.post_type_key || "").trim(),
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      candidate_reason: "non_high_risk_post_type_seo_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      redirectCandidates.length +
      metadataCandidates.length +
      taxonomySeoCandidates.length +
      postTypeSeoCandidates.length,
    redirect_candidates: redirectCandidates,
    metadata_candidates: metadataCandidates,
    taxonomy_seo_candidates: taxonomySeoCandidates,
    post_type_seo_candidates: postTypeSeoCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseGReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_g_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    high_risk_count: Number(readiness.high_risk_count || 0),
    medium_risk_count: Number(readiness.medium_risk_count || 0),
    low_risk_count: Number(readiness.low_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    redirect_candidates: Array.isArray(safeCandidates.redirect_candidates)
      ? safeCandidates.redirect_candidates
      : [],
    metadata_candidates: Array.isArray(safeCandidates.metadata_candidates)
      ? safeCandidates.metadata_candidates
      : [],
    taxonomy_seo_candidates: Array.isArray(safeCandidates.taxonomy_seo_candidates)
      ? safeCandidates.taxonomy_seo_candidates
      : [],
    post_type_seo_candidates: Array.isArray(safeCandidates.post_type_seo_candidates)
      ? safeCandidates.post_type_seo_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressRedirectReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "redirect",
    source_path: String(row?.source_path || "").trim(),
    target_path: String(row?.target_path || "").trim(),
    redirect_type: String(row?.redirect_type || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_mode: "safe_redirect_reconciliation_candidate",
    payload_shape: {
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressMetadataReconciliationPayloadRow(row = {}) {
  return {
    entity_type: String(row?.entity_type || "seo_metadata").trim(),
    entity_key: String(row?.entity_key || "").trim(),
    taxonomy_key: String(row?.taxonomy_key || "").trim(),
    post_type_key: String(row?.post_type_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    canonical_mode: String(row?.canonical_mode || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_mode: "safe_metadata_reconciliation_candidate",
    payload_shape: {
      title_template: String(row?.title_template || "").trim(),
      meta_description_template: String(row?.meta_description_template || "").trim(),
      canonical_mode: String(row?.canonical_mode || "").trim(),
      robots: String(row?.robots || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseGReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      redirect_payload_rows: [],
      metadata_payload_rows: [],
      taxonomy_seo_payload_rows: [],
      post_type_seo_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_g_safe_candidates_not_ready"]
    };
  }

  const redirectCandidates = Array.isArray(safeCandidates.redirect_candidates)
    ? safeCandidates.redirect_candidates
    : [];
  const metadataCandidates = Array.isArray(safeCandidates.metadata_candidates)
    ? safeCandidates.metadata_candidates
    : [];
  const taxonomySeoCandidates = Array.isArray(safeCandidates.taxonomy_seo_candidates)
    ? safeCandidates.taxonomy_seo_candidates
    : [];
  const postTypeSeoCandidates = Array.isArray(safeCandidates.post_type_seo_candidates)
    ? safeCandidates.post_type_seo_candidates
    : [];

  const redirectPayloadRows = redirectCandidates.map(
    buildWordpressRedirectReconciliationPayloadRow
  );
  const metadataPayloadRows = metadataCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );
  const taxonomySeoPayloadRows = taxonomySeoCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );
  const postTypeSeoPayloadRows = postTypeSeoCandidates.map(
    buildWordpressMetadataReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      redirectPayloadRows.length +
      metadataPayloadRows.length +
      taxonomySeoPayloadRows.length +
      postTypeSeoPayloadRows.length,
    redirect_payload_rows: redirectPayloadRows,
    metadata_payload_rows: metadataPayloadRows,
    taxonomy_seo_payload_rows: taxonomySeoPayloadRows,
    post_type_seo_payload_rows: postTypeSeoPayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseGReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_g_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    redirect_payload_rows: Array.isArray(planner.redirect_payload_rows)
      ? planner.redirect_payload_rows
      : [],
    metadata_payload_rows: Array.isArray(planner.metadata_payload_rows)
      ? planner.metadata_payload_rows
      : [],
    taxonomy_seo_payload_rows: Array.isArray(planner.taxonomy_seo_payload_rows)
      ? planner.taxonomy_seo_payload_rows
      : [],
    post_type_seo_payload_rows: Array.isArray(planner.post_type_seo_payload_rows)
      ? planner.post_type_seo_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseGExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const seoSurfaces =
    migration.seo_surfaces && typeof migration.seo_surfaces === "object"
      ? migration.seo_surfaces
      : {};
  const execution =
    seoSurfaces.execution && typeof seoSurfaces.execution === "object"
      ? seoSurfaces.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

export function buildWordpressPhaseGExecutionGuard(args = {}) {
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
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

  if (phaseGPlan.enabled !== true) {
    blockingReasons.push("phase_g_not_enabled");
  }
  if (phaseGGate.phase_g_gate_ready !== true) {
    blockingReasons.push("phase_g_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_g_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_g_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_g_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_g_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseGPlan.inventory_only === true && phaseGPlan.apply === true) {
    blockingReasons.push("phase_g_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_seo_reconciliation_execution"
      : "blocked_before_seo_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseGExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_g_execution_guard",
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

export function buildWordpressPhaseGMutationCandidateSelector(args = {}) {
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
      selected_redirect_candidates: [],
      selected_metadata_candidates: [],
      selected_taxonomy_seo_candidates: [],
      selected_post_type_seo_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_g_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_redirect_candidates: [],
      selected_metadata_candidates: [],
      selected_taxonomy_seo_candidates: [],
      selected_post_type_seo_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_g_payload_planner_not_ready"]
    };
  }

  const redirectPayloadRows = Array.isArray(payloadPlanner.redirect_payload_rows)
    ? payloadPlanner.redirect_payload_rows
    : [];
  const metadataPayloadRows = Array.isArray(payloadPlanner.metadata_payload_rows)
    ? payloadPlanner.metadata_payload_rows
    : [];
  const taxonomySeoPayloadRows = Array.isArray(payloadPlanner.taxonomy_seo_payload_rows)
    ? payloadPlanner.taxonomy_seo_payload_rows
    : [];
  const postTypeSeoPayloadRows = Array.isArray(payloadPlanner.post_type_seo_payload_rows)
    ? payloadPlanner.post_type_seo_payload_rows
    : [];

  const selectedRedirectCandidates = [];
  const selectedMetadataCandidates = [];
  const selectedTaxonomySeoCandidates = [];
  const selectedPostTypeSeoCandidates = [];
  const rejectedCandidates = [];

  for (const row of redirectPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "redirect",
        source_path: String(row?.source_path || "").trim(),
        rejection_reason: "high_risk_redirect_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_redirect_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "redirect",
        source_path: String(row?.source_path || "").trim(),
        rejection_reason: "unsupported_redirect_payload_mode"
      });
      continue;
    }

    selectedRedirectCandidates.push({
      ...row,
      candidate_reason: "safe_redirect_candidate_ready_for_mutation"
    });
  }

  for (const row of metadataPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "seo_metadata",
        entity_key: String(row?.entity_key || "").trim(),
        rejection_reason: "high_risk_metadata_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "seo_metadata",
        entity_key: String(row?.entity_key || "").trim(),
        rejection_reason: "unsupported_metadata_payload_mode"
      });
      continue;
    }

    selectedMetadataCandidates.push({
      ...row,
      candidate_reason: "safe_metadata_candidate_ready_for_mutation"
    });
  }

  for (const row of taxonomySeoPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "taxonomy_seo",
        taxonomy_key: String(row?.taxonomy_key || "").trim(),
        rejection_reason: "high_risk_taxonomy_seo_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "taxonomy_seo",
        taxonomy_key: String(row?.taxonomy_key || "").trim(),
        rejection_reason: "unsupported_taxonomy_seo_payload_mode"
      });
      continue;
    }

    selectedTaxonomySeoCandidates.push({
      ...row,
      candidate_reason: "safe_taxonomy_seo_candidate_ready_for_mutation"
    });
  }

  for (const row of postTypeSeoPayloadRows) {
    const seoRiskClass = String(row?.seo_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (seoRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "post_type_seo",
        post_type_key: String(row?.post_type_key || "").trim(),
        rejection_reason: "high_risk_post_type_seo_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_metadata_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "post_type_seo",
        post_type_key: String(row?.post_type_key || "").trim(),
        rejection_reason: "unsupported_post_type_seo_payload_mode"
      });
      continue;
    }

    selectedPostTypeSeoCandidates.push({
      ...row,
      candidate_reason: "safe_post_type_seo_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedRedirectCandidates = selectedRedirectCandidates.slice(0, candidateLimit);
  const limitedSelectedMetadataCandidates = selectedMetadataCandidates.slice(0, candidateLimit);
  const limitedSelectedTaxonomySeoCandidates =
    selectedTaxonomySeoCandidates.slice(0, candidateLimit);
  const limitedSelectedPostTypeSeoCandidates =
    selectedPostTypeSeoCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedRedirectCandidates.length +
      limitedSelectedMetadataCandidates.length +
      limitedSelectedTaxonomySeoCandidates.length +
      limitedSelectedPostTypeSeoCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_redirect_candidates: limitedSelectedRedirectCandidates,
    selected_metadata_candidates: limitedSelectedMetadataCandidates,
    selected_taxonomy_seo_candidates: limitedSelectedTaxonomySeoCandidates,
    selected_post_type_seo_candidates: limitedSelectedPostTypeSeoCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseGMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_g_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_redirect_candidates: Array.isArray(selector.selected_redirect_candidates)
      ? selector.selected_redirect_candidates
      : [],
    selected_metadata_candidates: Array.isArray(selector.selected_metadata_candidates)
      ? selector.selected_metadata_candidates
      : [],
    selected_taxonomy_seo_candidates: Array.isArray(selector.selected_taxonomy_seo_candidates)
      ? selector.selected_taxonomy_seo_candidates
      : [],
    selected_post_type_seo_candidates: Array.isArray(selector.selected_post_type_seo_candidates)
      ? selector.selected_post_type_seo_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressRedirectMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_redirect_reconciliation",
    target_scope: "destination_wordpress_redirect",
    payload: {
      source_path: Object.prototype.hasOwnProperty.call(payloadShape, "source_path")
        ? payloadShape.source_path
        : String(row?.source_path || "").trim(),
      target_path: Object.prototype.hasOwnProperty.call(payloadShape, "target_path")
        ? payloadShape.target_path
        : String(row?.target_path || "").trim(),
      redirect_type: Object.prototype.hasOwnProperty.call(payloadShape, "redirect_type")
        ? payloadShape.redirect_type
        : String(row?.redirect_type || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressMetadataMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_metadata_reconciliation",
    target_scope: "destination_wordpress_seo_surface",
    payload: {
      title_template: Object.prototype.hasOwnProperty.call(payloadShape, "title_template")
        ? payloadShape.title_template
        : String(row?.title_template || "").trim(),
      meta_description_template: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "meta_description_template"
      )
        ? payloadShape.meta_description_template
        : String(row?.meta_description_template || "").trim(),
      canonical_mode: Object.prototype.hasOwnProperty.call(payloadShape, "canonical_mode")
        ? payloadShape.canonical_mode
        : String(row?.canonical_mode || "").trim(),
      robots: Object.prototype.hasOwnProperty.call(payloadShape, "robots")
        ? payloadShape.robots
        : String(row?.robots || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseGMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      redirect_composed_payloads: [],
      metadata_composed_payloads: [],
      taxonomy_seo_composed_payloads: [],
      post_type_seo_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_g_mutation_candidates_not_ready"]
    };
  }

  const selectedRedirectCandidates = Array.isArray(selector.selected_redirect_candidates)
    ? selector.selected_redirect_candidates
    : [];
  const selectedMetadataCandidates = Array.isArray(selector.selected_metadata_candidates)
    ? selector.selected_metadata_candidates
    : [];
  const selectedTaxonomySeoCandidates = Array.isArray(
    selector.selected_taxonomy_seo_candidates
  )
    ? selector.selected_taxonomy_seo_candidates
    : [];
  const selectedPostTypeSeoCandidates = Array.isArray(
    selector.selected_post_type_seo_candidates
  )
    ? selector.selected_post_type_seo_candidates
    : [];

  const redirectComposedPayloads = selectedRedirectCandidates.map(row => ({
    entity_type: "redirect",
    source_path: String(row?.source_path || "").trim(),
    target_path: String(row?.target_path || "").trim(),
    redirect_type: String(row?.redirect_type || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_redirect_candidate",
    mutation_payload: buildWordpressRedirectMutationPayloadFromCandidate(row)
  }));

  const metadataComposedPayloads = selectedMetadataCandidates.map(row => ({
    entity_type: "seo_metadata",
    entity_key: String(row?.entity_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_metadata_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  const taxonomySeoComposedPayloads = selectedTaxonomySeoCandidates.map(row => ({
    entity_type: "taxonomy_seo",
    taxonomy_key: String(row?.taxonomy_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_taxonomy_seo_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  const postTypeSeoComposedPayloads = selectedPostTypeSeoCandidates.map(row => ({
    entity_type: "post_type_seo",
    post_type_key: String(row?.post_type_key || "").trim(),
    title_template: String(row?.title_template || "").trim(),
    meta_description_template: String(row?.meta_description_template || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    payload_reason: "composed_from_safe_post_type_seo_candidate",
    mutation_payload: buildWordpressMetadataMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      redirectComposedPayloads.length +
      metadataComposedPayloads.length +
      taxonomySeoComposedPayloads.length +
      postTypeSeoComposedPayloads.length,
    redirect_composed_payloads: redirectComposedPayloads,
    metadata_composed_payloads: metadataComposedPayloads,
    taxonomy_seo_composed_payloads: taxonomySeoComposedPayloads,
    post_type_seo_composed_payloads: postTypeSeoComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseGMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_g_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    redirect_composed_payloads: Array.isArray(composer.redirect_composed_payloads)
      ? composer.redirect_composed_payloads
      : [],
    metadata_composed_payloads: Array.isArray(composer.metadata_composed_payloads)
      ? composer.metadata_composed_payloads
      : [],
    taxonomy_seo_composed_payloads: Array.isArray(composer.taxonomy_seo_composed_payloads)
      ? composer.taxonomy_seo_composed_payloads
      : [],
    post_type_seo_composed_payloads: Array.isArray(
      composer.post_type_seo_composed_payloads
    )
      ? composer.post_type_seo_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressSeoDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "redirect") {
    return {
      entity_type: "redirect",
      source_path: String(row?.source_path || "").trim(),
      target_path: String(row?.target_path || "").trim(),
      redirect_type: String(row?.redirect_type || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_source_path: String(payload.source_path || "").trim(),
        expected_target_path: String(payload.target_path || "").trim(),
        expected_redirect_type: String(payload.redirect_type || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "seo_metadata") {
    return {
      entity_type: "seo_metadata",
      entity_key: String(row?.entity_key || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_title_template: String(payload.title_template || "").trim(),
        expected_meta_description_template: String(
          payload.meta_description_template || ""
        ).trim(),
        expected_canonical_mode: String(payload.canonical_mode || "").trim(),
        expected_robots: String(payload.robots || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "taxonomy_seo") {
    return {
      entity_type: "taxonomy_seo",
      taxonomy_key: String(row?.taxonomy_key || "").trim(),
      seo_risk_class: String(row?.seo_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_title_template: String(payload.title_template || "").trim(),
        expected_meta_description_template: String(
          payload.meta_description_template || ""
        ).trim(),
        expected_canonical_mode: String(payload.canonical_mode || "").trim(),
        expected_robots: String(payload.robots || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: "post_type_seo",
    post_type_key: String(row?.post_type_key || "").trim(),
    seo_risk_class: String(row?.seo_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_title_template: String(payload.title_template || "").trim(),
      expected_meta_description_template: String(
        payload.meta_description_template || ""
      ).trim(),
      expected_canonical_mode: String(payload.canonical_mode || "").trim(),
      expected_robots: String(payload.robots || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseGDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_redirect_rows: [],
      simulated_metadata_rows: [],
      simulated_taxonomy_seo_rows: [],
      simulated_post_type_seo_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        redirect_rows: 0,
        metadata_rows: 0,
        taxonomy_seo_rows: 0,
        post_type_seo_rows: 0,
        preserve_from_source_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_g_mutation_payloads_not_ready"]
    };
  }

  const redirectRows = Array.isArray(composer.redirect_composed_payloads)
    ? composer.redirect_composed_payloads
    : [];
  const metadataRows = Array.isArray(composer.metadata_composed_payloads)
    ? composer.metadata_composed_payloads
    : [];
  const taxonomySeoRows = Array.isArray(composer.taxonomy_seo_composed_payloads)
    ? composer.taxonomy_seo_composed_payloads
    : [];
  const postTypeSeoRows = Array.isArray(composer.post_type_seo_composed_payloads)
    ? composer.post_type_seo_composed_payloads
    : [];

  const simulatedRedirectRows = redirectRows.map(simulateWordpressSeoDryRunRow);
  const simulatedMetadataRows = metadataRows.map(simulateWordpressSeoDryRunRow);
  const simulatedTaxonomySeoRows = taxonomySeoRows.map(simulateWordpressSeoDryRunRow);
  const simulatedPostTypeSeoRows = postTypeSeoRows.map(simulateWordpressSeoDryRunRow);

  const allRows = [
    ...simulatedRedirectRows,
    ...simulatedMetadataRows,
    ...simulatedTaxonomySeoRows,
    ...simulatedPostTypeSeoRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "redirect") acc.redirect_rows += 1;
      else if (entityType === "seo_metadata") acc.metadata_rows += 1;
      else if (entityType === "taxonomy_seo") acc.taxonomy_seo_rows += 1;
      else if (entityType === "post_type_seo") acc.post_type_seo_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (String(preview.expected_apply_mode || "").trim() === "preserve_from_source") {
        acc.preserve_from_source_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_redirect_rows: simulatedRedirectRows,
    simulated_metadata_rows: simulatedMetadataRows,
    simulated_taxonomy_seo_rows: simulatedTaxonomySeoRows,
    simulated_post_type_seo_rows: simulatedPostTypeSeoRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseGDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_g_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_redirect_rows: Array.isArray(simulator.simulated_redirect_rows)
      ? simulator.simulated_redirect_rows
      : [],
    simulated_metadata_rows: Array.isArray(simulator.simulated_metadata_rows)
      ? simulator.simulated_metadata_rows
      : [],
    simulated_taxonomy_seo_rows: Array.isArray(simulator.simulated_taxonomy_seo_rows)
      ? simulator.simulated_taxonomy_seo_rows
      : [],
    simulated_post_type_seo_rows: Array.isArray(simulator.simulated_post_type_seo_rows)
      ? simulator.simulated_post_type_seo_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            redirect_rows: 0,
            metadata_rows: 0,
            taxonomy_seo_rows: 0,
            post_type_seo_rows: 0,
            preserve_from_source_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseGFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseGPlan =
    args.phaseGPlan && typeof args.phaseGPlan === "object" ? args.phaseGPlan : {};
  const phaseGGate =
    args.phaseGGate && typeof args.phaseGGate === "object" ? args.phaseGGate : {};
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
    artifact_type: "wordpress_phase_g_final_operator_handoff",
    artifact_version: "v1",
    phase_g_enabled: phaseGPlan.enabled === true,
    phase_g_inventory_only: phaseGPlan.inventory_only === true,
    phase_g_apply_requested: phaseGPlan.apply === true,
    requested_seo_scope: {
      include_redirects: phaseGPlan.include_redirects === true,
      include_metadata: phaseGPlan.include_metadata === true,
      include_taxonomy_seo: phaseGPlan.include_taxonomy_seo === true,
      include_post_type_seo: phaseGPlan.include_post_type_seo === true,
      max_items: Number(phaseGPlan.max_items || 0)
    },
    requested_seo_config:
      migration?.seo_surfaces && typeof migration.seo_surfaces === "object"
        ? migration.seo_surfaces
        : {},
    phase_g_gate_status: String(phaseGGate.phase_g_gate_status || "").trim(),
    phase_g_inventory_status: String(inventoryArtifact.phase_g_inventory_status || "").trim(),
    phase_g_strategy_status: String(
      normalizedInventoryArtifact.phase_g_gate_status || ""
    ).trim(),
    phase_g_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_g_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_g_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_g_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_g_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_g_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_g_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
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
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            redirect_count: 0,
            metadata_count: 0,
            taxonomy_seo_count: 0,
            post_type_seo_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseGGate.blocking_reasons) ? phaseGGate.blocking_reasons : []),
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
        ? "review_safe_seo_candidates"
        : "resolve_seo_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_seo_reconciliation_execution"
        ? "approve_seo_mutation_trial"
        : "hold_seo_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_seo_dry_run_preview"
        : "no_seo_dry_run_preview_available"
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
