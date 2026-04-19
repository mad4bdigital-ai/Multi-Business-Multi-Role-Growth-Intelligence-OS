// Phase K — Observability / Logs / Alerts / Monitoring surfaces
import {
  toPositiveInt
} from "./shared.js";
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  MAX_TIMEOUT_SECONDS
} from "../config.js";

export function resolveWordpressPhaseKPlan(payload = {}) {
  const migration = payload?.migration || {};
  const observability =
    migration.observability_monitoring &&
    typeof migration.observability_monitoring === "object"
      ? migration.observability_monitoring
      : {};

  return {
    enabled: observability.enabled === true,
    inventory_only:
      observability.inventory_only === undefined
        ? true
        : observability.inventory_only === true,
    apply: observability.apply === true,
    include_logging_surfaces:
      observability.include_logging_surfaces === undefined
        ? true
        : observability.include_logging_surfaces === true,
    include_alerting_surfaces:
      observability.include_alerting_surfaces === undefined
        ? true
        : observability.include_alerting_surfaces === true,
    include_monitoring_surfaces:
      observability.include_monitoring_surfaces === undefined
        ? true
        : observability.include_monitoring_surfaces === true,
    include_error_tracking:
      observability.include_error_tracking === undefined
        ? true
        : observability.include_error_tracking === true,
    include_uptime_surfaces:
      observability.include_uptime_surfaces === undefined
        ? true
        : observability.include_uptime_surfaces === true,
    max_items: Math.max(1, toPositiveInt(observability.max_items, 500))
  };
}

export function assertWordpressPhaseKPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_k_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_k_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_logging_surfaces !== true &&
    plan.include_alerting_surfaces !== true &&
    plan.include_monitoring_surfaces !== true &&
    plan.include_error_tracking !== true &&
    plan.include_uptime_surfaces !== true
  ) {
    blockingReasons.push("phase_k_no_inventory_scope_selected");
  }

  return {
    phase_k_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_k_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseKGate(args = {}) {
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
  const phaseJFinalOperatorHandoffBundle =
    args.phaseJFinalOperatorHandoffBundle &&
    typeof args.phaseJFinalOperatorHandoffBundle === "object"
      ? args.phaseJFinalOperatorHandoffBundle
      : {};
  const phaseKPlan =
    args.phaseKPlan && typeof args.phaseKPlan === "object" ? args.phaseKPlan : {};
  const phaseKPlanStatus =
    args.phaseKPlanStatus && typeof args.phaseKPlanStatus === "object"
      ? args.phaseKPlanStatus
      : {};

  const blockingReasons = [...(phaseKPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_k");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseFFinalOperatorHandoffBundle.phase_f_enabled === true &&
    String(phaseFFinalOperatorHandoffBundle.phase_f_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_f_users_roles_auth_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseGFinalOperatorHandoffBundle.phase_g_enabled === true &&
    String(phaseGFinalOperatorHandoffBundle.phase_g_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_g_seo_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseHFinalOperatorHandoffBundle.phase_h_enabled === true &&
    String(phaseHFinalOperatorHandoffBundle.phase_h_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_h_analytics_tracking_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseIFinalOperatorHandoffBundle.phase_i_enabled === true &&
    String(phaseIFinalOperatorHandoffBundle.phase_i_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_i_performance_stage_blocked");
  }

  if (
    phaseKPlan.enabled === true &&
    phaseJFinalOperatorHandoffBundle.phase_j_enabled === true &&
    String(phaseJFinalOperatorHandoffBundle.phase_j_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_j_security_stage_blocked");
  }

  return {
    phase_k_gate_status:
      blockingReasons.length === 0
        ? "ready_for_observability_monitoring_inventory"
        : "blocked",
    phase_k_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseKPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressObservabilityPluginSignals(siteProfile = {}) {
  const activePluginsRaw = siteProfile?.active_plugins;
  const activePlugins = Array.isArray(activePluginsRaw)
    ? activePluginsRaw
    : typeof activePluginsRaw === "string"
    ? activePluginsRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const normalized = activePlugins.map(x => String(x || "").trim().toLowerCase());

  return {
    has_query_monitor: normalized.some(x => x.includes("query-monitor")),
    has_wp_activity_log: normalized.some(
      x => x.includes("wp-security-audit-log") || x.includes("activity-log")
    ),
    has_sentry_plugin: normalized.some(x => x.includes("sentry")),
    has_new_relic_plugin: normalized.some(x => x.includes("new-relic")),
    has_updraft_or_logs_plugin: normalized.some(
      x => x.includes("stream") || x.includes("error-log-monitor")
    ),
    has_uptime_plugin: normalized.some(
      x => x.includes("uptime-monitor") || x.includes("site-status")
    )
  };
}

export function buildWordpressLoggingSurfaceRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const logging =
    siteProfile?.observability_surfaces &&
    typeof siteProfile.observability_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces) &&
    siteProfile.observability_surfaces.logging_surfaces &&
    typeof siteProfile.observability_surfaces.logging_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces.logging_surfaces)
      ? siteProfile.observability_surfaces.logging_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(logging).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "logging_surface",
      logging_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      retention_mode: String(value.retention_mode || "").trim(),
      destination: String(value.destination || "").trim(),
      inventory_classification: "logging_surface"
    });
  }

  return rows;
}

export function buildWordpressAlertingSurfaceRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const alerting =
    siteProfile?.observability_surfaces &&
    typeof siteProfile.observability_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces) &&
    siteProfile.observability_surfaces.alerting_surfaces &&
    typeof siteProfile.observability_surfaces.alerting_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces.alerting_surfaces)
      ? siteProfile.observability_surfaces.alerting_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(alerting).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "alerting_surface",
      alert_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      channel: String(value.channel || "").trim(),
      severity_mode: String(value.severity_mode || "").trim(),
      inventory_classification: "alerting_surface"
    });
  }

  return rows;
}

export function buildWordpressMonitoringSurfaceRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const monitoring =
    siteProfile?.observability_surfaces &&
    typeof siteProfile.observability_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces) &&
    siteProfile.observability_surfaces.monitoring_surfaces &&
    typeof siteProfile.observability_surfaces.monitoring_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces.monitoring_surfaces)
      ? siteProfile.observability_surfaces.monitoring_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(monitoring).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "monitoring_surface",
      monitor_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      monitor_mode: String(value.monitor_mode || "").trim(),
      inventory_classification: "monitoring_surface"
    });
  }

  return rows;
}

export function buildWordpressErrorTrackingRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const errorTracking =
    siteProfile?.observability_surfaces &&
    typeof siteProfile.observability_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces) &&
    siteProfile.observability_surfaces.error_tracking &&
    typeof siteProfile.observability_surfaces.error_tracking === "object" &&
    !Array.isArray(siteProfile.observability_surfaces.error_tracking)
      ? siteProfile.observability_surfaces.error_tracking
      : {};

  for (const [key, valueRaw] of Object.entries(errorTracking).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "error_tracking_surface",
      error_tracking_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      environment_mode: String(value.environment_mode || "").trim(),
      inventory_classification: "error_tracking_surface"
    });
  }

  return rows;
}

export function buildWordpressUptimeSurfaceRows(siteProfile = {}, limit = 500) {
  const rows = [];
  const uptime =
    siteProfile?.observability_surfaces &&
    typeof siteProfile.observability_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces) &&
    siteProfile.observability_surfaces.uptime_surfaces &&
    typeof siteProfile.observability_surfaces.uptime_surfaces === "object" &&
    !Array.isArray(siteProfile.observability_surfaces.uptime_surfaces)
      ? siteProfile.observability_surfaces.uptime_surfaces
      : {};

  for (const [key, valueRaw] of Object.entries(uptime).slice(0, limit)) {
    const value =
      valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw)
        ? valueRaw
        : {};

    rows.push({
      entity_type: "uptime_surface",
      uptime_key: String(key || "").trim(),
      enabled:
        value.enabled === true ||
        String(value.enabled || "").trim().toLowerCase() === "true",
      provider: String(value.provider || "").trim(),
      check_mode: String(value.check_mode || "").trim(),
      inventory_classification: "uptime_surface"
    });
  }

  return rows;
}

export async function runWordpressObservabilityMonitoringInventory(args = {}) {
  const {
    wpContext = {},
    phaseKPlan = {},
    phaseKGate = {}
  } = args;

  if (phaseKGate.phase_k_gate_ready !== true) {
    return {
      phase_k_inventory_status: "blocked",
      plugin_signals: {},
      logging_surface_rows: [],
      alerting_surface_rows: [],
      monitoring_surface_rows: [],
      error_tracking_rows: [],
      uptime_surface_rows: [],
      summary: {
        logging_surface_count: 0,
        alerting_surface_count: 0,
        monitoring_surface_count: 0,
        error_tracking_count: 0,
        uptime_surface_count: 0
      },
      failures: [
        {
          code: "phase_k_observability_inventory_blocked",
          message:
            "Phase K observability/logs/alerts inventory blocked by phase_k_gate.",
          blocking_reasons: phaseKGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];

  try {
    const pluginSignals = inferWordpressObservabilityPluginSignals(sourceProfile);
    const loggingSurfaceRows =
      phaseKPlan.include_logging_surfaces === true
        ? buildWordpressLoggingSurfaceRows(sourceProfile, phaseKPlan.max_items)
        : [];
    const alertingSurfaceRows =
      phaseKPlan.include_alerting_surfaces === true
        ? buildWordpressAlertingSurfaceRows(sourceProfile, phaseKPlan.max_items)
        : [];
    const monitoringSurfaceRows =
      phaseKPlan.include_monitoring_surfaces === true
        ? buildWordpressMonitoringSurfaceRows(sourceProfile, phaseKPlan.max_items)
        : [];
    const errorTrackingRows =
      phaseKPlan.include_error_tracking === true
        ? buildWordpressErrorTrackingRows(sourceProfile, phaseKPlan.max_items)
        : [];
    const uptimeSurfaceRows =
      phaseKPlan.include_uptime_surfaces === true
        ? buildWordpressUptimeSurfaceRows(sourceProfile, phaseKPlan.max_items)
        : [];

    return {
      phase_k_inventory_status: "completed",
      plugin_signals: pluginSignals,
      logging_surface_rows: loggingSurfaceRows,
      alerting_surface_rows: alertingSurfaceRows,
      monitoring_surface_rows: monitoringSurfaceRows,
      error_tracking_rows: errorTrackingRows,
      uptime_surface_rows: uptimeSurfaceRows,
      summary: {
        logging_surface_count: loggingSurfaceRows.length,
        alerting_surface_count: alertingSurfaceRows.length,
        monitoring_surface_count: monitoringSurfaceRows.length,
        error_tracking_count: errorTrackingRows.length,
        uptime_surface_count: uptimeSurfaceRows.length
      },
      failures
    };
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_observability_inventory_failed",
      message: err?.message || "WordPress observability/monitoring inventory failed."
    });

    return {
      phase_k_inventory_status: "completed_with_failures",
      plugin_signals: {},
      logging_surface_rows: [],
      alerting_surface_rows: [],
      monitoring_surface_rows: [],
      error_tracking_rows: [],
      uptime_surface_rows: [],
      summary: {
        logging_surface_count: 0,
        alerting_surface_count: 0,
        monitoring_surface_count: 0,
        error_tracking_count: 0,
        uptime_surface_count: 0
      },
      failures
    };
  }
}

export function buildWordpressPhaseKInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_k_observability_inventory",
    artifact_version: "v1",
    phase_k_gate_status: String(gate.phase_k_gate_status || "").trim(),
    phase_k_inventory_status: String(inventory.phase_k_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    plugin_signals:
      inventory?.plugin_signals && typeof inventory.plugin_signals === "object"
        ? inventory.plugin_signals
        : {},
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            logging_surface_count: 0,
            alerting_surface_count: 0,
            monitoring_surface_count: 0,
            error_tracking_count: 0,
            uptime_surface_count: 0
          },
    logging_surface_rows: Array.isArray(inventory.logging_surface_rows)
      ? inventory.logging_surface_rows
      : [],
    alerting_surface_rows: Array.isArray(inventory.alerting_surface_rows)
      ? inventory.alerting_surface_rows
      : [],
    monitoring_surface_rows: Array.isArray(inventory.monitoring_surface_rows)
      ? inventory.monitoring_surface_rows
      : [],
    error_tracking_rows: Array.isArray(inventory.error_tracking_rows)
      ? inventory.error_tracking_rows
      : [],
    uptime_surface_rows: Array.isArray(inventory.uptime_surface_rows)
      ? inventory.uptime_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressObservabilityTextValue(value = "") {
  return String(value ?? "").trim();
}

export function classifyWordpressLoggingSurfaceRisk(row = {}) {
  const loggingKey = normalizeWordpressObservabilityTextValue(row?.logging_key);
  const enabled = row?.enabled === true;
  const provider = normalizeWordpressObservabilityTextValue(row?.provider);
  const retentionMode = normalizeWordpressObservabilityTextValue(row?.retention_mode);
  const destination = normalizeWordpressObservabilityTextValue(row?.destination);

  let riskScore = 0;
  const reasons = [];

  if (!enabled) {
    riskScore += 2;
    reasons.push("logging_surface_disabled");
  }
  if (!provider) {
    riskScore += 1;
    reasons.push("missing_logging_provider");
  }
  if (!retentionMode) {
    riskScore += 1;
    reasons.push("missing_retention_mode");
  }
  if (!destination) {
    riskScore += 1;
    reasons.push("missing_log_destination");
  }
  if (loggingKey === "application_logs" && !enabled) {
    riskScore += 2;
    reasons.push("application_logging_not_enabled");
  }

  let observability_risk_class = "low";
  if (riskScore >= 4) observability_risk_class = "high";
  else if (riskScore >= 2) observability_risk_class = "medium";

  return {
    logging_key: loggingKey,
    enabled,
    provider,
    retention_mode: retentionMode,
    destination,
    observability_risk_score: riskScore,
    observability_risk_class,
    observability_risk_reasons: reasons
  };
}

export function classifyWordpressObservabilitySurfaceRisk(row = {}) {
  const entityType = normalizeWordpressObservabilityTextValue(row?.entity_type);
  const enabled = row?.enabled === true;
  const provider = normalizeWordpressObservabilityTextValue(row?.provider);
  const channel = normalizeWordpressObservabilityTextValue(row?.channel);
  const severityMode = normalizeWordpressObservabilityTextValue(row?.severity_mode);
  const monitorMode = normalizeWordpressObservabilityTextValue(row?.monitor_mode);
  const environmentMode = normalizeWordpressObservabilityTextValue(
    row?.environment_mode
  );
  const checkMode = normalizeWordpressObservabilityTextValue(row?.check_mode);

  let riskScore = 0;
  const reasons = [];

  if (!enabled) {
    riskScore += 1;
    reasons.push("observability_surface_disabled");
  }

  if (entityType === "alerting_surface") {
    if (!channel) {
      riskScore += 2;
      reasons.push("missing_alert_channel");
    }
    if (!severityMode) {
      riskScore += 1;
      reasons.push("missing_alert_severity_mode");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("alerting_not_enabled");
    }
  }

  if (entityType === "monitoring_surface") {
    if (!provider) {
      riskScore += 1;
      reasons.push("missing_monitoring_provider");
    }
    if (!monitorMode) {
      riskScore += 1;
      reasons.push("missing_monitor_mode");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("monitoring_not_enabled");
    }
  }

  if (entityType === "error_tracking_surface") {
    if (!provider) {
      riskScore += 2;
      reasons.push("missing_error_tracking_provider");
    }
    if (!environmentMode) {
      riskScore += 1;
      reasons.push("missing_error_tracking_environment_mode");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("error_tracking_not_enabled");
    }
  }

  if (entityType === "uptime_surface") {
    if (!provider) {
      riskScore += 1;
      reasons.push("missing_uptime_provider");
    }
    if (!checkMode) {
      riskScore += 1;
      reasons.push("missing_uptime_check_mode");
    }
    if (!enabled) {
      riskScore += 2;
      reasons.push("uptime_not_enabled");
    }
  }

  let observability_risk_class = "low";
  if (riskScore >= 4) observability_risk_class = "high";
  else if (riskScore >= 2) observability_risk_class = "medium";

  return {
    enabled,
    provider,
    channel,
    severity_mode: severityMode,
    monitor_mode: monitorMode,
    environment_mode: environmentMode,
    check_mode: checkMode,
    observability_risk_score: riskScore,
    observability_risk_class,
    observability_risk_reasons: reasons
  };
}

export function buildWordpressPhaseKNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const loggingSurfaceRows = Array.isArray(inventory.logging_surface_rows)
    ? inventory.logging_surface_rows
    : [];
  const alertingSurfaceRows = Array.isArray(inventory.alerting_surface_rows)
    ? inventory.alerting_surface_rows
    : [];
  const monitoringSurfaceRows = Array.isArray(inventory.monitoring_surface_rows)
    ? inventory.monitoring_surface_rows
    : [];
  const errorTrackingRows = Array.isArray(inventory.error_tracking_rows)
    ? inventory.error_tracking_rows
    : [];
  const uptimeSurfaceRows = Array.isArray(inventory.uptime_surface_rows)
    ? inventory.uptime_surface_rows
    : [];

  const normalizedLoggingSurfaceRows = loggingSurfaceRows.map(row => {
    const risk = classifyWordpressLoggingSurfaceRisk(row);
    return {
      ...row,
      logging_key: risk.logging_key,
      enabled: risk.enabled,
      provider: risk.provider,
      retention_mode: risk.retention_mode,
      destination: risk.destination,
      observability_risk_score: risk.observability_risk_score,
      observability_risk_class: risk.observability_risk_class,
      observability_risk_reasons: risk.observability_risk_reasons
    };
  });

  const normalizeSurfaceLikeRow = row => {
    const risk = classifyWordpressObservabilitySurfaceRisk(row);
    return {
      ...row,
      enabled: risk.enabled,
      provider: risk.provider,
      channel: risk.channel,
      severity_mode: risk.severity_mode,
      monitor_mode: risk.monitor_mode,
      environment_mode: risk.environment_mode,
      check_mode: risk.check_mode,
      observability_risk_score: risk.observability_risk_score,
      observability_risk_class: risk.observability_risk_class,
      observability_risk_reasons: risk.observability_risk_reasons
    };
  };

  const normalizedAlertingSurfaceRows = alertingSurfaceRows.map(normalizeSurfaceLikeRow);
  const normalizedMonitoringSurfaceRows = monitoringSurfaceRows.map(normalizeSurfaceLikeRow);
  const normalizedErrorTrackingRows = errorTrackingRows.map(normalizeSurfaceLikeRow);
  const normalizedUptimeSurfaceRows = uptimeSurfaceRows.map(normalizeSurfaceLikeRow);

  const allRows = [
    ...normalizedLoggingSurfaceRows,
    ...normalizedAlertingSurfaceRows,
    ...normalizedMonitoringSurfaceRows,
    ...normalizedErrorTrackingRows,
    ...normalizedUptimeSurfaceRows
  ];

  const riskSummary = allRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const riskClass = String(row?.observability_risk_class || "").trim();
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "logging_surface") acc.logging_surface_count += 1;
      else if (entityType === "alerting_surface") acc.alerting_surface_count += 1;
      else if (entityType === "monitoring_surface") acc.monitoring_surface_count += 1;
      else if (entityType === "error_tracking_surface") acc.error_tracking_count += 1;
      else if (entityType === "uptime_surface") acc.uptime_surface_count += 1;

      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      logging_surface_count: 0,
      alerting_surface_count: 0,
      monitoring_surface_count: 0,
      error_tracking_count: 0,
      uptime_surface_count: 0
    }
  );

  return {
    normalized_logging_surface_rows: normalizedLoggingSurfaceRows,
    normalized_alerting_surface_rows: normalizedAlertingSurfaceRows,
    normalized_monitoring_surface_rows: normalizedMonitoringSurfaceRows,
    normalized_error_tracking_rows: normalizedErrorTrackingRows,
    normalized_uptime_surface_rows: normalizedUptimeSurfaceRows,
    risk_summary: riskSummary
  };
}

export function buildWordpressPhaseKNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_k_observability_strategy",
    artifact_version: "v1",
    phase_k_gate_status: String(gate.phase_k_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0,
            logging_surface_count: 0,
            alerting_surface_count: 0,
            monitoring_surface_count: 0,
            error_tracking_count: 0,
            uptime_surface_count: 0
          },
    normalized_logging_surface_rows: Array.isArray(
      normalizedInventory.normalized_logging_surface_rows
    )
      ? normalizedInventory.normalized_logging_surface_rows
      : [],
    normalized_alerting_surface_rows: Array.isArray(
      normalizedInventory.normalized_alerting_surface_rows
    )
      ? normalizedInventory.normalized_alerting_surface_rows
      : [],
    normalized_monitoring_surface_rows: Array.isArray(
      normalizedInventory.normalized_monitoring_surface_rows
    )
      ? normalizedInventory.normalized_monitoring_surface_rows
      : [],
    normalized_error_tracking_rows: Array.isArray(
      normalizedInventory.normalized_error_tracking_rows
    )
      ? normalizedInventory.normalized_error_tracking_rows
      : [],
    normalized_uptime_surface_rows: Array.isArray(
      normalizedInventory.normalized_uptime_surface_rows
    )
      ? normalizedInventory.normalized_uptime_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseKReadinessGate(args = {}) {
  const phaseKPlan =
    args.phaseKPlan && typeof args.phaseKPlan === "object" ? args.phaseKPlan : {};
  const phaseKGate =
    args.phaseKGate && typeof args.phaseKGate === "object" ? args.phaseKGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseKGate.blocking_reasons || [])];

  if (phaseKPlan.enabled !== true) {
    blockingReasons.push("phase_k_not_enabled");
  }

  const highRiskCount = Number(riskSummary.high_risk_count || 0);
  const mediumRiskCount = Number(riskSummary.medium_risk_count || 0);

  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_observability_surfaces_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_observability_reconciliation"
      : "blocked_for_observability_reconciliation",
    readiness_ready: readiness,
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: Number(riskSummary.low_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseKSafeCandidates(args = {}) {
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
      logging_surface_candidates: [],
      alerting_surface_candidates: [],
      monitoring_surface_candidates: [],
      error_tracking_candidates: [],
      uptime_surface_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_k_readiness_not_ready"]
    };
  }

  const normalizedLoggingSurfaceRows = Array.isArray(
    normalizedInventory.normalized_logging_surface_rows
  )
    ? normalizedInventory.normalized_logging_surface_rows
    : [];
  const normalizedAlertingSurfaceRows = Array.isArray(
    normalizedInventory.normalized_alerting_surface_rows
  )
    ? normalizedInventory.normalized_alerting_surface_rows
    : [];
  const normalizedMonitoringSurfaceRows = Array.isArray(
    normalizedInventory.normalized_monitoring_surface_rows
  )
    ? normalizedInventory.normalized_monitoring_surface_rows
    : [];
  const normalizedErrorTrackingRows = Array.isArray(
    normalizedInventory.normalized_error_tracking_rows
  )
    ? normalizedInventory.normalized_error_tracking_rows
    : [];
  const normalizedUptimeSurfaceRows = Array.isArray(
    normalizedInventory.normalized_uptime_surface_rows
  )
    ? normalizedInventory.normalized_uptime_surface_rows
    : [];

  const loggingSurfaceCandidates = normalizedLoggingSurfaceRows
    .filter(row => String(row?.observability_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "logging_surface",
      logging_key: String(row?.logging_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      retention_mode: String(row?.retention_mode || "").trim(),
      destination: String(row?.destination || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      candidate_reason: "non_high_risk_logging_surface_candidate"
    }));

  const alertingSurfaceCandidates = normalizedAlertingSurfaceRows
    .filter(row => String(row?.observability_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "alerting_surface",
      alert_key: String(row?.alert_key || "").trim(),
      enabled: row?.enabled === true,
      channel: String(row?.channel || "").trim(),
      severity_mode: String(row?.severity_mode || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      candidate_reason: "non_high_risk_alerting_surface_candidate"
    }));

  const monitoringSurfaceCandidates = normalizedMonitoringSurfaceRows
    .filter(row => String(row?.observability_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "monitoring_surface",
      monitor_key: String(row?.monitor_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      monitor_mode: String(row?.monitor_mode || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      candidate_reason: "non_high_risk_monitoring_surface_candidate"
    }));

  const errorTrackingCandidates = normalizedErrorTrackingRows
    .filter(row => String(row?.observability_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "error_tracking_surface",
      error_tracking_key: String(row?.error_tracking_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      environment_mode: String(row?.environment_mode || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      candidate_reason: "non_high_risk_error_tracking_candidate"
    }));

  const uptimeSurfaceCandidates = normalizedUptimeSurfaceRows
    .filter(row => String(row?.observability_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "uptime_surface",
      uptime_key: String(row?.uptime_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      check_mode: String(row?.check_mode || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      candidate_reason: "non_high_risk_uptime_surface_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      loggingSurfaceCandidates.length +
      alertingSurfaceCandidates.length +
      monitoringSurfaceCandidates.length +
      errorTrackingCandidates.length +
      uptimeSurfaceCandidates.length,
    logging_surface_candidates: loggingSurfaceCandidates,
    alerting_surface_candidates: alertingSurfaceCandidates,
    monitoring_surface_candidates: monitoringSurfaceCandidates,
    error_tracking_candidates: errorTrackingCandidates,
    uptime_surface_candidates: uptimeSurfaceCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseKReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_k_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    high_risk_count: Number(readiness.high_risk_count || 0),
    medium_risk_count: Number(readiness.medium_risk_count || 0),
    low_risk_count: Number(readiness.low_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    logging_surface_candidates: Array.isArray(safeCandidates.logging_surface_candidates)
      ? safeCandidates.logging_surface_candidates
      : [],
    alerting_surface_candidates: Array.isArray(safeCandidates.alerting_surface_candidates)
      ? safeCandidates.alerting_surface_candidates
      : [],
    monitoring_surface_candidates: Array.isArray(
      safeCandidates.monitoring_surface_candidates
    )
      ? safeCandidates.monitoring_surface_candidates
      : [],
    error_tracking_candidates: Array.isArray(safeCandidates.error_tracking_candidates)
      ? safeCandidates.error_tracking_candidates
      : [],
    uptime_surface_candidates: Array.isArray(safeCandidates.uptime_surface_candidates)
      ? safeCandidates.uptime_surface_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressLoggingSurfaceReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "logging_surface",
    logging_key: String(row?.logging_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    retention_mode: String(row?.retention_mode || "").trim(),
    destination: String(row?.destination || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_mode: "safe_logging_surface_reconciliation_candidate",
    payload_shape: {
      logging_key: String(row?.logging_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      retention_mode: String(row?.retention_mode || "").trim(),
      destination: String(row?.destination || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressObservabilitySurfaceReconciliationPayloadRow(row = {}) {
  return {
    entity_type: String(row?.entity_type || "").trim(),
    alert_key: String(row?.alert_key || "").trim(),
    monitor_key: String(row?.monitor_key || "").trim(),
    error_tracking_key: String(row?.error_tracking_key || "").trim(),
    uptime_key: String(row?.uptime_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    channel: String(row?.channel || "").trim(),
    severity_mode: String(row?.severity_mode || "").trim(),
    monitor_mode: String(row?.monitor_mode || "").trim(),
    environment_mode: String(row?.environment_mode || "").trim(),
    check_mode: String(row?.check_mode || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_mode: "safe_observability_surface_reconciliation_candidate",
    payload_shape: {
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      channel: String(row?.channel || "").trim(),
      severity_mode: String(row?.severity_mode || "").trim(),
      monitor_mode: String(row?.monitor_mode || "").trim(),
      environment_mode: String(row?.environment_mode || "").trim(),
      check_mode: String(row?.check_mode || "").trim(),
      apply_mode: "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseKReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      logging_surface_payload_rows: [],
      alerting_surface_payload_rows: [],
      monitoring_surface_payload_rows: [],
      error_tracking_payload_rows: [],
      uptime_surface_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_k_safe_candidates_not_ready"]
    };
  }

  const loggingSurfaceCandidates = Array.isArray(
    safeCandidates.logging_surface_candidates
  )
    ? safeCandidates.logging_surface_candidates
    : [];
  const alertingSurfaceCandidates = Array.isArray(
    safeCandidates.alerting_surface_candidates
  )
    ? safeCandidates.alerting_surface_candidates
    : [];
  const monitoringSurfaceCandidates = Array.isArray(
    safeCandidates.monitoring_surface_candidates
  )
    ? safeCandidates.monitoring_surface_candidates
    : [];
  const errorTrackingCandidates = Array.isArray(
    safeCandidates.error_tracking_candidates
  )
    ? safeCandidates.error_tracking_candidates
    : [];
  const uptimeSurfaceCandidates = Array.isArray(
    safeCandidates.uptime_surface_candidates
  )
    ? safeCandidates.uptime_surface_candidates
    : [];

  const loggingSurfacePayloadRows = loggingSurfaceCandidates.map(
    buildWordpressLoggingSurfaceReconciliationPayloadRow
  );
  const alertingSurfacePayloadRows = alertingSurfaceCandidates.map(
    buildWordpressObservabilitySurfaceReconciliationPayloadRow
  );
  const monitoringSurfacePayloadRows = monitoringSurfaceCandidates.map(
    buildWordpressObservabilitySurfaceReconciliationPayloadRow
  );
  const errorTrackingPayloadRows = errorTrackingCandidates.map(
    buildWordpressObservabilitySurfaceReconciliationPayloadRow
  );
  const uptimeSurfacePayloadRows = uptimeSurfaceCandidates.map(
    buildWordpressObservabilitySurfaceReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      loggingSurfacePayloadRows.length +
      alertingSurfacePayloadRows.length +
      monitoringSurfacePayloadRows.length +
      errorTrackingPayloadRows.length +
      uptimeSurfacePayloadRows.length,
    logging_surface_payload_rows: loggingSurfacePayloadRows,
    alerting_surface_payload_rows: alertingSurfacePayloadRows,
    monitoring_surface_payload_rows: monitoringSurfacePayloadRows,
    error_tracking_payload_rows: errorTrackingPayloadRows,
    uptime_surface_payload_rows: uptimeSurfacePayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseKReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_k_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    logging_surface_payload_rows: Array.isArray(planner.logging_surface_payload_rows)
      ? planner.logging_surface_payload_rows
      : [],
    alerting_surface_payload_rows: Array.isArray(planner.alerting_surface_payload_rows)
      ? planner.alerting_surface_payload_rows
      : [],
    monitoring_surface_payload_rows: Array.isArray(planner.monitoring_surface_payload_rows)
      ? planner.monitoring_surface_payload_rows
      : [],
    error_tracking_payload_rows: Array.isArray(planner.error_tracking_payload_rows)
      ? planner.error_tracking_payload_rows
      : [],
    uptime_surface_payload_rows: Array.isArray(planner.uptime_surface_payload_rows)
      ? planner.uptime_surface_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseKExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const observabilityMonitoring =
    migration.observability_monitoring &&
    typeof migration.observability_monitoring === "object"
      ? migration.observability_monitoring
      : {};
  const execution =
    observabilityMonitoring.execution &&
    typeof observabilityMonitoring.execution === "object"
      ? observabilityMonitoring.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 200))
  };
}

export function buildWordpressPhaseKExecutionGuard(args = {}) {
  const phaseKPlan =
    args.phaseKPlan && typeof args.phaseKPlan === "object" ? args.phaseKPlan : {};
  const phaseKGate =
    args.phaseKGate && typeof args.phaseKGate === "object" ? args.phaseKGate : {};
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

  if (phaseKPlan.enabled !== true) {
    blockingReasons.push("phase_k_not_enabled");
  }
  if (phaseKGate.phase_k_gate_ready !== true) {
    blockingReasons.push("phase_k_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_k_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_k_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_k_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_k_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseKPlan.inventory_only === true && phaseKPlan.apply === true) {
    blockingReasons.push("phase_k_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_observability_reconciliation_execution"
      : "blocked_before_observability_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseKExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_k_execution_guard",
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

export function buildWordpressPhaseKMutationCandidateSelector(args = {}) {
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
      selected_logging_surface_candidates: [],
      selected_alerting_surface_candidates: [],
      selected_monitoring_surface_candidates: [],
      selected_error_tracking_candidates: [],
      selected_uptime_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_k_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_logging_surface_candidates: [],
      selected_alerting_surface_candidates: [],
      selected_monitoring_surface_candidates: [],
      selected_error_tracking_candidates: [],
      selected_uptime_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_k_payload_planner_not_ready"]
    };
  }

  const loggingSurfacePayloadRows = Array.isArray(
    payloadPlanner.logging_surface_payload_rows
  )
    ? payloadPlanner.logging_surface_payload_rows
    : [];
  const alertingSurfacePayloadRows = Array.isArray(
    payloadPlanner.alerting_surface_payload_rows
  )
    ? payloadPlanner.alerting_surface_payload_rows
    : [];
  const monitoringSurfacePayloadRows = Array.isArray(
    payloadPlanner.monitoring_surface_payload_rows
  )
    ? payloadPlanner.monitoring_surface_payload_rows
    : [];
  const errorTrackingPayloadRows = Array.isArray(
    payloadPlanner.error_tracking_payload_rows
  )
    ? payloadPlanner.error_tracking_payload_rows
    : [];
  const uptimeSurfacePayloadRows = Array.isArray(
    payloadPlanner.uptime_surface_payload_rows
  )
    ? payloadPlanner.uptime_surface_payload_rows
    : [];

  const selectedLoggingSurfaceCandidates = [];
  const selectedAlertingSurfaceCandidates = [];
  const selectedMonitoringSurfaceCandidates = [];
  const selectedErrorTrackingCandidates = [];
  const selectedUptimeSurfaceCandidates = [];
  const rejectedCandidates = [];

  for (const row of loggingSurfacePayloadRows) {
    const riskClass = String(row?.observability_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "logging_surface",
        logging_key: String(row?.logging_key || "").trim(),
        rejection_reason: "high_risk_logging_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_logging_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "logging_surface",
        logging_key: String(row?.logging_key || "").trim(),
        rejection_reason: "unsupported_logging_surface_payload_mode"
      });
      continue;
    }

    selectedLoggingSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_logging_surface_candidate_ready_for_mutation"
    });
  }

  for (const row of alertingSurfacePayloadRows) {
    const riskClass = String(row?.observability_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "alerting_surface",
        alert_key: String(row?.alert_key || "").trim(),
        rejection_reason: "high_risk_alerting_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_observability_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "alerting_surface",
        alert_key: String(row?.alert_key || "").trim(),
        rejection_reason: "unsupported_alerting_surface_payload_mode"
      });
      continue;
    }

    selectedAlertingSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_alerting_surface_candidate_ready_for_mutation"
    });
  }

  for (const row of monitoringSurfacePayloadRows) {
    const riskClass = String(row?.observability_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "monitoring_surface",
        monitor_key: String(row?.monitor_key || "").trim(),
        rejection_reason: "high_risk_monitoring_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_observability_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "monitoring_surface",
        monitor_key: String(row?.monitor_key || "").trim(),
        rejection_reason: "unsupported_monitoring_surface_payload_mode"
      });
      continue;
    }

    selectedMonitoringSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_monitoring_surface_candidate_ready_for_mutation"
    });
  }

  for (const row of errorTrackingPayloadRows) {
    const riskClass = String(row?.observability_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "error_tracking_surface",
        error_tracking_key: String(row?.error_tracking_key || "").trim(),
        rejection_reason: "high_risk_error_tracking_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_observability_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "error_tracking_surface",
        error_tracking_key: String(row?.error_tracking_key || "").trim(),
        rejection_reason: "unsupported_error_tracking_payload_mode"
      });
      continue;
    }

    selectedErrorTrackingCandidates.push({
      ...row,
      candidate_reason: "safe_error_tracking_candidate_ready_for_mutation"
    });
  }

  for (const row of uptimeSurfacePayloadRows) {
    const riskClass = String(row?.observability_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (riskClass === "high") {
      rejectedCandidates.push({
        entity_type: "uptime_surface",
        uptime_key: String(row?.uptime_key || "").trim(),
        rejection_reason: "high_risk_uptime_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_observability_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "uptime_surface",
        uptime_key: String(row?.uptime_key || "").trim(),
        rejection_reason: "unsupported_uptime_surface_payload_mode"
      });
      continue;
    }

    selectedUptimeSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_uptime_surface_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 200));
  const limitedSelectedLoggingSurfaceCandidates =
    selectedLoggingSurfaceCandidates.slice(0, candidateLimit);
  const limitedSelectedAlertingSurfaceCandidates =
    selectedAlertingSurfaceCandidates.slice(0, candidateLimit);
  const limitedSelectedMonitoringSurfaceCandidates =
    selectedMonitoringSurfaceCandidates.slice(0, candidateLimit);
  const limitedSelectedErrorTrackingCandidates =
    selectedErrorTrackingCandidates.slice(0, candidateLimit);
  const limitedSelectedUptimeSurfaceCandidates =
    selectedUptimeSurfaceCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedLoggingSurfaceCandidates.length +
      limitedSelectedAlertingSurfaceCandidates.length +
      limitedSelectedMonitoringSurfaceCandidates.length +
      limitedSelectedErrorTrackingCandidates.length +
      limitedSelectedUptimeSurfaceCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_logging_surface_candidates: limitedSelectedLoggingSurfaceCandidates,
    selected_alerting_surface_candidates: limitedSelectedAlertingSurfaceCandidates,
    selected_monitoring_surface_candidates: limitedSelectedMonitoringSurfaceCandidates,
    selected_error_tracking_candidates: limitedSelectedErrorTrackingCandidates,
    selected_uptime_surface_candidates: limitedSelectedUptimeSurfaceCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseKMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_k_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_logging_surface_candidates: Array.isArray(
      selector.selected_logging_surface_candidates
    )
      ? selector.selected_logging_surface_candidates
      : [],
    selected_alerting_surface_candidates: Array.isArray(
      selector.selected_alerting_surface_candidates
    )
      ? selector.selected_alerting_surface_candidates
      : [],
    selected_monitoring_surface_candidates: Array.isArray(
      selector.selected_monitoring_surface_candidates
    )
      ? selector.selected_monitoring_surface_candidates
      : [],
    selected_error_tracking_candidates: Array.isArray(
      selector.selected_error_tracking_candidates
    )
      ? selector.selected_error_tracking_candidates
      : [],
    selected_uptime_surface_candidates: Array.isArray(
      selector.selected_uptime_surface_candidates
    )
      ? selector.selected_uptime_surface_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressLoggingSurfaceMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_logging_surface_reconciliation",
    target_scope: "destination_wordpress_logging_surface",
    payload: {
      logging_key: Object.prototype.hasOwnProperty.call(payloadShape, "logging_key")
        ? payloadShape.logging_key
        : String(row?.logging_key || "").trim(),
      enabled: Object.prototype.hasOwnProperty.call(payloadShape, "enabled")
        ? payloadShape.enabled === true
        : row?.enabled === true,
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      retention_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "retention_mode"
      )
        ? payloadShape.retention_mode
        : String(row?.retention_mode || "").trim(),
      destination: Object.prototype.hasOwnProperty.call(payloadShape, "destination")
        ? payloadShape.destination
        : String(row?.destination || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressObservabilitySurfaceMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_observability_surface_reconciliation",
    target_scope: "destination_wordpress_observability_surface",
    payload: {
      enabled: Object.prototype.hasOwnProperty.call(payloadShape, "enabled")
        ? payloadShape.enabled === true
        : row?.enabled === true,
      provider: Object.prototype.hasOwnProperty.call(payloadShape, "provider")
        ? payloadShape.provider
        : String(row?.provider || "").trim(),
      channel: Object.prototype.hasOwnProperty.call(payloadShape, "channel")
        ? payloadShape.channel
        : String(row?.channel || "").trim(),
      severity_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "severity_mode"
      )
        ? payloadShape.severity_mode
        : String(row?.severity_mode || "").trim(),
      monitor_mode: Object.prototype.hasOwnProperty.call(payloadShape, "monitor_mode")
        ? payloadShape.monitor_mode
        : String(row?.monitor_mode || "").trim(),
      environment_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "environment_mode"
      )
        ? payloadShape.environment_mode
        : String(row?.environment_mode || "").trim(),
      check_mode: Object.prototype.hasOwnProperty.call(payloadShape, "check_mode")
        ? payloadShape.check_mode
        : String(row?.check_mode || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "preserve_from_source"
    }
  };
}

export function buildWordpressPhaseKMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      logging_surface_composed_payloads: [],
      alerting_surface_composed_payloads: [],
      monitoring_surface_composed_payloads: [],
      error_tracking_composed_payloads: [],
      uptime_surface_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_k_mutation_candidates_not_ready"]
    };
  }

  const selectedLoggingSurfaceCandidates = Array.isArray(
    selector.selected_logging_surface_candidates
  )
    ? selector.selected_logging_surface_candidates
    : [];
  const selectedAlertingSurfaceCandidates = Array.isArray(
    selector.selected_alerting_surface_candidates
  )
    ? selector.selected_alerting_surface_candidates
    : [];
  const selectedMonitoringSurfaceCandidates = Array.isArray(
    selector.selected_monitoring_surface_candidates
  )
    ? selector.selected_monitoring_surface_candidates
    : [];
  const selectedErrorTrackingCandidates = Array.isArray(
    selector.selected_error_tracking_candidates
  )
    ? selector.selected_error_tracking_candidates
    : [];
  const selectedUptimeSurfaceCandidates = Array.isArray(
    selector.selected_uptime_surface_candidates
  )
    ? selector.selected_uptime_surface_candidates
    : [];

  const loggingSurfaceComposedPayloads = selectedLoggingSurfaceCandidates.map(row => ({
    entity_type: "logging_surface",
    logging_key: String(row?.logging_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    retention_mode: String(row?.retention_mode || "").trim(),
    destination: String(row?.destination || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_reason: "composed_from_safe_logging_surface_candidate",
    mutation_payload: buildWordpressLoggingSurfaceMutationPayloadFromCandidate(row)
  }));

  const alertingSurfaceComposedPayloads = selectedAlertingSurfaceCandidates.map(row => ({
    entity_type: "alerting_surface",
    alert_key: String(row?.alert_key || "").trim(),
    enabled: row?.enabled === true,
    channel: String(row?.channel || "").trim(),
    severity_mode: String(row?.severity_mode || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_reason: "composed_from_safe_alerting_surface_candidate",
    mutation_payload: buildWordpressObservabilitySurfaceMutationPayloadFromCandidate(row)
  }));

  const monitoringSurfaceComposedPayloads = selectedMonitoringSurfaceCandidates.map(
    row => ({
      entity_type: "monitoring_surface",
      monitor_key: String(row?.monitor_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      monitor_mode: String(row?.monitor_mode || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      payload_reason: "composed_from_safe_monitoring_surface_candidate",
      mutation_payload: buildWordpressObservabilitySurfaceMutationPayloadFromCandidate(
        row
      )
    })
  );

  const errorTrackingComposedPayloads = selectedErrorTrackingCandidates.map(row => ({
    entity_type: "error_tracking_surface",
    error_tracking_key: String(row?.error_tracking_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    environment_mode: String(row?.environment_mode || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_reason: "composed_from_safe_error_tracking_candidate",
    mutation_payload: buildWordpressObservabilitySurfaceMutationPayloadFromCandidate(
      row
    )
  }));

  const uptimeSurfaceComposedPayloads = selectedUptimeSurfaceCandidates.map(row => ({
    entity_type: "uptime_surface",
    uptime_key: String(row?.uptime_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    check_mode: String(row?.check_mode || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    payload_reason: "composed_from_safe_uptime_surface_candidate",
    mutation_payload: buildWordpressObservabilitySurfaceMutationPayloadFromCandidate(
      row
    )
  }));

  return {
    composer_status: "ready",
    payload_count:
      loggingSurfaceComposedPayloads.length +
      alertingSurfaceComposedPayloads.length +
      monitoringSurfaceComposedPayloads.length +
      errorTrackingComposedPayloads.length +
      uptimeSurfaceComposedPayloads.length,
    logging_surface_composed_payloads: loggingSurfaceComposedPayloads,
    alerting_surface_composed_payloads: alertingSurfaceComposedPayloads,
    monitoring_surface_composed_payloads: monitoringSurfaceComposedPayloads,
    error_tracking_composed_payloads: errorTrackingComposedPayloads,
    uptime_surface_composed_payloads: uptimeSurfaceComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseKMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_k_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    logging_surface_composed_payloads: Array.isArray(
      composer.logging_surface_composed_payloads
    )
      ? composer.logging_surface_composed_payloads
      : [],
    alerting_surface_composed_payloads: Array.isArray(
      composer.alerting_surface_composed_payloads
    )
      ? composer.alerting_surface_composed_payloads
      : [],
    monitoring_surface_composed_payloads: Array.isArray(
      composer.monitoring_surface_composed_payloads
    )
      ? composer.monitoring_surface_composed_payloads
      : [],
    error_tracking_composed_payloads: Array.isArray(
      composer.error_tracking_composed_payloads
    )
      ? composer.error_tracking_composed_payloads
      : [],
    uptime_surface_composed_payloads: Array.isArray(
      composer.uptime_surface_composed_payloads
    )
      ? composer.uptime_surface_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressObservabilityDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "logging_surface") {
    return {
      entity_type: "logging_surface",
      logging_key: String(row?.logging_key || "").trim(),
      enabled: row?.enabled === true,
      provider: String(row?.provider || "").trim(),
      retention_mode: String(row?.retention_mode || "").trim(),
      destination: String(row?.destination || "").trim(),
      observability_risk_class: String(row?.observability_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_logging_key: String(payload.logging_key || "").trim(),
        expected_enabled: payload?.enabled === true ? "true" : "false",
        expected_provider: String(payload.provider || "").trim(),
        expected_retention_mode: String(payload.retention_mode || "").trim(),
        expected_destination: String(payload.destination || "").trim(),
        expected_apply_mode: String(payload.apply_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: entityType,
    alert_key: String(row?.alert_key || "").trim(),
    monitor_key: String(row?.monitor_key || "").trim(),
    error_tracking_key: String(row?.error_tracking_key || "").trim(),
    uptime_key: String(row?.uptime_key || "").trim(),
    enabled: row?.enabled === true,
    provider: String(row?.provider || "").trim(),
    channel: String(row?.channel || "").trim(),
    severity_mode: String(row?.severity_mode || "").trim(),
    monitor_mode: String(row?.monitor_mode || "").trim(),
    environment_mode: String(row?.environment_mode || "").trim(),
    check_mode: String(row?.check_mode || "").trim(),
    observability_risk_class: String(row?.observability_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_enabled: payload?.enabled === true ? "true" : "false",
      expected_provider: String(payload.provider || "").trim(),
      expected_channel: String(payload.channel || "").trim(),
      expected_severity_mode: String(payload.severity_mode || "").trim(),
      expected_monitor_mode: String(payload.monitor_mode || "").trim(),
      expected_environment_mode: String(payload.environment_mode || "").trim(),
      expected_check_mode: String(payload.check_mode || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseKDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_logging_surface_rows: [],
      simulated_alerting_surface_rows: [],
      simulated_monitoring_surface_rows: [],
      simulated_error_tracking_rows: [],
      simulated_uptime_surface_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        logging_surface_rows: 0,
        alerting_surface_rows: 0,
        monitoring_surface_rows: 0,
        error_tracking_rows: 0,
        uptime_surface_rows: 0,
        preserve_from_source_count: 0,
        enabled_true_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_k_mutation_payloads_not_ready"]
    };
  }

  const loggingSurfaceRows = Array.isArray(composer.logging_surface_composed_payloads)
    ? composer.logging_surface_composed_payloads
    : [];
  const alertingSurfaceRows = Array.isArray(composer.alerting_surface_composed_payloads)
    ? composer.alerting_surface_composed_payloads
    : [];
  const monitoringSurfaceRows = Array.isArray(
    composer.monitoring_surface_composed_payloads
  )
    ? composer.monitoring_surface_composed_payloads
    : [];
  const errorTrackingRows = Array.isArray(composer.error_tracking_composed_payloads)
    ? composer.error_tracking_composed_payloads
    : [];
  const uptimeSurfaceRows = Array.isArray(composer.uptime_surface_composed_payloads)
    ? composer.uptime_surface_composed_payloads
    : [];

  const simulatedLoggingSurfaceRows = loggingSurfaceRows.map(
    simulateWordpressObservabilityDryRunRow
  );
  const simulatedAlertingSurfaceRows = alertingSurfaceRows.map(
    simulateWordpressObservabilityDryRunRow
  );
  const simulatedMonitoringSurfaceRows = monitoringSurfaceRows.map(
    simulateWordpressObservabilityDryRunRow
  );
  const simulatedErrorTrackingRows = errorTrackingRows.map(
    simulateWordpressObservabilityDryRunRow
  );
  const simulatedUptimeSurfaceRows = uptimeSurfaceRows.map(
    simulateWordpressObservabilityDryRunRow
  );

  const allRows = [
    ...simulatedLoggingSurfaceRows,
    ...simulatedAlertingSurfaceRows,
    ...simulatedMonitoringSurfaceRows,
    ...simulatedErrorTrackingRows,
    ...simulatedUptimeSurfaceRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "logging_surface") acc.logging_surface_rows += 1;
      else if (entityType === "alerting_surface") acc.alerting_surface_rows += 1;
      else if (entityType === "monitoring_surface") acc.monitoring_surface_rows += 1;
      else if (entityType === "error_tracking_surface") acc.error_tracking_rows += 1;
      else if (entityType === "uptime_surface") acc.uptime_surface_rows += 1;

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
      logging_surface_rows: 0,
      alerting_surface_rows: 0,
      monitoring_surface_rows: 0,
      error_tracking_rows: 0,
      uptime_surface_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_logging_surface_rows: simulatedLoggingSurfaceRows,
    simulated_alerting_surface_rows: simulatedAlertingSurfaceRows,
    simulated_monitoring_surface_rows: simulatedMonitoringSurfaceRows,
    simulated_error_tracking_rows: simulatedErrorTrackingRows,
    simulated_uptime_surface_rows: simulatedUptimeSurfaceRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseKDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_k_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_logging_surface_rows: Array.isArray(
      simulator.simulated_logging_surface_rows
    )
      ? simulator.simulated_logging_surface_rows
      : [],
    simulated_alerting_surface_rows: Array.isArray(
      simulator.simulated_alerting_surface_rows
    )
      ? simulator.simulated_alerting_surface_rows
      : [],
    simulated_monitoring_surface_rows: Array.isArray(
      simulator.simulated_monitoring_surface_rows
    )
      ? simulator.simulated_monitoring_surface_rows
      : [],
    simulated_error_tracking_rows: Array.isArray(
      simulator.simulated_error_tracking_rows
    )
      ? simulator.simulated_error_tracking_rows
      : [],
    simulated_uptime_surface_rows: Array.isArray(
      simulator.simulated_uptime_surface_rows
    )
      ? simulator.simulated_uptime_surface_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            logging_surface_rows: 0,
            alerting_surface_rows: 0,
            monitoring_surface_rows: 0,
            error_tracking_rows: 0,
            uptime_surface_rows: 0,
            preserve_from_source_count: 0,
            enabled_true_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseKFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseKPlan =
    args.phaseKPlan && typeof args.phaseKPlan === "object" ? args.phaseKPlan : {};
  const phaseKGate =
    args.phaseKGate && typeof args.phaseKGate === "object" ? args.phaseKGate : {};
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
  const allBlockingReasons = [
    ...(Array.isArray(phaseKGate.blocking_reasons) ? phaseKGate.blocking_reasons : []),
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
  ];

  const overallStatus =
    !phaseKPlan.enabled
      ? "skipped"
      : allBlockingReasons.length > 0
      ? "blocked"
      : String(executionGuardArtifact.execution_guard_status || "").includes("ready")
      ? "ready_for_execution"
      : "pending_review";

  return {
    artifact_type: "wordpress_phase_k_final_operator_handoff",
    artifact_version: "v1",
    phase: "K",
    phase_name: "Observability / Logs / Alerts / Monitoring",
    enabled: phaseKPlan.enabled === true,
    overall_status: overallStatus,
    phase_k_enabled: phaseKPlan.enabled === true,
    phase_k_inventory_only: phaseKPlan.inventory_only === true,
    phase_k_apply_requested: phaseKPlan.apply === true,
    requested_observability_scope: {
      include_logging_surface: phaseKPlan.include_logging_surface === true,
      include_alerting_surface: phaseKPlan.include_alerting_surface === true,
      include_monitoring_surface: phaseKPlan.include_monitoring_surface === true,
      include_error_tracking: phaseKPlan.include_error_tracking === true,
      include_uptime_surface: phaseKPlan.include_uptime_surface === true,
      max_items: Number(phaseKPlan.max_items || 0)
    },
    requested_observability_config:
      migration?.observability && typeof migration.observability === "object"
        ? migration.observability
        : {},
    phase_k_gate_status: String(phaseKGate.phase_k_gate_status || "").trim(),
    phase_k_inventory_status: String(inventoryArtifact.phase_k_inventory_status || "").trim(),
    phase_k_strategy_status: String(
      normalizedInventoryArtifact.phase_k_gate_status || ""
    ).trim(),
    phase_k_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_k_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_k_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_k_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_k_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_k_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_k_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            logging_surface_count: 0,
            alerting_surface_count: 0,
            monitoring_surface_count: 0,
            error_tracking_count: 0,
            uptime_surface_count: 0
          },
    plugin_signals:
      inventoryArtifact?.plugin_signals &&
      typeof inventoryArtifact.plugin_signals === "object"
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
            logging_surface_count: 0,
            alerting_surface_count: 0,
            monitoring_surface_count: 0,
            error_tracking_count: 0,
            uptime_surface_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: allBlockingReasons,
    operator_actions: [
      readinessArtifact.readiness_ready === true
        ? "review_safe_observability_candidates"
        : "resolve_observability_reconciliation_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_observability_reconciliation_execution"
        ? "approve_observability_mutation_trial"
        : "hold_observability_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_observability_dry_run_preview"
        : "no_observability_dry_run_preview_available"
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