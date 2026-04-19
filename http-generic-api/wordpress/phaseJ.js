// Phase J — Security / Headers / Hardening surfaces
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  MAX_TIMEOUT_SECONDS
} from "../config.js";

export function resolveWordpressPhaseJPlan(payload = {}) {
  const migration = payload?.migration || {};
  const securityHardening =
    migration.security_hardening &&
    typeof migration.security_hardening === "object"
      ? migration.security_hardening
      : {};

  return {
    enabled: securityHardening.enabled === true,
    inventory_only:
      securityHardening.inventory_only === undefined
        ? true
        : securityHardening.inventory_only === true,
    apply: securityHardening.apply === true,
    include_security_headers:
      securityHardening.include_security_headers === undefined
        ? true
        : securityHardening.include_security_headers === true,
    include_waf_surface:
      securityHardening.include_waf_surface === undefined
        ? true
        : securityHardening.include_waf_surface === true,
    include_hardening_controls:
      securityHardening.include_hardening_controls === undefined
        ? true
        : securityHardening.include_hardening_controls === true,
    include_exposed_surfaces:
      securityHardening.include_exposed_surfaces === undefined
        ? true
        : securityHardening.include_exposed_surfaces === true,
    include_tls_surface:
      securityHardening.include_tls_surface === undefined
        ? true
        : securityHardening.include_tls_surface === true,
    max_items: Math.max(1, toPositiveInt(securityHardening.max_items, 500))
  };
}

export function assertWordpressPhaseJPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_j_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_j_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_security_headers !== true &&
    plan.include_waf_surface !== true &&
    plan.include_hardening_controls !== true &&
    plan.include_exposed_surfaces !== true &&
    plan.include_tls_surface !== true
  ) {
    blockingReasons.push("phase_j_no_inventory_scope_selected");
  }

  return {
    phase_j_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_j_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseJGate(args = {}) {
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
  const phaseIFinalOperatorHandoffBundle =
    args.phaseIFinalOperatorHandoffBundle &&
    typeof args.phaseIFinalOperatorHandoffBundle === "object"
      ? args.phaseIFinalOperatorHandoffBundle
      : {};
  const phaseJPlan =
    args.phaseJPlan && typeof args.phaseJPlan === "object" ? args.phaseJPlan : {};
  const phaseJPlanStatus =
    args.phaseJPlanStatus && typeof args.phaseJPlanStatus === "object"
      ? args.phaseJPlanStatus
      : {};

  const blockingReasons = [...(phaseJPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_j");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseGFinalOperatorHandoffBundle.phase_g_enabled === true &&
    String(phaseGFinalOperatorHandoffBundle.phase_g_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_g_seo_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseHFinalOperatorHandoffBundle.phase_h_enabled === true &&
    String(phaseHFinalOperatorHandoffBundle.phase_h_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_h_analytics_tracking_stage_blocked");
  }

  if (
    phaseJPlan.enabled === true &&
    phaseIFinalOperatorHandoffBundle.phase_i_enabled === true &&
    String(phaseIFinalOperatorHandoffBundle.phase_i_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_i_performance_stage_blocked");
  }

  return {
    phase_j_gate_status:
      blockingReasons.length === 0
        ? "ready_for_security_hardening_inventory"
        : "blocked",
    phase_j_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseJPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressSecurityPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_wordfence: normalized.some(x => x.includes("wordfence")),
    has_sucuri: normalized.some(x => x.includes("sucuri")),
    has_ithemes_security: normalized.some(
      x => x.includes("better-wp-security") || x.includes("ithemes-security")
    ),
    has_really_simple_ssl: normalized.some(x => x.includes("really-simple-ssl")),
    has_headers_plugin: normalized.some(
      x => x.includes("http-headers") || x.includes("headers-security-advanced")
    ),
    has_limit_login: normalized.some(
      x => x.includes("limit-login-attempts") || x.includes("wp-limit-login-attempts")
    )
  };
}

export function buildWordpressSecurityHeaderRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const headers =
    siteProfile?.security_surfaces &&
    typeof siteProfile.security_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces) &&
    siteProfile.security_surfaces.security_headers &&
    typeof siteProfile.security_surfaces.security_headers === "object" &&
    !Array.isArray(siteProfile.security_surfaces.security_headers)
      ? siteProfile.security_surfaces.security_headers
      : {};

  for (const [key, valueRaw] of Object.entries(headers).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "security_header",
      header_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      header_value: String(value.header_value || value.value || "").trim(),
      mode: String(value.mode || "").trim(),
      inventory_classification: "security_header"
    });
  }

  return rows;
}

export function buildWordpressWafRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const waf =
    siteProfile?.security_surfaces &&
    typeof siteProfile.security_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces) &&
    siteProfile.security_surfaces.waf_surface &&
    typeof siteProfile.security_surfaces.waf_surface === "object" &&
    !Array.isArray(siteProfile.security_surfaces.waf_surface)
      ? siteProfile.security_surfaces.waf_surface
      : {};

  for (const [key, valueRaw] of Object.entries(waf).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "waf_surface",
      waf_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      mode: String(value.mode || "").trim(),
      inventory_classification: "waf_surface"
    });
  }

  return rows;
}

export function buildWordpressHardeningControlRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const controls =
    siteProfile?.security_surfaces &&
    typeof siteProfile.security_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces) &&
    siteProfile.security_surfaces.hardening_controls &&
    typeof siteProfile.security_surfaces.hardening_controls === "object" &&
    !Array.isArray(siteProfile.security_surfaces.hardening_controls)
      ? siteProfile.security_surfaces.hardening_controls
      : {};

  for (const [key, valueRaw] of Object.entries(controls).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "hardening_control",
      control_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      mode: String(value.mode || "").trim(),
      target_scope: String(value.target_scope || "").trim(),
      inventory_classification: "hardening_control"
    });
  }

  return rows;
}

export function buildWordpressExposedSurfaceRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const surfaces =
    siteProfile?.security_surfaces &&
    typeof siteProfile.security_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces) &&
    siteProfile.security_surfaces.exposed_surfaces &&
    typeof siteProfile.security_surfaces.exposed_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces.exposed_surfaces)
      ? siteProfile.security_surfaces.exposed_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(surfaces).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "exposed_surface",
      surface_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      exposure_type: String(value.exposure_type || "").trim(),
      target: String(value.target || "").trim(),
      inventory_classification: "exposed_surface"
    });
  }

  return rows;
}

export function buildWordpressTlsRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const tls =
    siteProfile?.security_surfaces &&
    typeof siteProfile.security_surfaces === "object" &&
    !Array.isArray(siteProfile.security_surfaces) &&
    siteProfile.security_surfaces.tls_surface &&
    typeof siteProfile.security_surfaces.tls_surface === "object" &&
    !Array.isArray(siteProfile.security_surfaces.tls_surface)
      ? siteProfile.security_surfaces.tls_surface
      : {};

  for (const [key, valueRaw] of Object.entries(tls).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "tls_surface",
      tls_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      protocol_mode: String(value.protocol_mode || "").trim(),
      provider: String(value.provider || "").trim(),
      inventory_classification: "tls_surface"
    });
  }

  return rows;
}

export async function runWordpressSecurityHardeningInventory(args = {}) {
  const {
    wpContext = {},
    phaseJPlan = {},
    phaseJGate = {}
  } = args;

  if (phaseJGate.phase_j_gate_ready !== true) {
    return {
      phase_j_inventory_status: "blocked",
      plugin_signals: {},
      security_header_rows: [],
      waf_rows: [],
      hardening_control_rows: [],
      exposed_surface_rows: [],
      tls_rows: [],
      summary: {
        security_header_count: 0,
        waf_count: 0,
        hardening_control_count: 0,
        exposed_surface_count: 0,
        tls_count: 0
      },
      failures: [
        {
          code: "phase_j_security_inventory_blocked",
          message:
            "Phase J security/headers/hardening inventory blocked by phase_j_gate.",
          blocking_reasons: phaseJGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressSecurityPluginSignals(sourceProfile);
    const securityHeaderRows =
      phaseJPlan.include_security_headers === true
        ? buildWordpressSecurityHeaderRows(sourceProfile, phaseJPlan.max_items)
        : [];
    const wafRows =
      phaseJPlan.include_waf_surface === true
        ? buildWordpressWafRows(sourceProfile, phaseJPlan.max_items)
        : [];
    const hardeningControlRows =
      phaseJPlan.include_hardening_controls === true
        ? buildWordpressHardeningControlRows(sourceProfile, phaseJPlan.max_items)
        : [];
    const exposedSurfaceRows =
      phaseJPlan.include_exposed_surfaces === true
        ? buildWordpressExposedSurfaceRows(sourceProfile, phaseJPlan.max_items)
        : [];
    const tlsRows =
      phaseJPlan.include_tls_surface === true
        ? buildWordpressTlsRows(sourceProfile, phaseJPlan.max_items)
        : [];

    return {
      phase_j_inventory_status: "completed",
      plugin_signals: pluginSignals,
      security_header_rows: securityHeaderRows,
      waf_rows: wafRows,
      hardening_control_rows: hardeningControlRows,
      exposed_surface_rows: exposedSurfaceRows,
      tls_rows: tlsRows,
      summary: {
        security_header_count: securityHeaderRows.length,
        waf_count: wafRows.length,
        hardening_control_count: hardeningControlRows.length,
        exposed_surface_count: exposedSurfaceRows.length,
        tls_count: tlsRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_security_inventory_failed",
      message: err?.message || "WordPress security/hardening inventory failed."
    });

    return {
      phase_j_inventory_status: "completed_with_failures",
      plugin_signals: {},
      security_header_rows: [],
      waf_rows: [],
      hardening_control_rows: [],
      exposed_surface_rows: [],
      tls_rows: [],
      summary: {
        security_header_count: 0,
        waf_count: 0,
        hardening_control_count: 0,
        exposed_surface_count: 0,
        tls_count: 0
      },
      failures
    };
  }
}

export function buildWordpressPhaseJInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_j_security_inventory",
    artifact_version: "v1",
    phase_j_gate_status: String(gate.phase_j_gate_status || "").trim(),
    phase_j_inventory_status: String(inventory.phase_j_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            security_header_count: 0,
            waf_count: 0,
            hardening_control_count: 0,
            exposed_surface_count: 0,
            tls_count: 0
          },
    security_header_rows: Array.isArray(inventory.security_header_rows)
      ? inventory.security_header_rows
      : [],
    waf_rows: Array.isArray(inventory.waf_rows) ? inventory.waf_rows : [],
    hardening_control_rows: Array.isArray(inventory.hardening_control_rows)
      ? inventory.hardening_control_rows
      : [],
    exposed_surface_rows: Array.isArray(inventory.exposed_surface_rows)
      ? inventory.exposed_surface_rows
      : [],
    tls_rows: Array.isArray(inventory.tls_rows) ? inventory.tls_rows : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressSecurityTextValue(value = "") {
  return String(value ?? "").trim();
}

export function classifyWordpressSecurityHeaderRisk(row = {}) {
  const headerKey = normalizeWordpressSecurityTextValue(row?.header_key);
  const enabled = row?.enabled === true;
  const headerValue = normalizeWordpressSecurityTextValue(row?.header_value);
  const mode = normalizeWordpressSecurityTextValue(row?.mode);

  let riskScore = 0;
  const reasons = [];

  if (!enabled) {
    riskScore += 2;
    reasons.push("security_header_disabled");
  }
  if (!headerValue) {
    riskScore += 2;
    reasons.push("missing_header_value");
  }
  if (!mode) {
    riskScore += 1;
    reasons.push("missing_header_mode");
  }
  if (
    ["strict-transport-security", "content-security-policy", "x-frame-options"].includes(
      headerKey.toLowerCase()
    ) &&
    !enabled
  ) {
    riskScore += 2;
    reasons.push("critical_security_header_not_enabled");
  }

  let security_risk_class = "low";
  if (riskScore >= 4) security_risk_class = "high";
  else if (riskScore >= 2) security_risk_class = "medium";

  return {
    header_key: headerKey,
    enabled,
    header_value: headerValue,
    mode,
    security_risk_score: riskScore,
    security_risk_class,
    security_risk_reasons: reasons
  };
}

export function classifyWordpressSecuritySurfaceRisk(row = {}) {
  const entityType = normalizeWordpressSecurityTextValue(row?.entity_type);
  const enabled = row?.enabled === true;
  const provider = normalizeWordpressSecurityTextValue(row?.provider);
  const mode = normalizeWordpressSecurityTextValue(row?.mode);
  const targetScope = normalizeWordpressSecurityTextValue(
    row?.target_scope || row?.target
  );
  const exposureType = normalizeWordpressSecurityTextValue(row?.exposure_type);
  const protocolMode = normalizeWordpressSecurityTextValue(row?.protocol_mode);

  let riskScore = 0;
  const reasons = [];

  if (!enabled) {
    riskScore += 1;
    reasons.push("security_surface_disabled");
  }

  if (entityType === "waf_surface") {
    if (!provider) {
      riskScore += 2;
      reasons.push("missing_waf_provider");
    }
    if (!mode) {
      riskScore += 1;
      reasons.push("missing_waf_mode");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("waf_not_enabled");
    }
  }

  if (entityType === "hardening_control") {
    if (!mode) {
      riskScore += 1;
      reasons.push("missing_hardening_mode");
    }
    if (!targetScope) {
      riskScore += 1;
      reasons.push("missing_hardening_target_scope");
    }
  }

  if (entityType === "exposed_surface") {
    if (enabled) {
      riskScore += 2;
      reasons.push("exposed_surface_enabled");
    }
    if (!exposureType) {
      riskScore += 1;
      reasons.push("missing_exposure_type");
    }
    if (!targetScope) {
      riskScore += 1;
      reasons.push("missing_exposed_target");
    }
  }

  if (entityType === "tls_surface") {
    if (!protocolMode) {
      riskScore += 2;
      reasons.push("missing_tls_protocol_mode");
    }
    if (!provider) {
      riskScore += 1;
      reasons.push("missing_tls_provider");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("tls_not_enabled");
    }
  }

  let security_risk_class = "low";
  if (riskScore >= 4) security_risk_class = "high";
  else if (riskScore >= 2) security_risk_class = "medium";

  return {
    enabled,
    provider,
    mode,
    target_scope: targetScope,
    exposure_type: exposureType,
    protocol_mode: protocolMode,
    security_risk_score: riskScore,
    security_risk_class,
    security_risk_reasons: reasons
  };
}

export function buildWordpressPhaseJNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const securityHeaderRows = Array.isArray(inventory.security_header_rows)
    ? inventory.security_header_rows
    : [];
  const wafRows = Array.isArray(inventory.waf_rows) ? inventory.waf_rows : [];
  const hardeningControlRows = Array.isArray(inventory.hardening_control_rows)
    ? inventory.hardening_control_rows
    : [];
  const exposedSurfaceRows = Array.isArray(inventory.exposed_surface_rows)
    ? inventory.exposed_surface_rows
    : [];
  const tlsRows = Array.isArray(inventory.tls_rows) ? inventory.tls_rows : [];

  const normalizedSecurityHeaderRows = securityHeaderRows.map(row => {
    const risk = classifyWordpressSecurityHeaderRisk(row);
    return {
      ...row,
      header_key: risk.header_key,
      enabled: risk.enabled,
      header_value: risk.header_value,
      mode: risk.mode,
      security_risk_score: risk.security_risk_score,
      security_risk_class: risk.security_risk_class,
      security_risk_reasons: risk.security_risk_reasons
    };
  });

  const normalizeSurfaceLikeRow = row => {
    const risk = classifyWordpressSecuritySurfaceRisk(row);
    return {
      ...row,
      enabled: risk.enabled,
      provider: risk.provider,
      mode: risk.mode,
      target_scope: risk.target_scope,
      exposure_type: risk.exposure_type,
      protocol_mode: risk.protocol_mode,
      security_risk_score: risk.security_risk_score,
      security_risk_class: risk.security_risk_class,
      security_risk_reasons: risk.security_risk_reasons
    };
  };

  const normalizedWafRows = wafRows.map(normalizeSurfaceLikeRow);
  const normalizedHardeningControlRows = hardeningControlRows.map(normalizeSurfaceLikeRow);
  const normalizedExposedSurfaceRows = exposedSurfaceRows.map(normalizeSurfaceLikeRow);
  const normalizedTlsRows = tlsRows.map(normalizeSurfaceLikeRow);

  const allRows = [
    ...normalizedSecurityHeaderRows,
    ...normalizedWafRows,
    ...normalizedHardeningControlRows,
    ...normalizedExposedSurfaceRows,
    ...normalizedTlsRows
  ];

  const riskSummary = allRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const riskClass = String(row?.security_risk_class || "").trim();
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "security_header") acc.security_header_count += 1;
      else if (entityType === "waf_surface") acc.waf_count += 1;
      else if (entityType === "hardening_control") acc.hardening_control_count += 1;
      else if (entityType === "exposed_surface") acc.exposed_surface_count += 1;
      else if (entityType === "tls_surface") acc.tls_count += 1;

      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    }
  );

  return {
    normalized_security_header_rows: normalizedSecurityHeaderRows,
    normalized_waf_rows: normalizedWafRows,
    normalized_hardening_control_rows: normalizedHardeningControlRows,
    normalized_exposed_surface_rows: normalizedExposedSurfaceRows,
    normalized_tls_rows: normalizedTlsRows,
    risk_summary: riskSummary
  };
}

export function buildWordpressPhaseJNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_j_security_strategy",
    artifact_version: "v1",
    phase_j_gate_status: String(gate.phase_j_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            security_header_count: 0,
            waf_count: 0,
            hardening_control_count: 0,
            exposed_surface_count: 0,
            tls_count: 0
          },
    normalized_security_header_rows: Array.isArray(
      normalizedInventory.normalized_security_header_rows
    )
      ? normalizedInventory.normalized_security_header_rows
      : [],
    normalized_waf_rows: Array.isArray(normalizedInventory.normalized_waf_rows)
      ? normalizedInventory.normalized_waf_rows
      : [],
    normalized_hardening_control_rows: Array.isArray(
      normalizedInventory.normalized_hardening_control_rows
    )
      ? normalizedInventory.normalized_hardening_control_rows
      : [],
    normalized_exposed_surface_rows: Array.isArray(
      normalizedInventory.normalized_exposed_surface_rows
    )
      ? normalizedInventory.normalized_exposed_surface_rows
      : [],
    normalized_tls_rows: Array.isArray(normalizedInventory.normalized_tls_rows)
      ? normalizedInventory.normalized_tls_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseJReadinessGate(args = {}) {
  const phaseJPlan =
    args.phaseJPlan && typeof args.phaseJPlan === "object" ? args.phaseJPlan : {};
  const phaseJGate =
    args.phaseJGate && typeof args.phaseJGate === "object" ? args.phaseJGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseJGate.blocking_reasons || [])];

  if (phaseJPlan.enabled !== true) {
    blockingReasons.push("phase_j_not_enabled");
  }

  const highRiskCount = Number(riskSummary.high_risk_count || 0);
  const mediumRiskCount = Number(riskSummary.medium_risk_count || 0);

  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_security_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_security_reconciliation"
      : "blocked_for_security_reconciliation",
    readiness_ready: readiness,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: Number(riskSummary.low_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseJSafeCandidates(args = {}) {
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
      security_header_candidates: [],
      waf_candidates: [],
      hardening_control_candidates: [],
      exposed_surface_candidates: [],
      tls_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_j_readiness_not_ready"]
    };
  }

  const normalizedSecurityHeaderRows = Array.isArray(
    normalizedInventory.normalized_security_header_rows
  )
    ? normalizedInventory.normalized_security_header_rows
    : [];
  const normalizedWafRows = Array.isArray(normalizedInventory.normalized_waf_rows)
    ? normalizedInventory.normalized_waf_rows
    : [];
  const normalizedHardeningControlRows = Array.isArray(
    normalizedInventory.normalized_hardening_control_rows
  )
    ? normalizedInventory.normalized_hardening_control_rows
    : [];
  const normalizedExposedSurfaceRows = Array.isArray(
    normalizedInventory.normalized_exposed_surface_rows
  )
    ? normalizedInventory.normalized_exposed_surface_rows
    : [];
  const normalizedTlsRows = Array.isArray(normalizedInventory.normalized_tls_rows)
    ? normalizedInventory.normalized_tls_rows
    : [];

  const securityHeaderCandidates = normalizedSecurityHeaderRows
    .filter(row => String(row?.security_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "security_header",
      header_key: String(row?.header_key || "").trim(),
      enabled: row?.enabled === true,
      header_value: String(row?.header_value || "").trim(),
      mode: String(row?.mode || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      candidate_reason: "non_high_risk_security_header_candidate"
    }));

  const wafCandidates = normalizedWafRows
    .filter(row => String(row?.security_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "waf_surface",
      waf_key: String(row?.waf_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      candidate_reason: "non_high_risk_waf_candidate"
    }));

  const hardeningControlCandidates = normalizedHardeningControlRows
    .filter(row => String(row?.security_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "hardening_control",
      control_key: String(row?.control_key || "").trim(),
      enabled: row?.enabled === true,
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      candidate_reason: "non_high_risk_hardening_control_candidate"
    }));

  const exposedSurfaceCandidates = normalizedExposedSurfaceRows
    .filter(row => String(row?.security_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "exposed_surface",
      surface_key: String(row?.surface_key || "").trim(),
      enabled: row?.enabled === true,
      exposure_type: String(row?.exposure_type || "").trim(),
      target_scope: String(row?.target_scope || row?.target || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      candidate_reason: "non_high_risk_exposed_surface_candidate"
    }));

  const tlsCandidates = normalizedTlsRows
    .filter(row => String(row?.security_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "tls_surface",
      tls_key: String(row?.tls_key || "").trim(),
      enabled: row?.enabled === true,
      protocol_mode: String(row?.protocol_mode || "").trim(),
      provider: String(row?.provider || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      candidate_reason: "non_high_risk_tls_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      securityHeaderCandidates.length +
      wafCandidates.length +
      hardeningControlCandidates.length +
      exposedSurfaceCandidates.length +
      tlsCandidates.length,
    security_header_candidates: securityHeaderCandidates,
    waf_candidates: wafCandidates,
    hardening_control_candidates: hardeningControlCandidates,
    exposed_surface_candidates: exposedSurfaceCandidates,
    tls_candidates: tlsCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseJReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_j_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    high_risk_count: Number(readiness.high_risk_count || 0),
    medium_risk_count: Number(readiness.medium_risk_count || 0),
    low_risk_count: Number(readiness.low_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    security_header_candidates: Array.isArray(safeCandidates.security_header_candidates)
      ? safeCandidates.security_header_candidates
      : [],
    waf_candidates: Array.isArray(safeCandidates.waf_candidates)
      ? safeCandidates.waf_candidates
      : [],
    hardening_control_candidates: Array.isArray(
      safeCandidates.hardening_control_candidates
    )
      ? safeCandidates.hardening_control_candidates
      : [],
    exposed_surface_candidates: Array.isArray(
      safeCandidates.exposed_surface_candidates
    )
      ? safeCandidates.exposed_surface_candidates
      : [],
    tls_candidates: Array.isArray(safeCandidates.tls_candidates)
      ? safeCandidates.tls_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressSecurityHeaderReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "security_header",
    header_key: String(row?.header_key || "").trim(),
    enabled: row?.enabled === true,
    header_value: String(row?.header_value || "").trim(),
    mode: String(row?.mode || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_mode: "safe_security_header_reconciliation_candidate",
    payload_shape: {
      header_key: String(row?.header_key || "").trim(),
      enabled: row?.enabled === true,
      header_value: String(row?.header_value || "").trim(),
      mode: String(row?.mode || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressSecuritySurfaceReconciliationPayloadRow(row = {}) {
  return {
    entity_type: String(row?.entity_type || "").trim(),
    waf_key: String(row?.waf_key || "").trim(),
    control_key: String(row?.control_key || "").trim(),
    surface_key: String(row?.surface_key || "").trim(),
    tls_key: String(row?.tls_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    exposure_type: String(row?.exposure_type || "").trim(),
    protocol_mode: String(row?.protocol_mode || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_mode: "safe_security_surface_reconciliation_candidate",
    payload_shape: {
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      exposure_type: String(row?.exposure_type || "").trim(),
      protocol_mode: String(row?.protocol_mode || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseJReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      security_header_payload_rows: [],
      waf_payload_rows: [],
      hardening_control_payload_rows: [],
      exposed_surface_payload_rows: [],
      tls_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_j_safe_candidates_not_ready"]
    };
  }

  const securityHeaderCandidates = Array.isArray(
    safeCandidates.security_header_candidates
  )
    ? safeCandidates.security_header_candidates
    : [];
  const wafCandidates = Array.isArray(safeCandidates.waf_candidates)
    ? safeCandidates.waf_candidates
    : [];
  const hardeningControlCandidates = Array.isArray(
    safeCandidates.hardening_control_candidates
  )
    ? safeCandidates.hardening_control_candidates
    : [];
  const exposedSurfaceCandidates = Array.isArray(
    safeCandidates.exposed_surface_candidates
  )
    ? safeCandidates.exposed_surface_candidates
    : [];
  const tlsCandidates = Array.isArray(safeCandidates.tls_candidates)
    ? safeCandidates.tls_candidates
    : [];

  const securityHeaderPayloadRows = securityHeaderCandidates.map(
    buildWordpressSecurityHeaderReconciliationPayloadRow
  );
  const wafPayloadRows = wafCandidates.map(
    buildWordpressSecuritySurfaceReconciliationPayloadRow
  );
  const hardeningControlPayloadRows = hardeningControlCandidates.map(
    buildWordpressSecuritySurfaceReconciliationPayloadRow
  );
  const exposedSurfacePayloadRows = exposedSurfaceCandidates.map(
    buildWordpressSecuritySurfaceReconciliationPayloadRow
  );
  const tlsPayloadRows = tlsCandidates.map(
    buildWordpressSecuritySurfaceReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      securityHeaderPayloadRows.length +
      wafPayloadRows.length +
      hardeningControlPayloadRows.length +
      exposedSurfacePayloadRows.length +
      tlsPayloadRows.length,
    security_header_payload_rows: securityHeaderPayloadRows,
    waf_payload_rows: wafPayloadRows,
    hardening_control_payload_rows: hardeningControlPayloadRows,
    exposed_surface_payload_rows: exposedSurfacePayloadRows,
    tls_payload_rows: tlsPayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseJReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_j_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    security_header_payload_rows: Array.isArray(planner.security_header_payload_rows)
      ? planner.security_header_payload_rows
      : [],
    waf_payload_rows: Array.isArray(planner.waf_payload_rows)
      ? planner.waf_payload_rows
      : [],
    hardening_control_payload_rows: Array.isArray(
      planner.hardening_control_payload_rows
    )
      ? planner.hardening_control_payload_rows
      : [],
    exposed_surface_payload_rows: Array.isArray(planner.exposed_surface_payload_rows)
      ? planner.exposed_surface_payload_rows
      : [],
    tls_payload_rows: Array.isArray(planner.tls_payload_rows)
      ? planner.tls_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseJExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const securityHardening =
    migration.security_hardening && typeof migration.security_hardening === "object"
      ? migration.security_hardening
      : {};
  const execution =
    securityHardening.execution && typeof securityHardening.execution === "object"
      ? securityHardening.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

export function buildWordpressPhaseJExecutionGuard(args = {}) {
  const phaseJPlan =
    args.phaseJPlan && typeof args.phaseJPlan === "object" ? args.phaseJPlan : {};
  const phaseJGate =
    args.phaseJGate && typeof args.phaseJGate === "object" ? args.phaseJGate : {};
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

  if (phaseJPlan.enabled !== true) {
    blockingReasons.push("phase_j_not_enabled");
  }
  if (phaseJGate.phase_j_gate_ready !== true) {
    blockingReasons.push("phase_j_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_j_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_j_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_j_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_j_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseJPlan.inventory_only === true && phaseJPlan.apply === true) {
    blockingReasons.push("phase_j_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_security_reconciliation_execution"
      : "blocked_before_security_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseJExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_j_execution_guard",
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

export function buildWordpressPhaseJMutationCandidateSelector(args = {}) {
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
      selected_security_header_candidates: [],
      selected_waf_candidates: [],
      selected_hardening_control_candidates: [],
      selected_exposed_surface_candidates: [],
      selected_tls_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_j_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_security_header_candidates: [],
      selected_waf_candidates: [],
      selected_hardening_control_candidates: [],
      selected_exposed_surface_candidates: [],
      selected_tls_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_j_payload_planner_not_ready"]
    };
  }

  const securityHeaderPayloadRows = Array.isArray(
    payloadPlanner.security_header_payload_rows
  )
    ? payloadPlanner.security_header_payload_rows
    : [];
  const wafPayloadRows = Array.isArray(payloadPlanner.waf_payload_rows)
    ? payloadPlanner.waf_payload_rows
    : [];
  const hardeningControlPayloadRows = Array.isArray(
    payloadPlanner.hardening_control_payload_rows
  )
    ? payloadPlanner.hardening_control_payload_rows
    : [];
  const exposedSurfacePayloadRows = Array.isArray(
    payloadPlanner.exposed_surface_payload_rows
  )
    ? payloadPlanner.exposed_surface_payload_rows
    : [];
  const tlsPayloadRows = Array.isArray(payloadPlanner.tls_payload_rows)
    ? payloadPlanner.tls_payload_rows
    : [];

  const selectedSecurityHeaderCandidates = [];
  const selectedWafCandidates = [];
  const selectedHardeningControlCandidates = [];
  const selectedExposedSurfaceCandidates = [];
  const selectedTlsCandidates = [];
  const rejectedCandidates = [];

  for (const row of securityHeaderPayloadRows) {
    const riskClass = String(row?.security_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "security_header",
        header_key: String(row?.header_key || "").trim(),
        rejection_reason: "high_risk_security_header_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_security_header_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "security_header",
        header_key: String(row?.header_key || "").trim(),
        rejection_reason: "unsupported_security_header_payload_mode"
      });
      continue;
    }

    selectedSecurityHeaderCandidates.push({
      ...row,
      candidate_reason: "safe_security_header_candidate_ready_for_mutation"
    });
  }

  for (const row of wafPayloadRows) {
    const riskClass = String(row?.security_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "waf_surface",
        waf_key: String(row?.waf_key || "").trim(),
        rejection_reason: "high_risk_waf_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_security_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "waf_surface",
        waf_key: String(row?.waf_key || "").trim(),
        rejection_reason: "unsupported_waf_payload_mode"
      });
      continue;
    }

    selectedWafCandidates.push({
      ...row,
      candidate_reason: "safe_waf_candidate_ready_for_mutation"
    });
  }

  for (const row of hardeningControlPayloadRows) {
    const riskClass = String(row?.security_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "hardening_control",
        control_key: String(row?.control_key || "").trim(),
        rejection_reason: "high_risk_hardening_control_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_security_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "hardening_control",
        control_key: String(row?.control_key || "").trim(),
        rejection_reason: "unsupported_hardening_control_payload_mode"
      });
      continue;
    }

    selectedHardeningControlCandidates.push({
      ...row,
      candidate_reason: "safe_hardening_control_candidate_ready_for_mutation"
    });
  }

  for (const row of exposedSurfacePayloadRows) {
    const riskClass = String(row?.security_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "exposed_surface",
        surface_key: String(row?.surface_key || "").trim(),
        rejection_reason: "high_risk_exposed_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_security_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "exposed_surface",
        surface_key: String(row?.surface_key || "").trim(),
        rejection_reason: "unsupported_exposed_surface_payload_mode"
      });
      continue;
    }

    selectedExposedSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_exposed_surface_candidate_ready_for_mutation"
    });
  }

  for (const row of tlsPayloadRows) {
    const riskClass = String(row?.security_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "tls_surface",
        tls_key: String(row?.tls_key || "").trim(),
        rejection_reason: "high_risk_tls_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_security_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "tls_surface",
        tls_key: String(row?.tls_key || "").trim(),
        rejection_reason: "unsupported_tls_payload_mode"
      });
      continue;
    }

    selectedTlsCandidates.push({
      ...row,
      candidate_reason: "safe_tls_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedSecurityHeaderCandidates =
    selectedSecurityHeaderCandidates.slice(0, candidateLimit);
  const limitedSelectedWafCandidates = selectedWafCandidates.slice(0, candidateLimit);
  const limitedSelectedHardeningControlCandidates =
    selectedHardeningControlCandidates.slice(0, candidateLimit);
  const limitedSelectedExposedSurfaceCandidates =
    selectedExposedSurfaceCandidates.slice(0, candidateLimit);
  const limitedSelectedTlsCandidates = selectedTlsCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedSecurityHeaderCandidates.length +
      limitedSelectedWafCandidates.length +
      limitedSelectedHardeningControlCandidates.length +
      limitedSelectedExposedSurfaceCandidates.length +
      limitedSelectedTlsCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_security_header_candidates: limitedSelectedSecurityHeaderCandidates,
    selected_waf_candidates: limitedSelectedWafCandidates,
    selected_hardening_control_candidates:
      limitedSelectedHardeningControlCandidates,
    selected_exposed_surface_candidates: limitedSelectedExposedSurfaceCandidates,
    selected_tls_candidates: limitedSelectedTlsCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseJMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_j_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_security_header_candidates: Array.isArray(
      selector.selected_security_header_candidates
    )
      ? selector.selected_security_header_candidates
      : [],
    selected_waf_candidates: Array.isArray(selector.selected_waf_candidates)
      ? selector.selected_waf_candidates
      : [],
    selected_hardening_control_candidates: Array.isArray(
      selector.selected_hardening_control_candidates
    )
      ? selector.selected_hardening_control_candidates
      : [],
    selected_exposed_surface_candidates: Array.isArray(
      selector.selected_exposed_surface_candidates
    )
      ? selector.selected_exposed_surface_candidates
      : [],
    selected_tls_candidates: Array.isArray(selector.selected_tls_candidates)
      ? selector.selected_tls_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressSecurityHeaderMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_security_header_reconciliation",
    target_scope: "destination_wordpress_security_header",
    payload: {
      header_key: Object.prototype.hasOwnProperty.call(payloadShape, "header_key")
        ? payloadShape.header_key
        : String(row?.header_key || "").trim(),
      enabled: Object.prototype.hasOwnProperty.call(payloadShape, "enabled")
        ? payloadShape.enabled === true
        : row?.enabled === true,
      header_value: Object.prototype.hasOwnProperty.call(payloadShape, "header_value")
        ? payloadShape.header_value
        : String(row?.header_value || "").trim(),
      mode: Object.prototype.hasOwnProperty.call(payloadShape, "mode")
        ? payloadShape.mode
        : String(row?.mode || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressSecuritySurfaceMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_security_surface_reconciliation",
    target_scope: "destination_wordpress_security_surface",
    payload: {
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
      exposure_type: Object.prototype.hasOwnProperty.call(payloadShape, "exposure_type")
        ? payloadShape.exposure_type
        : String(row?.exposure_type || "").trim(),
      protocol_mode: Object.prototype.hasOwnProperty.call(payloadShape, "protocol_mode")
        ? payloadShape.protocol_mode
        : String(row?.protocol_mode || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseJMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      security_header_composed_payloads: [],
      waf_composed_payloads: [],
      hardening_control_composed_payloads: [],
      exposed_surface_composed_payloads: [],
      tls_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_j_mutation_candidates_not_ready"]
    };
  }

  const selectedSecurityHeaderCandidates = Array.isArray(
    selector.selected_security_header_candidates
  )
    ? selector.selected_security_header_candidates
    : [];
  const selectedWafCandidates = Array.isArray(selector.selected_waf_candidates)
    ? selector.selected_waf_candidates
    : [];
  const selectedHardeningControlCandidates = Array.isArray(
    selector.selected_hardening_control_candidates
  )
    ? selector.selected_hardening_control_candidates
    : [];
  const selectedExposedSurfaceCandidates = Array.isArray(
    selector.selected_exposed_surface_candidates
  )
    ? selector.selected_exposed_surface_candidates
    : [];
  const selectedTlsCandidates = Array.isArray(selector.selected_tls_candidates)
    ? selector.selected_tls_candidates
    : [];

  const securityHeaderComposedPayloads = selectedSecurityHeaderCandidates.map(row => ({
    entity_type: "security_header",
    header_key: String(row?.header_key || "").trim(),
    enabled: row?.enabled === true,
    header_value: String(row?.header_value || "").trim(),
    mode: String(row?.mode || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_reason: "composed_from_safe_security_header_candidate",
    mutation_payload: buildWordpressSecurityHeaderMutationPayloadFromCandidate(row)
  }));

  const wafComposedPayloads = selectedWafCandidates.map(row => ({
    entity_type: "waf_surface",
    waf_key: String(row?.waf_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_reason: "composed_from_safe_waf_candidate",
    mutation_payload: buildWordpressSecuritySurfaceMutationPayloadFromCandidate(row)
  }));

  const hardeningControlComposedPayloads = selectedHardeningControlCandidates.map(
    row => ({
      entity_type: "hardening_control",
      control_key: String(row?.control_key || "").trim(),
      enabled: row?.enabled === true,
      mode: String(row?.mode || "").trim(),
      target_scope: String(row?.target_scope || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      payload_reason: "composed_from_safe_hardening_control_candidate",
      mutation_payload: buildWordpressSecuritySurfaceMutationPayloadFromCandidate(row)
    })
  );

  const exposedSurfaceComposedPayloads = selectedExposedSurfaceCandidates.map(row => ({
    entity_type: "exposed_surface",
    surface_key: String(row?.surface_key || "").trim(),
    enabled: row?.enabled === true,
    exposure_type: String(row?.exposure_type || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_reason: "composed_from_safe_exposed_surface_candidate",
    mutation_payload: buildWordpressSecuritySurfaceMutationPayloadFromCandidate(row)
  }));

  const tlsComposedPayloads = selectedTlsCandidates.map(row => ({
    entity_type: "tls_surface",
    tls_key: String(row?.tls_key || "").trim(),
    enabled: row?.enabled === true,
    protocol_mode: String(row?.protocol_mode || "").trim(),
    provider: String(row?.provider || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    payload_reason: "composed_from_safe_tls_candidate",
    mutation_payload: buildWordpressSecuritySurfaceMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      securityHeaderComposedPayloads.length +
      wafComposedPayloads.length +
      hardeningControlComposedPayloads.length +
      exposedSurfaceComposedPayloads.length +
      tlsComposedPayloads.length,
    security_header_composed_payloads: securityHeaderComposedPayloads,
    waf_composed_payloads: wafComposedPayloads,
    hardening_control_composed_payloads: hardeningControlComposedPayloads,
    exposed_surface_composed_payloads: exposedSurfaceComposedPayloads,
    tls_composed_payloads: tlsComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseJMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_j_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    security_header_composed_payloads: Array.isArray(
      composer.security_header_composed_payloads
    )
      ? composer.security_header_composed_payloads
      : [],
    waf_composed_payloads: Array.isArray(composer.waf_composed_payloads)
      ? composer.waf_composed_payloads
      : [],
    hardening_control_composed_payloads: Array.isArray(
      composer.hardening_control_composed_payloads
    )
      ? composer.hardening_control_composed_payloads
      : [],
    exposed_surface_composed_payloads: Array.isArray(
      composer.exposed_surface_composed_payloads
    )
      ? composer.exposed_surface_composed_payloads
      : [],
    tls_composed_payloads: Array.isArray(composer.tls_composed_payloads)
      ? composer.tls_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressSecurityDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "security_header") {
    return {
      entity_type: "security_header",
      header_key: String(row?.header_key || "").trim(),
      enabled: row?.enabled === true,
      header_value: String(row?.header_value || "").trim(),
      mode: String(row?.mode || "").trim(),
      security_risk_class: String(row?.security_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_header_key: String(payload.header_key || "").trim(),
        expected_enabled: payload?.enabled === true ? "true" : "false",
        expected_header_value: String(payload.header_value || "").trim(),
        expected_mode: String(payload.mode || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: entityType,
    waf_key: String(row?.waf_key || "").trim(),
    control_key: String(row?.control_key || "").trim(),
    surface_key: String(row?.surface_key || "").trim(),
    tls_key: String(row?.tls_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    mode: String(row?.mode || "").trim(),
    target_scope: String(row?.target_scope || "").trim(),
    exposure_type: String(row?.exposure_type || "").trim(),
    protocol_mode: String(row?.protocol_mode || "").trim(),
    security_risk_class: String(row?.security_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_enabled: payload?.enabled === true ? "true" : "false",
      expected_provider: String(payload.provider || "").trim(),
      expected_mode: String(payload.mode || "").trim(),
      expected_target_scope: String(payload.target_scope || "").trim(),
      expected_exposure_type: String(payload.exposure_type || "").trim(),
      expected_protocol_mode: String(payload.protocol_mode || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseJDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_security_header_rows: [],
      simulated_waf_rows: [],
      simulated_hardening_control_rows: [],
      simulated_exposed_surface_rows: [],
      simulated_tls_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        security_header_rows: 0,
        waf_rows: 0,
        hardening_control_rows: 0,
        exposed_surface_rows: 0,
        tls_rows: 0,
        preserve_from_source_count: 0,
        enabled_true_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_j_mutation_payloads_not_ready"]
    };
  }

  const securityHeaderRows = Array.isArray(composer.security_header_composed_payloads)
    ? composer.security_header_composed_payloads
    : [];
  const wafRows = Array.isArray(composer.waf_composed_payloads)
    ? composer.waf_composed_payloads
    : [];
  const hardeningControlRows = Array.isArray(
    composer.hardening_control_composed_payloads
  )
    ? composer.hardening_control_composed_payloads
    : [];
  const exposedSurfaceRows = Array.isArray(composer.exposed_surface_composed_payloads)
    ? composer.exposed_surface_composed_payloads
    : [];
  const tlsRows = Array.isArray(composer.tls_composed_payloads)
    ? composer.tls_composed_payloads
    : [];

  const simulatedSecurityHeaderRows = securityHeaderRows.map(
    simulateWordpressSecurityDryRunRow
  );
  const simulatedWafRows = wafRows.map(simulateWordpressSecurityDryRunRow);
  const simulatedHardeningControlRows = hardeningControlRows.map(
    simulateWordpressSecurityDryRunRow
  );
  const simulatedExposedSurfaceRows = exposedSurfaceRows.map(
    simulateWordpressSecurityDryRunRow
  );
  const simulatedTlsRows = tlsRows.map(simulateWordpressSecurityDryRunRow);

  const allRows = [
    ...simulatedSecurityHeaderRows,
    ...simulatedWafRows,
    ...simulatedHardeningControlRows,
    ...simulatedExposedSurfaceRows,
    ...simulatedTlsRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "security_header") acc.security_header_rows += 1;
      else if (entityType === "waf_surface") acc.waf_rows += 1;
      else if (entityType === "hardening_control") acc.hardening_control_rows += 1;
      else if (entityType === "exposed_surface") acc.exposed_surface_rows += 1;
      else if (entityType === "tls_surface") acc.tls_rows += 1;

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
      security_header_rows: 0,
      waf_rows: 0,
      hardening_control_rows: 0,
      exposed_surface_rows: 0,
      tls_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_security_header_rows: simulatedSecurityHeaderRows,
    simulated_waf_rows: simulatedWafRows,
    simulated_hardening_control_rows: simulatedHardeningControlRows,
    simulated_exposed_surface_rows: simulatedExposedSurfaceRows,
    simulated_tls_rows: simulatedTlsRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseJDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_j_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_security_header_rows: Array.isArray(
      simulator.simulated_security_header_rows
    )
      ? simulator.simulated_security_header_rows
      : [],
    simulated_waf_rows: Array.isArray(simulator.simulated_waf_rows)
      ? simulator.simulated_waf_rows
      : [],
    simulated_hardening_control_rows: Array.isArray(
      simulator.simulated_hardening_control_rows
    )
      ? simulator.simulated_hardening_control_rows
      : [],
    simulated_exposed_surface_rows: Array.isArray(
      simulator.simulated_exposed_surface_rows
    )
      ? simulator.simulated_exposed_surface_rows
      : [],
    simulated_tls_rows: Array.isArray(simulator.simulated_tls_rows)
      ? simulator.simulated_tls_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            security_header_rows: 0,
            waf_rows: 0,
            hardening_control_rows: 0,
            exposed_surface_rows: 0,
            tls_rows: 0,
            preserve_from_source_count: 0,
            enabled_true_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseJFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseJPlan =
    args.phaseJPlan && typeof args.phaseJPlan === "object" ? args.phaseJPlan : {};
  const phaseJGate =
    args.phaseJGate && typeof args.phaseJGate === "object" ? args.phaseJGate : {};
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
    artifact_type: "wordpress_phase_j_final_operator_handoff",
    artifact_version: "v1",
    phase_j_enabled: phaseJPlan.enabled === true,
    phase_j_inventory_only: phaseJPlan.inventory_only === true,
    phase_j_apply_requested: phaseJPlan.apply === true,
    requested_security_scope: {
      include_security_headers: phaseJPlan.include_security_headers === true,
      include_waf_surface: phaseJPlan.include_waf_surface === true,
      include_hardening_controls: phaseJPlan.include_hardening_controls === true,
      include_exposed_surfaces: phaseJPlan.include_exposed_surfaces === true,
      include_tls_surface: phaseJPlan.include_tls_surface === true,
      max_items: Number(phaseJPlan.max_items || 0)
    },
    requested_security_config:
      migration?.security_hardening &&
      typeof migration.security_hardening === "object"
        ? migration.security_hardening
        : {},
    phase_j_gate_status: String(phaseJGate.phase_j_gate_status || "").trim(),
    phase_j_inventory_status: String(inventoryArtifact.phase_j_inventory_status || "").trim(),
    phase_j_strategy_status: String(
      normalizedInventoryArtifact.phase_j_gate_status || ""
    ).trim(),
    phase_j_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_j_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_j_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_j_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_j_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_j_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_j_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            security_header_count: 0,
            waf_count: 0,
            hardening_control_count: 0,
            exposed_surface_count: 0,
            tls_count: 0
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
            security_header_count: 0,
            waf_count: 0,
            hardening_control_count: 0,
            exposed_surface_count: 0,
            tls_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseJGate.blocking_reasons) ? phaseJGate.blocking_reasons : []),
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
        ? "review_safe_security_candidates"
        : "resolve_security_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_security_reconciliation_execution"
        ? "approve_security_mutation_trial"
        : "hold_security_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_security_dry_run_preview"
        : "no_security_dry_run_preview_available"
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