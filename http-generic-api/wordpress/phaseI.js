// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  MAX_TIMEOUT_SECONDS
} from "../config.js";

export function resolveWordpressPhaseIPlan(payload = {}) {
  const migration = payload?.migration || {};
  const performance =
    migration.performance_optimization &&
    typeof migration.performance_optimization === "object"
      ? migration.performance_optimization
      : {};

  return {
    enabled: performance.enabled === true,
    inventory_only:
      performance.inventory_only === undefined
        ? true
        : performance.inventory_only === true,
    apply: performance.apply === true,
    include_cache_layers:
      performance.include_cache_layers === undefined
        ? true
        : performance.include_cache_layers === true,
    include_asset_optimization:
      performance.include_asset_optimization === undefined
        ? true
        : performance.include_asset_optimization === true,
    include_image_optimization:
      performance.include_image_optimization === undefined
        ? true
        : performance.include_image_optimization === true,
    include_cdn:
      performance.include_cdn === undefined ? true : performance.include_cdn === true,
    include_lazyload:
      performance.include_lazyload === undefined
        ? true
        : performance.include_lazyload === true,
    max_items: Math.max(1, toPositiveInt(performance.max_items, 500))
  };
}

export function assertWordpressPhaseIPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_i_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_i_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_cache_layers !== true &&
    plan.include_asset_optimization !== true &&
    plan.include_image_optimization !== true &&
    plan.include_cdn !== true &&
    plan.include_lazyload !== true
  ) {
    blockingReasons.push("phase_i_no_inventory_scope_selected");
  }

  return {
    phase_i_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_i_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseIGate(args = {}) {
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
  const phaseHFinalOperatorHandoffBundle =
    args.phaseHFinalOperatorHandoffBundle &&
    typeof args.phaseHFinalOperatorHandoffBundle === "object"
      ? args.phaseHFinalOperatorHandoffBundle
      : {};
  const phaseIPlan =
    args.phaseIPlan && typeof args.phaseIPlan === "object" ? args.phaseIPlan : {};
  const phaseIPlanStatus =
    args.phaseIPlanStatus && typeof args.phaseIPlanStatus === "object"
      ? args.phaseIPlanStatus
      : {};

  const blockingReasons = [...(phaseIPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_i");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseGFinalOperatorHandoffBundle.phase_g_enabled === true &&
    String(phaseGFinalOperatorHandoffBundle.phase_g_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_g_seo_stage_blocked");
  }

  if (
    phaseIPlan.enabled === true &&
    phaseHFinalOperatorHandoffBundle.phase_h_enabled === true &&
    String(phaseHFinalOperatorHandoffBundle.phase_h_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_h_analytics_tracking_stage_blocked");
  }

  return {
    phase_i_gate_status:
      blockingReasons.length === 0
        ? "ready_for_performance_optimization_inventory"
        : "blocked",
    phase_i_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseIPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressPerformancePluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_wp_rocket: normalized.some(x => x.includes("wp-rocket")),
    has_litespeed_cache: normalized.some(x => x.includes("litespeed-cache")),
    has_w3tc: normalized.some(x => x.includes("w3-total-cache")),
    has_autoptimize: normalized.some(x => x.includes("autoptimize")),
    has_perfmatters: normalized.some(x => x.includes("perfmatters")),
    has_shortpixel: normalized.some(x => x.includes("shortpixel")),
    has_imagify: normalized.some(x => x.includes("imagify")),
    has_smush: normalized.some(x => x.includes("wp-smushit") || x.includes("smush")),
    has_cloudflare_plugin: normalized.some(x => x.includes("cloudflare")),
    has_lazyload_plugin: normalized.some(
      x =>
        x.includes("a3-lazy-load") ||
        x.includes("lazy-load") ||
        x.includes("rocket-lazy-load")
    )
  };
}

export function buildWordpressCacheLayerRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const cacheLayers =
    siteProfile?.performance_surfaces &&
    typeof siteProfile.performance_surfaces === "object" &&
    !Array.isArray(siteProfile.performance_surfaces) &&
    siteProfile.performance_surfaces.cache_layers &&
    typeof siteProfile.performance_surfaces.cache_layers === "object" &&
    !Array.isArray(siteProfile.performance_surfaces.cache_layers)
      ? siteProfile.performance_surfaces.cache_layers
      : {};

  for (const [key, valueRaw] of Object.entries(cacheLayers).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "cache_layer",
      cache_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      scope: String(value.scope || "").trim(),
      inventory_classification: "cache_layer"
    });
  }

  return rows;
}

export function buildWordpressAssetOptimizationRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const assets =
    siteProfile?.performance_surfaces &&
    typeof siteProfile.performance_surfaces === "object" &&
    !Array.isArray(siteProfile.performance_surfaces) &&
    siteProfile.performance_surfaces.asset_optimization &&
    typeof siteProfile.performance_surfaces.asset_optimization === "object" &&
    !Array.isArray(siteProfile.performance_surfaces.asset_optimization)
      ? siteProfile.performance_surfaces.asset_optimization
      : {};

  for (const [key, valueRaw] of Object.entries(assets).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "asset_optimization",
      optimization_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      mode: String(value.mode || "").trim(),
      target_scope: String(value.target_scope || "").trim(),
      inventory_classification: "asset_optimization"
    });
  }

  return rows;
}

export function buildWordpressImageOptimizationRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const images =
    siteProfile?.performance_surfaces &&
    typeof siteProfile.performance_surfaces === "object" &&
    !Array.isArray(siteProfile.performance_surfaces) &&
    siteProfile.performance_surfaces.image_optimization &&
    typeof siteProfile.performance_surfaces.image_optimization === "object" &&
    !Array.isArray(siteProfile.performance_surfaces.image_optimization)
      ? siteProfile.performance_surfaces.image_optimization
      : {};

  for (const [key, valueRaw] of Object.entries(images).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "image_optimization",
      optimization_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      inventory_classification: "image_optimization"
    });
  }

  return rows;
}

export function buildWordpressCdnRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const cdn =
    siteProfile?.performance_surfaces &&
    typeof siteProfile.performance_surfaces === "object" &&
    !Array.isArray(siteProfile.performance_surfaces) &&
    siteProfile.performance_surfaces.cdn &&
    typeof siteProfile.performance_surfaces.cdn === "object" &&
    !Array.isArray(siteProfile.performance_surfaces.cdn)
      ? siteProfile.performance_surfaces.cdn
      : {};

  for (const [key, valueRaw] of Object.entries(cdn).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "cdn_surface",
      cdn_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      inventory_classification: "cdn_surface"
    });
  }

  return rows;
}

export function buildWordpressLazyloadRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const lazyload =
    siteProfile?.performance_surfaces &&
    typeof siteProfile.performance_surfaces === "object" &&
    !Array.isArray(siteProfile.performance_surfaces) &&
    siteProfile.performance_surfaces.lazyload &&
    typeof siteProfile.performance_surfaces.lazyload === "object" &&
    !Array.isArray(siteProfile.performance_surfaces.lazyload)
      ? siteProfile.performance_surfaces.lazyload
      : {};

  for (const [key, valueRaw] of Object.entries(lazyload).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "lazyload_surface",
      lazyload_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      mode: String(value.mode || "").trim(),
      target_scope: String(value.target_scope || "").trim(),
      inventory_classification: "lazyload_surface"
    });
  }

  return rows;
}

export async function runWordpressPerformanceOptimizationInventory(args = {}) {
  const {
    wpContext = {},
    phaseIPlan = {},
    phaseIGate = {}
  } = args;

  if (phaseIGate.phase_i_gate_ready !== true) {
    return {
      phase_i_inventory_status: "blocked",
      plugin_signals: {},
      cache_layer_rows: [],
      asset_optimization_rows: [],
      image_optimization_rows: [],
      cdn_rows: [],
      lazyload_rows: [],
      summary: {
        cache_layer_count: 0,
        asset_optimization_count: 0,
        image_optimization_count: 0,
        cdn_count: 0,
        lazyload_count: 0
      },
      failures: [
        {
          code: "phase_i_performance_inventory_blocked",
          message:
            "Phase I performance/optimization inventory blocked by phase_i_gate.",
          blocking_reasons: phaseIGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressPerformancePluginSignals(sourceProfile);
    const cacheLayerRows =
      phaseIPlan.include_cache_layers === true
        ? buildWordpressCacheLayerRows(sourceProfile, phaseIPlan.max_items)
        : [];
    const assetOptimizationRows =
      phaseIPlan.include_asset_optimization === true
        ? buildWordpressAssetOptimizationRows(sourceProfile, phaseIPlan.max_items)
        : [];
    const imageOptimizationRows =
      phaseIPlan.include_image_optimization === true
        ? buildWordpressImageOptimizationRows(sourceProfile, phaseIPlan.max_items)
        : [];
    const cdnRows =
      phaseIPlan.include_cdn === true
        ? buildWordpressCdnRows(sourceProfile, phaseIPlan.max_items)
        : [];
    const lazyloadRows =
      phaseIPlan.include_lazyload === true
        ? buildWordpressLazyloadRows(sourceProfile, phaseIPlan.max_items)
        : [];

    return {
      phase_i_inventory_status: "completed",
      plugin_signals: pluginSignals,
      cache_layer_rows: cacheLayerRows,
      asset_optimization_rows: assetOptimizationRows,
      image_optimization_rows: imageOptimizationRows,
      cdn_rows: cdnRows,
      lazyload_rows: lazyloadRows,
      summary: {
        cache_layer_count: cacheLayerRows.length,
        asset_optimization_count: assetOptimizationRows.length,
        image_optimization_count: imageOptimizationRows.length,
        cdn_count: cdnRows.length,
        lazyload_count: lazyloadRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_performance_inventory_failed",
      message: err?.message || "WordPress performance/optimization inventory failed."
    });

    return {
      phase_i_inventory_status: "completed_with_failures",
      plugin_signals: {},
      cache_layer_rows: [],
      asset_optimization_rows: [],
      image_optimization_rows: [],
      cdn_rows: [],
      lazyload_rows: [],
      summary: {
        cache_layer_count: 0,
        asset_optimization_count: 0,
        image_optimization_count: 0,
        cdn_count: 0,
        lazyload_count: 0
      },
      failures
    };
  }
}

export function buildWordpressPhaseIInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_i_performance_inventory",
    artifact_version: "v1",
    phase_i_gate_status: String(gate.phase_i_gate_status || "").trim(),
    phase_i_inventory_status: String(inventory.phase_i_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            cache_layer_count: 0,
            asset_optimization_count: 0,
            image_optimization_count: 0,
            cdn_count: 0,
            lazyload_count: 0
          },
    cache_layer_rows: Array.isArray(inventory.cache_layer_rows)
      ? inventory.cache_layer_rows
      : [],
    asset_optimization_rows: Array.isArray(inventory.asset_optimization_rows)
      ? inventory.asset_optimization_rows
      : [],
    image_optimization_rows: Array.isArray(inventory.image_optimization_rows)
      ? inventory.image_optimization_rows
      : [],
    cdn_rows: Array.isArray(inventory.cdn_rows) ? inventory.cdn_rows : [],
    lazyload_rows: Array.isArray(inventory.lazyload_rows)
      ? inventory.lazyload_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressPerformanceTextValue(value = "") {
  return String(value ?? "").trim();
}

export function classifyWordpressCacheLayerRisk(row = {}) {
  const cacheKey = normalizeWordpressPerformanceTextValue(row?.cache_key);
  const enabled = row?.enabled === true;
  const provider = normalizeWordpressPerformanceTextValue(row?.provider);
  const mode = normalizeWordpressPerformanceTextValue(row?.mode);
  const scope = normalizeWordpressPerformanceTextValue(row?.scope);

  let riskScore = 0;
  const reasons = [];

  if (!provider) {
    riskScore += 2;
    reasons.push("missing_cache_provider");
  }
  if (!mode) {
    riskScore += 1;
    reasons.push("missing_cache_mode");
  }
  if (!scope) {
    riskScore += 1;
    reasons.push("missing_cache_scope");
  }
  if (enabled !== true) {
    riskScore += 1;
    reasons.push("cache_layer_disabled");
  }
  if (cacheKey === "page_cache" && enabled !== true) {
    riskScore += 2;
    reasons.push("page_cache_not_enabled");
  }

  let performance_risk_class = "low";
  if (riskScore >= 4) performance_risk_class = "high";
  else if (riskScore >= 2) performance_risk_class = "medium";

  return {
    cache_key: cacheKey,
    enabled,
    provider,
    mode,
    scope,
    performance_risk_score: riskScore,
    performance_risk_class,
    performance_risk_reasons: reasons
  };
}

export function classifyWordpressOptimizationRisk(row = {}) {
  const entityType = normalizeWordpressPerformanceTextValue(row?.entity_type);
  const optimizationKey = normalizeWordpressPerformanceTextValue(
    row?.optimization_key || row?.cdn_key || row?.lazyload_key
  );
  const enabled = row?.enabled === true;
  const provider = normalizeWordpressPerformanceTextValue(row?.provider);
  const mode = normalizeWordpressPerformanceTextValue(row?.mode);
  const targetScope = normalizeWordpressPerformanceTextValue(row?.target_scope);

  let riskScore = 0;
  const reasons = [];

  if (!mode) {
    riskScore += 1;
    reasons.push("missing_mode");
  }
  if (entityType === "cdn_surface" && !provider) {
    riskScore += 2;
    reasons.push("missing_cdn_provider");
  }
  if (entityType === "image_optimization" && !provider) {
    riskScore += 1;
    reasons.push("missing_image_provider");
  }
  if (
    (entityType === "asset_optimization" || entityType === "lazyload_surface") &&
    !targetScope
  ) {
    riskScore += 1;
    reasons.push("missing_target_scope");
  }
  if (enabled !== true) {
    riskScore += 1;
    reasons.push("optimization_disabled");
  }
  if (optimizationKey === "critical_css" && enabled !== true) {
    riskScore += 2;
    reasons.push("critical_css_not_enabled");
  }

  let performance_risk_class = "low";
  if (riskScore >= 4) performance_risk_class = "high";
  else if (riskScore >= 2) performance_risk_class = "medium";

  return {
    optimization_key: optimizationKey,
    enabled,
    provider,
    mode,
    target_scope: targetScope,
    performance_risk_score: riskScore,
    performance_risk_class,
    performance_risk_reasons: reasons
  };
}

export function buildWordpressPhaseINormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const cacheLayerRows = Array.isArray(inventory.cache_layer_rows)
    ? inventory.cache_layer_rows
    : [];
  const assetOptimizationRows = Array.isArray(inventory.asset_optimization_rows)
    ? inventory.asset_optimization_rows
    : [];
  const imageOptimizationRows = Array.isArray(inventory.image_optimization_rows)
    ? inventory.image_optimization_rows
    : [];
  const cdnRows = Array.isArray(inventory.cdn_rows) ? inventory.cdn_rows : [];
  const lazyloadRows = Array.isArray(inventory.lazyload_rows)
    ? inventory.lazyload_rows
    : [];

  const normalizedCacheLayerRows = cacheLayerRows.map(row => {
    const risk = classifyWordpressCacheLayerRisk(row);
    return {
      ...row,
      cache_key: risk.cache_key,
      enabled: risk.enabled,
      provider: risk.provider,
      mode: risk.mode,
      scope: risk.scope,
      performance_risk_score: risk.performance_risk_score,
      performance_risk_class: risk.performance_risk_class,
      performance_risk_reasons: risk.performance_risk_reasons
    };
  });

  const normalizeOptimizationLikeRow = row => {
    const risk = classifyWordpressOptimizationRisk(row);
    return {
      ...row,
      optimization_key: risk.optimization_key,
      enabled: risk.enabled,
      provider: risk.provider,
      mode: risk.mode,
      target_scope: risk.target_scope,
      performance_risk_score: risk.performance_risk_score,
      performance_risk_class: risk.performance_risk_class,
      performance_risk_reasons: risk.performance_risk_reasons
    };
  };

  const normalizedAssetOptimizationRows = assetOptimizationRows.map(
    normalizeOptimizationLikeRow
  );
  const normalizedImageOptimizationRows = imageOptimizationRows.map(
    normalizeOptimizationLikeRow
  );
  const normalizedCdnRows = cdnRows.map(normalizeOptimizationLikeRow);
  const normalizedLazyloadRows = lazyloadRows.map(normalizeOptimizationLikeRow);

  const allRows = [
    ...normalizedCacheLayerRows,
    ...normalizedAssetOptimizationRows,
    ...normalizedImageOptimizationRows,
    ...normalizedCdnRows,
    ...normalizedLazyloadRows
  ];

  const riskSummary = allRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const riskClass = String(row?.performance_risk_class || "").trim();
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "cache_layer") acc.cache_layer_count += 1;
      else if (entityType === "asset_optimization") acc.asset_optimization_count += 1;
      else if (entityType === "image_optimization") acc.image_optimization_count += 1;
      else if (entityType === "cdn_surface") acc.cdn_count += 1;
      else if (entityType === "lazyload_surface") acc.lazyload_count += 1;

      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    }
  );

  return {
    normalized_cache_layer_rows: normalizedCacheLayerRows,
    normalized_asset_optimization_rows: normalizedAssetOptimizationRows,
    normalized_image_optimization_rows: normalizedImageOptimizationRows,
    normalized_cdn_rows: normalizedCdnRows,
    normalized_lazyload_rows: normalizedLazyloadRows,
    risk_summary: riskSummary
  };
}

export function buildWordpressPhaseINormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_i_performance_strategy",
    artifact_version: "v1",
    phase_i_gate_status: String(gate.phase_i_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            cache_layer_count: 0,
            asset_optimization_count: 0,
            image_optimization_count: 0,
            cdn_count: 0,
            lazyload_count: 0
          },
    normalized_cache_layer_rows: Array.isArray(
      normalizedInventory.normalized_cache_layer_rows
    )
      ? normalizedInventory.normalized_cache_layer_rows
      : [],
    normalized_asset_optimization_rows: Array.isArray(
      normalizedInventory.normalized_asset_optimization_rows
    )
      ? normalizedInventory.normalized_asset_optimization_rows
      : [],
    normalized_image_optimization_rows: Array.isArray(
      normalizedInventory.normalized_image_optimization_rows
    )
      ? normalizedInventory.normalized_image_optimization_rows
      : [],
    normalized_cdn_rows: Array.isArray(normalizedInventory.normalized_cdn_rows)
      ? normalizedInventory.normalized_cdn_rows
      : [],
    normalized_lazyload_rows: Array.isArray(
      normalizedInventory.normalized_lazyload_rows
    )
      ? normalizedInventory.normalized_lazyload_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseIReadinessGate(args = {}) {
  const phaseIPlan =
    args.phaseIPlan && typeof args.phaseIPlan === "object" ? args.phaseIPlan : {};
  const phaseIGate =
    args.phaseIGate && typeof args.phaseIGate === "object" ? args.phaseIGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseIGate.blocking_reasons || [])];

  if (phaseIPlan.enabled !== true) {
    blockingReasons.push("phase_i_not_enabled");
  }

  const highRiskCount = Number(riskSummary.high_risk_count || 0);
  const mediumRiskCount = Number(riskSummary.medium_risk_count || 0);

  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_performance_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_performance_reconciliation"
      : "blocked_for_performance_reconciliation",
    readiness_ready: readiness,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: Number(riskSummary.low_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseISafeCandidates(args = {}) {
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
      cache_layer_candidates: [],
      asset_optimization_candidates: [],
      image_optimization_candidates: [],
      cdn_candidates: [],
      lazyload_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_i_readiness_not_ready"]
    };
  }

  const normalizedCacheLayerRows = Array.isArray(
    normalizedInventory.normalized_cache_layer_rows
  )
    ? normalizedInventory.normalized_cache_layer_rows
    : [];
  const normalizedAssetOptimizationRows = Array.isArray(
    normalizedInventory.normalized_asset_optimization_rows
  )
    ? normalizedInventory.normalized_asset_optimization_rows
    : [];
  const normalizedImageOptimizationRows = Array.isArray(
    normalizedInventory.normalized_image_optimization_rows
  )
    ? normalizedInventory.normalized_image_optimization_rows
    : [];
  const normalizedCdnRows = Array.isArray(normalizedInventory.normalized_cdn_rows)
    ? normalizedInventory.normalized_cdn_rows
    : [];
  const normalizedLazyloadRows = Array.isArray(normalizedInventory.normalized_lazyload_rows)
    ? normalizedInventory.normalized_lazyload_rows
    : [];

  const cacheLayerCandidates = normalizedCacheLayerRows
    .filter(row => String(row?.performance_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "cache_layer",
      cache_key: String(row?.cache_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      scope: String(row?.scope || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      candidate_reason: "non_high_risk_cache_layer_candidate"
    }));

  const assetOptimizationCandidates = normalizedAssetOptimizationRows
    .filter(row => String(row?.performance_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "asset_optimization",
      optimization_key: String(row?.optimization_key || "").trim(),
      enabled: row?.enabled === true,
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      candidate_reason: "non_high_risk_asset_optimization_candidate"
    }));

  const imageOptimizationCandidates = normalizedImageOptimizationRows
    .filter(row => String(row?.performance_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "image_optimization",
      optimization_key: String(row?.optimization_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      candidate_reason: "non_high_risk_image_optimization_candidate"
    }));

  const cdnCandidates = normalizedCdnRows
    .filter(row => String(row?.performance_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "cdn_surface",
      optimization_key: String(row?.optimization_key || row?.cdn_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      candidate_reason: "non_high_risk_cdn_candidate"
    }));

  const lazyloadCandidates = normalizedLazyloadRows
    .filter(row => String(row?.performance_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "lazyload_surface",
      optimization_key: String(row?.optimization_key || row?.lazyload_key || "").trim(),
      enabled: row?.enabled === true,
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      candidate_reason: "non_high_risk_lazyload_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      cacheLayerCandidates.length +
      assetOptimizationCandidates.length +
      imageOptimizationCandidates.length +
      cdnCandidates.length +
      lazyloadCandidates.length,
    cache_layer_candidates: cacheLayerCandidates,
    asset_optimization_candidates: assetOptimizationCandidates,
    image_optimization_candidates: imageOptimizationCandidates,
    cdn_candidates: cdnCandidates,
    lazyload_candidates: lazyloadCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseIReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_i_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    high_risk_count: Number(readiness.high_risk_count || 0),
    medium_risk_count: Number(readiness.medium_risk_count || 0),
    low_risk_count: Number(readiness.low_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    cache_layer_candidates: Array.isArray(safeCandidates.cache_layer_candidates)
      ? safeCandidates.cache_layer_candidates
      : [],
    asset_optimization_candidates: Array.isArray(
      safeCandidates.asset_optimization_candidates
    )
      ? safeCandidates.asset_optimization_candidates
      : [],
    image_optimization_candidates: Array.isArray(
      safeCandidates.image_optimization_candidates
    )
      ? safeCandidates.image_optimization_candidates
      : [],
    cdn_candidates: Array.isArray(safeCandidates.cdn_candidates)
      ? safeCandidates.cdn_candidates
      : [],
    lazyload_candidates: Array.isArray(safeCandidates.lazyload_candidates)
      ? safeCandidates.lazyload_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressCacheLayerReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "cache_layer",
    cache_key: String(row?.cache_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    scope: String(row?.scope || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    payload_mode: "safe_cache_layer_reconciliation_candidate",
    payload_shape: {
      cache_key: String(row?.cache_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      scope: String(row?.scope || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressOptimizationReconciliationPayloadRow(row = {}) {
  return {
    entity_type: String(row?.entity_type || "").trim(),
    optimization_key: String(row?.optimization_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    payload_mode: "safe_optimization_reconciliation_candidate",
    payload_shape: {
      optimization_key: String(row?.optimization_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseIReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      cache_layer_payload_rows: [],
      asset_optimization_payload_rows: [],
      image_optimization_payload_rows: [],
      cdn_payload_rows: [],
      lazyload_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_i_safe_candidates_not_ready"]
    };
  }

  const cacheLayerCandidates = Array.isArray(safeCandidates.cache_layer_candidates)
    ? safeCandidates.cache_layer_candidates
    : [];
  const assetOptimizationCandidates = Array.isArray(
    safeCandidates.asset_optimization_candidates
  )
    ? safeCandidates.asset_optimization_candidates
    : [];
  const imageOptimizationCandidates = Array.isArray(
    safeCandidates.image_optimization_candidates
  )
    ? safeCandidates.image_optimization_candidates
    : [];
  const cdnCandidates = Array.isArray(safeCandidates.cdn_candidates)
    ? safeCandidates.cdn_candidates
    : [];
  const lazyloadCandidates = Array.isArray(safeCandidates.lazyload_candidates)
    ? safeCandidates.lazyload_candidates
    : [];

  const cacheLayerPayloadRows = cacheLayerCandidates.map(
    buildWordpressCacheLayerReconciliationPayloadRow
  );
  const assetOptimizationPayloadRows = assetOptimizationCandidates.map(
    buildWordpressOptimizationReconciliationPayloadRow
  );
  const imageOptimizationPayloadRows = imageOptimizationCandidates.map(
    buildWordpressOptimizationReconciliationPayloadRow
  );
  const cdnPayloadRows = cdnCandidates.map(
    buildWordpressOptimizationReconciliationPayloadRow
  );
  const lazyloadPayloadRows = lazyloadCandidates.map(
    buildWordpressOptimizationReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      cacheLayerPayloadRows.length +
      assetOptimizationPayloadRows.length +
      imageOptimizationPayloadRows.length +
      cdnPayloadRows.length +
      lazyloadPayloadRows.length,
    cache_layer_payload_rows: cacheLayerPayloadRows,
    asset_optimization_payload_rows: assetOptimizationPayloadRows,
    image_optimization_payload_rows: imageOptimizationPayloadRows,
    cdn_payload_rows: cdnPayloadRows,
    lazyload_payload_rows: lazyloadPayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseIReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_i_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    cache_layer_payload_rows: Array.isArray(planner.cache_layer_payload_rows)
      ? planner.cache_layer_payload_rows
      : [],
    asset_optimization_payload_rows: Array.isArray(
      planner.asset_optimization_payload_rows
    )
      ? planner.asset_optimization_payload_rows
      : [],
    image_optimization_payload_rows: Array.isArray(
      planner.image_optimization_payload_rows
    )
      ? planner.image_optimization_payload_rows
      : [],
    cdn_payload_rows: Array.isArray(planner.cdn_payload_rows)
      ? planner.cdn_payload_rows
      : [],
    lazyload_payload_rows: Array.isArray(planner.lazyload_payload_rows)
      ? planner.lazyload_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseIExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const performanceOptimization =
    migration.performance_optimization &&
    typeof migration.performance_optimization === "object"
      ? migration.performance_optimization
      : {};
  const execution =
    performanceOptimization.execution &&
    typeof performanceOptimization.execution === "object"
      ? performanceOptimization.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

export function buildWordpressPhaseIExecutionGuard(args = {}) {
  const phaseIPlan =
    args.phaseIPlan && typeof args.phaseIPlan === "object" ? args.phaseIPlan : {};
  const phaseIGate =
    args.phaseIGate && typeof args.phaseIGate === "object" ? args.phaseIGate : {};
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

  if (phaseIPlan.enabled !== true) {
    blockingReasons.push("phase_i_not_enabled");
  }
  if (phaseIGate.phase_i_gate_ready !== true) {
    blockingReasons.push("phase_i_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_i_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_i_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_i_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_i_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseIPlan.inventory_only === true && phaseIPlan.apply === true) {
    blockingReasons.push("phase_i_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_performance_reconciliation_execution"
      : "blocked_before_performance_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseIExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_i_execution_guard",
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

export function buildWordpressPhaseIMutationCandidateSelector(args = {}) {
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
      selected_cache_layer_candidates: [],
      selected_asset_optimization_candidates: [],
      selected_image_optimization_candidates: [],
      selected_cdn_candidates: [],
      selected_lazyload_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_i_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_cache_layer_candidates: [],
      selected_asset_optimization_candidates: [],
      selected_image_optimization_candidates: [],
      selected_cdn_candidates: [],
      selected_lazyload_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_i_payload_planner_not_ready"]
    };
  }

  const cacheLayerPayloadRows = Array.isArray(payloadPlanner.cache_layer_payload_rows)
    ? payloadPlanner.cache_layer_payload_rows
    : [];
  const assetOptimizationPayloadRows = Array.isArray(
    payloadPlanner.asset_optimization_payload_rows
  )
    ? payloadPlanner.asset_optimization_payload_rows
    : [];
  const imageOptimizationPayloadRows = Array.isArray(
    payloadPlanner.image_optimization_payload_rows
  )
    ? payloadPlanner.image_optimization_payload_rows
    : [];
  const cdnPayloadRows = Array.isArray(payloadPlanner.cdn_payload_rows)
    ? payloadPlanner.cdn_payload_rows
    : [];
  const lazyloadPayloadRows = Array.isArray(payloadPlanner.lazyload_payload_rows)
    ? payloadPlanner.lazyload_payload_rows
    : [];

  const selectedCacheLayerCandidates = [];
  const selectedAssetOptimizationCandidates = [];
  const selectedImageOptimizationCandidates = [];
  const selectedCdnCandidates = [];
  const selectedLazyloadCandidates = [];
  const rejectedCandidates = [];

  for (const row of cacheLayerPayloadRows) {
    const riskClass = String(row?.performance_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "cache_layer",
        cache_key: String(row?.cache_key || "").trim(),
        rejection_reason: "high_risk_cache_layer_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_cache_layer_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "cache_layer",
        cache_key: String(row?.cache_key || "").trim(),
        rejection_reason: "unsupported_cache_layer_payload_mode"
      });
      continue;
    }

    selectedCacheLayerCandidates.push({
      ...row,
      candidate_reason: "safe_cache_layer_candidate_ready_for_mutation"
    });
  }

  for (const row of assetOptimizationPayloadRows) {
    const riskClass = String(row?.performance_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "asset_optimization",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "high_risk_asset_optimization_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_optimization_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "asset_optimization",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "unsupported_asset_optimization_payload_mode"
      });
      continue;
    }

    selectedAssetOptimizationCandidates.push({
      ...row,
      candidate_reason: "safe_asset_optimization_candidate_ready_for_mutation"
    });
  }

  for (const row of imageOptimizationPayloadRows) {
    const riskClass = String(row?.performance_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "image_optimization",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "high_risk_image_optimization_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_optimization_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "image_optimization",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "unsupported_image_optimization_payload_mode"
      });
      continue;
    }

    selectedImageOptimizationCandidates.push({
      ...row,
      candidate_reason: "safe_image_optimization_candidate_ready_for_mutation"
    });
  }

  for (const row of cdnPayloadRows) {
    const riskClass = String(row?.performance_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "cdn_surface",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "high_risk_cdn_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_optimization_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "cdn_surface",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "unsupported_cdn_payload_mode"
      });
      continue;
    }

    selectedCdnCandidates.push({
      ...row,
      candidate_reason: "safe_cdn_candidate_ready_for_mutation"
    });
  }

  for (const row of lazyloadPayloadRows) {
    const riskClass = String(row?.performance_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "lazyload_surface",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "high_risk_lazyload_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_optimization_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "lazyload_surface",
        optimization_key: String(row?.optimization_key || "").trim(),
        rejection_reason: "unsupported_lazyload_payload_mode"
      });
      continue;
    }

    selectedLazyloadCandidates.push({
      ...row,
      candidate_reason: "safe_lazyload_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedCacheLayerCandidates =
    selectedCacheLayerCandidates.slice(0, candidateLimit);
  const limitedSelectedAssetOptimizationCandidates =
    selectedAssetOptimizationCandidates.slice(0, candidateLimit);
  const limitedSelectedImageOptimizationCandidates =
    selectedImageOptimizationCandidates.slice(0, candidateLimit);
  const limitedSelectedCdnCandidates = selectedCdnCandidates.slice(0, candidateLimit);
  const limitedSelectedLazyloadCandidates =
    selectedLazyloadCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedCacheLayerCandidates.length +
      limitedSelectedAssetOptimizationCandidates.length +
      limitedSelectedImageOptimizationCandidates.length +
      limitedSelectedCdnCandidates.length +
      limitedSelectedLazyloadCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_cache_layer_candidates: limitedSelectedCacheLayerCandidates,
    selected_asset_optimization_candidates:
      limitedSelectedAssetOptimizationCandidates,
    selected_image_optimization_candidates:
      limitedSelectedImageOptimizationCandidates,
    selected_cdn_candidates: limitedSelectedCdnCandidates,
    selected_lazyload_candidates: limitedSelectedLazyloadCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseIMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_i_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_cache_layer_candidates: Array.isArray(
      selector.selected_cache_layer_candidates
    )
      ? selector.selected_cache_layer_candidates
      : [],
    selected_asset_optimization_candidates: Array.isArray(
      selector.selected_asset_optimization_candidates
    )
      ? selector.selected_asset_optimization_candidates
      : [],
    selected_image_optimization_candidates: Array.isArray(
      selector.selected_image_optimization_candidates
    )
      ? selector.selected_image_optimization_candidates
      : [],
    selected_cdn_candidates: Array.isArray(selector.selected_cdn_candidates)
      ? selector.selected_cdn_candidates
      : [],
    selected_lazyload_candidates: Array.isArray(
      selector.selected_lazyload_candidates
    )
      ? selector.selected_lazyload_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressCacheLayerMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_cache_layer_reconciliation",
    target_scope: "destination_wordpress_cache_layer",
    payload: {
      cache_key: Object.prototype.hasOwnProperty.call(payloadShape, "cache_key")
        ? payloadShape.cache_key
        : String(row?.cache_key || "").trim(),
      enabled: Object.prototype.hasOwnProperty.call(payloadShape, "enabled")
        ? payloadShape.enabled === true
        : row?.enabled === true,
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      scope: Object.prototype.hasOwnProperty.call(payloadShape, "scope")
        ? payloadShape.scope
        : String(row?.scope || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressOptimizationMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_optimization_reconciliation",
    target_scope: "destination_wordpress_performance_surface",
    payload: {
      optimization_key: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "optimization_key"
      )
        ? payloadShape.optimization_key
        : String(row?.optimization_key || "").trim(),
      enabled: Object.prototype.hasOwnProperty.call(payloadShape, "enabled")
        ? payloadShape.enabled === true
        : row?.enabled === true,
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      target_scope: Object.prototype.hasOwnProperty.call(payloadShape, "target_scope")
        ? payloadShape.target_scope
        : String(row?.target_scope || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseIMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      cache_layer_composed_payloads: [],
      asset_optimization_composed_payloads: [],
      image_optimization_composed_payloads: [],
      cdn_composed_payloads: [],
      lazyload_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_i_mutation_candidates_not_ready"]
    };
  }

  const selectedCacheLayerCandidates = Array.isArray(
    selector.selected_cache_layer_candidates
  )
    ? selector.selected_cache_layer_candidates
    : [];
  const selectedAssetOptimizationCandidates = Array.isArray(
    selector.selected_asset_optimization_candidates
  )
    ? selector.selected_asset_optimization_candidates
    : [];
  const selectedImageOptimizationCandidates = Array.isArray(
    selector.selected_image_optimization_candidates
  )
    ? selector.selected_image_optimization_candidates
    : [];
  const selectedCdnCandidates = Array.isArray(selector.selected_cdn_candidates)
    ? selector.selected_cdn_candidates
    : [];
  const selectedLazyloadCandidates = Array.isArray(selector.selected_lazyload_candidates)
    ? selector.selected_lazyload_candidates
    : [];

  const cacheLayerComposedPayloads = selectedCacheLayerCandidates.map(row => ({
    entity_type: "cache_layer",
    cache_key: String(row?.cache_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    scope: String(row?.scope || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    payload_reason: "composed_from_safe_cache_layer_candidate",
    mutation_payload: buildWordpressCacheLayerMutationPayloadFromCandidate(row)
  }));

  const assetOptimizationComposedPayloads = selectedAssetOptimizationCandidates.map(
    row => ({
      entity_type: "asset_optimization",
      optimization_key: String(row?.optimization_key || "").trim(),
      enabled: row?.enabled === true,
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      payload_reason: "composed_from_safe_asset_optimization_candidate",
      mutation_payload: buildWordpressOptimizationMutationPayloadFromCandidate(row)
    })
  );

  const imageOptimizationComposedPayloads = selectedImageOptimizationCandidates.map(
    row => ({
      entity_type: "image_optimization",
      optimization_key: String(row?.optimization_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      payload_reason: "composed_from_safe_image_optimization_candidate",
      mutation_payload: buildWordpressOptimizationMutationPayloadFromCandidate(row)
    })
  );

  const cdnComposedPayloads = selectedCdnCandidates.map(row => ({
    entity_type: "cdn_surface",
    optimization_key: String(row?.optimization_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    payload_reason: "composed_from_safe_cdn_candidate",
    mutation_payload: buildWordpressOptimizationMutationPayloadFromCandidate(row)
  }));

  const lazyloadComposedPayloads = selectedLazyloadCandidates.map(row => ({
    entity_type: "lazyload_surface",
    optimization_key: String(row?.optimization_key || "").trim(),
    enabled: row?.enabled === true,
    mode: String(row?.mode || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    payload_reason: "composed_from_safe_lazyload_candidate",
    mutation_payload: buildWordpressOptimizationMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      cacheLayerComposedPayloads.length +
      assetOptimizationComposedPayloads.length +
      imageOptimizationComposedPayloads.length +
      cdnComposedPayloads.length +
      lazyloadComposedPayloads.length,
    cache_layer_composed_payloads: cacheLayerComposedPayloads,
    asset_optimization_composed_payloads: assetOptimizationComposedPayloads,
    image_optimization_composed_payloads: imageOptimizationComposedPayloads,
    cdn_composed_payloads: cdnComposedPayloads,
    lazyload_composed_payloads: lazyloadComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseIMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_i_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    cache_layer_composed_payloads: Array.isArray(
      composer.cache_layer_composed_payloads
    )
      ? composer.cache_layer_composed_payloads
      : [],
    asset_optimization_composed_payloads: Array.isArray(
      composer.asset_optimization_composed_payloads
    )
      ? composer.asset_optimization_composed_payloads
      : [],
    image_optimization_composed_payloads: Array.isArray(
      composer.image_optimization_composed_payloads
    )
      ? composer.image_optimization_composed_payloads
      : [],
    cdn_composed_payloads: Array.isArray(composer.cdn_composed_payloads)
      ? composer.cdn_composed_payloads
      : [],
    lazyload_composed_payloads: Array.isArray(composer.lazyload_composed_payloads)
      ? composer.lazyload_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressPerformanceDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "cache_layer") {
    return {
      entity_type: "cache_layer",
      cache_key: String(row?.cache_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      scope: String(row?.scope || "").trim(),
      performance_risk_class: String(row?.performance_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_cache_key: String(payload.cache_key || "").trim(),
        expected_enabled: payload?.enabled === true ? "true" : "false",
        expected_provider: String(payload.provider || "").trim(),
        expected_mode: String(payload.mode || "").trim(),
        expected_scope: String(payload.scope || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: entityType,
    optimization_key: String(row?.optimization_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    performance_risk_class: String(row?.performance_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_optimization_key: String(payload.optimization_key || "").trim(),
      expected_enabled: payload?.enabled === true ? "true" : "false",
      expected_provider: String(payload.provider || "").trim(),
      expected_mode: String(payload.mode || "").trim(),
      expected_target_scope: String(payload.target_scope || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseIDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_cache_layer_rows: [],
      simulated_asset_optimization_rows: [],
      simulated_image_optimization_rows: [],
      simulated_cdn_rows: [],
      simulated_lazyload_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        cache_layer_rows: 0,
        asset_optimization_rows: 0,
        image_optimization_rows: 0,
        cdn_rows: 0,
        lazyload_rows: 0,
        preserve_from_source_count: 0,
        enabled_true_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_i_mutation_payloads_not_ready"]
    };
  }

  const cacheLayerRows = Array.isArray(composer.cache_layer_composed_payloads)
    ? composer.cache_layer_composed_payloads
    : [];
  const assetOptimizationRows = Array.isArray(
    composer.asset_optimization_composed_payloads
  )
    ? composer.asset_optimization_composed_payloads
    : [];
  const imageOptimizationRows = Array.isArray(
    composer.image_optimization_composed_payloads
  )
    ? composer.image_optimization_composed_payloads
    : [];
  const cdnRows = Array.isArray(composer.cdn_composed_payloads)
    ? composer.cdn_composed_payloads
    : [];
  const lazyloadRows = Array.isArray(composer.lazyload_composed_payloads)
    ? composer.lazyload_composed_payloads
    : [];

  const simulatedCacheLayerRows = cacheLayerRows.map(simulateWordpressPerformanceDryRunRow);
  const simulatedAssetOptimizationRows = assetOptimizationRows.map(
    simulateWordpressPerformanceDryRunRow
  );
  const simulatedImageOptimizationRows = imageOptimizationRows.map(
    simulateWordpressPerformanceDryRunRow
  );
  const simulatedCdnRows = cdnRows.map(simulateWordpressPerformanceDryRunRow);
  const simulatedLazyloadRows = lazyloadRows.map(simulateWordpressPerformanceDryRunRow);

  const allRows = [
    ...simulatedCacheLayerRows,
    ...simulatedAssetOptimizationRows,
    ...simulatedImageOptimizationRows,
    ...simulatedCdnRows,
    ...simulatedLazyloadRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "cache_layer") acc.cache_layer_rows += 1;
      else if (entityType === "asset_optimization") acc.asset_optimization_rows += 1;
      else if (entityType === "image_optimization") acc.image_optimization_rows += 1;
      else if (entityType === "cdn_surface") acc.cdn_rows += 1;
      else if (entityType === "lazyload_surface") acc.lazyload_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (String(preview.expected_apply_mode || "").trim() === "preserve_from_source") {
        acc.preserve_from_source_count += 1;
      }

      if (String(preview.expected_enabled || "").trim() === "true") {
        acc.enabled_true_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      cache_layer_rows: 0,
      asset_optimization_rows: 0,
      image_optimization_rows: 0,
      cdn_rows: 0,
      lazyload_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_cache_layer_rows: simulatedCacheLayerRows,
    simulated_asset_optimization_rows: simulatedAssetOptimizationRows,
    simulated_image_optimization_rows: simulatedImageOptimizationRows,
    simulated_cdn_rows: simulatedCdnRows,
    simulated_lazyload_rows: simulatedLazyloadRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseIDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_i_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_cache_layer_rows: Array.isArray(simulator.simulated_cache_layer_rows)
      ? simulator.simulated_cache_layer_rows
      : [],
    simulated_asset_optimization_rows: Array.isArray(
      simulator.simulated_asset_optimization_rows
    )
      ? simulator.simulated_asset_optimization_rows
      : [],
    simulated_image_optimization_rows: Array.isArray(
      simulator.simulated_image_optimization_rows
    )
      ? simulator.simulated_image_optimization_rows
      : [],
    simulated_cdn_rows: Array.isArray(simulator.simulated_cdn_rows)
      ? simulator.simulated_cdn_rows
      : [],
    simulated_lazyload_rows: Array.isArray(simulator.simulated_lazyload_rows)
      ? simulator.simulated_lazyload_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            cache_layer_rows: 0,
            asset_optimization_rows: 0,
            image_optimization_rows: 0,
            cdn_rows: 0,
            lazyload_rows: 0,
            preserve_from_source_count: 0,
            enabled_true_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseIFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseIPlan =
    args.phaseIPlan && typeof args.phaseIPlan === "object" ? args.phaseIPlan : {};
  const phaseIGate =
    args.phaseIGate && typeof args.phaseIGate === "object" ? args.phaseIGate : {};
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
    artifact_type: "wordpress_phase_i_final_operator_handoff",
    artifact_version: "v1",
    phase_i_enabled: phaseIPlan.enabled === true,
    phase_i_inventory_only: phaseIPlan.inventory_only === true,
    phase_i_apply_requested: phaseIPlan.apply === true,
    requested_performance_scope: {
      include_cache_layers: phaseIPlan.include_cache_layers === true,
      include_asset_optimization: phaseIPlan.include_asset_optimization === true,
      include_image_optimization: phaseIPlan.include_image_optimization === true,
      include_cdn: phaseIPlan.include_cdn === true,
      include_lazyload: phaseIPlan.include_lazyload === true,
      max_items: Number(phaseIPlan.max_items || 0)
    },
    requested_performance_config:
      migration?.performance_optimization &&
      typeof migration.performance_optimization === "object"
        ? migration.performance_optimization
        : {},
    phase_i_gate_status: String(phaseIGate.phase_i_gate_status || "").trim(),
    phase_i_inventory_status: String(inventoryArtifact.phase_i_inventory_status || "").trim(),
    phase_i_strategy_status: String(
      normalizedInventoryArtifact.phase_i_gate_status || ""
    ).trim(),
    phase_i_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_i_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_i_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_i_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_i_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_i_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_i_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            cache_layer_count: 0,
            asset_optimization_count: 0,
            image_optimization_count: 0,
            cdn_count: 0,
            lazyload_count: 0
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
            cache_layer_count: 0,
            asset_optimization_count: 0,
            image_optimization_count: 0,
            cdn_count: 0,
            lazyload_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseIGate.blocking_reasons) ? phaseIGate.blocking_reasons : []),
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
        ? "review_safe_performance_candidates"
        : "resolve_performance_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_performance_reconciliation_execution"
        ? "approve_performance_mutation_trial"
        : "hold_performance_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_performance_dry_run_preview"
        : "no_performance_dry_run_preview_available"
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