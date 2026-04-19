// Auto-extracted from server.js — do not edit manually, use domain logic here.

export function resolveWordpressPhaseFPlan(payload = {}) {
  const migration = payload?.migration || {};
  const usersRolesAuth =
    migration.users_roles_auth && typeof migration.users_roles_auth === "object"
      ? migration.users_roles_auth
      : {};

  return {
    enabled: usersRolesAuth.enabled === true,
    inventory_only:
      usersRolesAuth.inventory_only === undefined
        ? true
        : usersRolesAuth.inventory_only === true,
    apply: usersRolesAuth.apply === true,
    include_users:
      usersRolesAuth.include_users === undefined ? true : usersRolesAuth.include_users === true,
    include_roles:
      usersRolesAuth.include_roles === undefined ? true : usersRolesAuth.include_roles === true,
    include_auth_surface:
      usersRolesAuth.include_auth_surface === undefined
        ? true
        : usersRolesAuth.include_auth_surface === true,
    max_users: Math.max(1, toPositiveInt(usersRolesAuth.max_users, 500))
  };
}

export function assertWordpressPhaseFPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_f_apply_conflicts_with_inventory_only");
  }

  if (
    plan.include_users !== true &&
    plan.include_roles !== true &&
    plan.include_auth_surface !== true
  ) {
    blockingReasons.push("phase_f_no_inventory_scope_selected");
  }

  return {
    phase_f_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_f_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseFGate(args = {}) {
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
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFPlanStatus =
    args.phaseFPlanStatus && typeof args.phaseFPlanStatus === "object"
      ? args.phaseFPlanStatus
      : {};

  const blockingReasons = [...(phaseFPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_f");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  if (
    phaseFPlan.enabled === true &&
    phaseEFinalOperatorHandoffBundle.phase_e_enabled === true &&
    String(phaseEFinalOperatorHandoffBundle.phase_e_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_e_media_stage_blocked");
  }

  return {
    phase_f_gate_status:
      blockingReasons.length === 0 ? "ready_for_users_roles_auth_inventory" : "blocked",
    phase_f_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseFPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function normalizeWordpressUserInventoryRow(user = {}) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];

  return {
    entity_type: "user",
    source_id: Number.isFinite(Number(user?.id)) ? Number(user.id) : null,
    slug: String(user?.slug || user?.username || "").trim(),
    username: String(user?.username || "").trim(),
    display_name: String(user?.name || user?.display_name || "").trim(),
    email: String(user?.email || "").trim(),
    roles: roles.map(x => String(x || "").trim()).filter(Boolean),
    role_count: roles.length,
    has_admin_role: roles.some(x => String(x || "").trim() === "administrator"),
    inventory_classification:
      roles.some(x => String(x || "").trim() === "administrator")
        ? "privileged_user"
        : roles.length > 0
        ? "role_bound_user"
        : "unclassified_user"
  };
}

export function buildWordpressRoleInventoryRows(siteProfile = {}) {
  const roleMap =
    siteProfile?.roles && typeof siteProfile.roles === "object" && !Array.isArray(siteProfile.roles)
      ? siteProfile.roles
      : {};

  return Object.entries(roleMap).map(([roleKey, roleValue]) => ({
    entity_type: "role",
    role_key: String(roleKey || "").trim(),
    role_label:
      roleValue && typeof roleValue === "object"
        ? String(roleValue.label || roleValue.name || roleKey || "").trim()
        : String(roleValue || roleKey || "").trim(),
    capabilities:
      roleValue && typeof roleValue === "object" && roleValue.capabilities
        ? roleValue.capabilities
        : {},
    capability_count:
      roleValue &&
      typeof roleValue === "object" &&
      roleValue.capabilities &&
      typeof roleValue.capabilities === "object"
        ? Object.keys(roleValue.capabilities).length
        : 0,
    inventory_classification:
      String(roleKey || "").trim() === "administrator"
        ? "privileged_role"
        : "standard_role"
  }));
}

export function buildWordpressAuthSurfaceRows(siteProfile = {}) {
  const authSurface =
    siteProfile?.auth_surface &&
    typeof siteProfile.auth_surface === "object" &&
    !Array.isArray(siteProfile.auth_surface)
      ? siteProfile.auth_surface
      : {};

  const rows = [];
  const knownKeys = [
    "login_url",
    "xmlrpc_enabled",
    "rest_api_enabled",
    "application_passwords_enabled",
    "two_factor_enabled",
    "sso_enabled",
    "password_policy",
    "registration_enabled"
  ];

  for (const key of knownKeys) {
    if (!Object.prototype.hasOwnProperty.call(authSurface, key)) continue;

    const value = authSurface[key];
    rows.push({
      entity_type: "auth_surface",
      auth_key: String(key || "").trim(),
      auth_value: value,
      auth_value_type: Array.isArray(value) ? "array" : typeof value,
      inventory_classification:
        key === "login_url" || key === "password_policy"
          ? "auth_configuration"
          : key === "xmlrpc_enabled" || key === "rest_api_enabled"
          ? "auth_endpoint_surface"
          : "auth_control_surface"
    });
  }

  return rows;
}

export async function runWordpressUsersRolesAuthInventory(args = {}) {
  const {
    wpContext = {},
    phaseFPlan = {},
    phaseFGate = {}
  } = args;

  if (phaseFGate.phase_f_gate_ready !== true) {
    return {
      phase_f_inventory_status: "blocked",
      user_rows: [],
      role_rows: [],
      auth_surface_rows: [],
      summary: {
        user_count: 0,
        privileged_user_count: 0,
        role_count: 0,
        privileged_role_count: 0,
        auth_surface_count: 0
      },
      failures: [
        {
          code: "phase_f_users_roles_auth_inventory_blocked",
          message: "Phase F users/roles/auth inventory blocked by phase_f_gate.",
          blocking_reasons: phaseFGate.blocking_reasons || []
        }
      ]
    };
  }

  const sourceProfile = wpContext?.source || {};
  const failures = [];
  let userRows = [];
  let roleRows = [];
  let authSurfaceRows = [];

  try {
    if (phaseFPlan.include_users === true) {
      const usersRaw = Array.isArray(sourceProfile?.users) ? sourceProfile.users : [];
      userRows = usersRaw
        .slice(0, phaseFPlan.max_users)
        .map(normalizeWordpressUserInventoryRow);
    }

    if (phaseFPlan.include_roles === true) {
      roleRows = buildWordpressRoleInventoryRows(sourceProfile);
    }

    if (phaseFPlan.include_auth_surface === true) {
      authSurfaceRows = buildWordpressAuthSurfaceRows(sourceProfile);
    }
  } catch (err) {
    failures.push({
      code: err?.code || "wordpress_users_roles_auth_inventory_failed",
      message: err?.message || "WordPress users/roles/auth inventory failed."
    });
  }

  const summary = {
    user_count: userRows.length,
    privileged_user_count: userRows.filter(x => x?.has_admin_role === true).length,
    role_count: roleRows.length,
    privileged_role_count: roleRows.filter(
      x => String(x?.inventory_classification || "").trim() === "privileged_role"
    ).length,
    auth_surface_count: authSurfaceRows.length
  };

  return {
    phase_f_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    user_rows: userRows,
    role_rows: roleRows,
    auth_surface_rows: authSurfaceRows,
    summary,
    failures
  };
}

export function buildWordpressPhaseFInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_f_users_roles_auth_inventory",
    artifact_version: "v1",
    phase_f_gate_status: String(gate.phase_f_gate_status || "").trim(),
    phase_f_inventory_status: String(inventory.phase_f_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            user_count: 0,
            privileged_user_count: 0,
            role_count: 0,
            privileged_role_count: 0,
            auth_surface_count: 0
          },
    user_rows: Array.isArray(inventory.user_rows) ? inventory.user_rows : [],
    role_rows: Array.isArray(inventory.role_rows) ? inventory.role_rows : [],
    auth_surface_rows: Array.isArray(inventory.auth_surface_rows)
      ? inventory.auth_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    failures: Array.isArray(inventory.failures) ? inventory.failures : []
  };
}

export function normalizeWordpressAuthValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(x => String(x ?? "").trim()));
  }

  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = value[key];
    }
    return JSON.stringify(sorted);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value ?? "").trim();
}

export function classifyWordpressUserPrivilegeRisk(row = {}) {
  const roles = Array.isArray(row?.roles) ? row.roles : [];
  const normalizedRoles = roles.map(x => String(x || "").trim()).filter(Boolean);

  let riskScore = 0;
  const reasons = [];

  if (normalizedRoles.includes("administrator")) {
    riskScore += 5;
    reasons.push("administrator_role_present");
  }
  if (normalizedRoles.includes("editor")) {
    riskScore += 2;
    reasons.push("editor_role_present");
  }
  if (normalizedRoles.includes("shop_manager")) {
    riskScore += 3;
    reasons.push("shop_manager_role_present");
  }
  if (normalizedRoles.length === 0) {
    riskScore += 1;
    reasons.push("no_roles_assigned");
  }
  if (String(row?.email || "").trim()) {
    reasons.push("email_present");
  }

  let privilege_risk_class = "low";
  if (riskScore >= 5) privilege_risk_class = "high";
  else if (riskScore >= 2) privilege_risk_class = "medium";

  return {
    normalized_roles: normalizedRoles,
    privilege_risk_score: riskScore,
    privilege_risk_class,
    privilege_risk_reasons: reasons
  };
}

export function classifyWordpressRolePrivilegeRisk(row = {}) {
  const roleKey = String(row?.role_key || "").trim();
  const capabilities =
    row?.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
      ? row.capabilities
      : {};

  const enabledCapabilities = Object.entries(capabilities)
    .filter(([, value]) => value === true || String(value || "").trim().toLowerCase() === "true")
    .map(([key]) => String(key || "").trim())
    .filter(Boolean);

  let riskScore = 0;
  const reasons = [];

  if (roleKey === "administrator") {
    riskScore += 5;
    reasons.push("administrator_role_key");
  }
  if (enabledCapabilities.includes("manage_options")) {
    riskScore += 3;
    reasons.push("manage_options_capability");
  }
  if (enabledCapabilities.includes("edit_users")) {
    riskScore += 3;
    reasons.push("edit_users_capability");
  }
  if (enabledCapabilities.includes("promote_users")) {
    riskScore += 2;
    reasons.push("promote_users_capability");
  }
  if (enabledCapabilities.includes("delete_users")) {
    riskScore += 2;
    reasons.push("delete_users_capability");
  }
  if (enabledCapabilities.includes("install_plugins")) {
    riskScore += 2;
    reasons.push("install_plugins_capability");
  }

  let privilege_risk_class = "low";
  if (riskScore >= 5) privilege_risk_class = "high";
  else if (riskScore >= 2) privilege_risk_class = "medium";

  return {
    enabled_capabilities: enabledCapabilities,
    privilege_risk_score: riskScore,
    privilege_risk_class,
    privilege_risk_reasons: reasons
  };
}

export function classifyWordpressAuthSurfaceRisk(row = {}) {
  const authKey = String(row?.auth_key || "").trim();
  const normalizedValue = normalizeWordpressAuthValue(row?.auth_value);

  let riskScore = 0;
  const reasons = [];

  if (authKey === "xmlrpc_enabled" && normalizedValue === "true") {
    riskScore += 4;
    reasons.push("xmlrpc_enabled");
  }
  if (authKey === "application_passwords_enabled" && normalizedValue === "true") {
    riskScore += 3;
    reasons.push("application_passwords_enabled");
  }
  if (authKey === "registration_enabled" && normalizedValue === "true") {
    riskScore += 3;
    reasons.push("registration_enabled");
  }
  if (authKey === "rest_api_enabled" && normalizedValue === "true") {
    riskScore += 1;
    reasons.push("rest_api_enabled");
  }
  if (authKey === "two_factor_enabled" && normalizedValue === "false") {
    riskScore += 2;
    reasons.push("two_factor_disabled");
  }
  if (authKey === "login_url" && normalizedValue) {
    reasons.push("login_url_present");
  }

  let auth_risk_class = "low";
  if (riskScore >= 4) auth_risk_class = "high";
  else if (riskScore >= 2) auth_risk_class = "medium";

  return {
    auth_value_normalized: normalizedValue,
    auth_risk_score: riskScore,
    auth_risk_class,
    auth_risk_reasons: reasons
  };
}

export function buildWordpressPhaseFNormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};

  const userRows = Array.isArray(inventory.user_rows) ? inventory.user_rows : [];
  const roleRows = Array.isArray(inventory.role_rows) ? inventory.role_rows : [];
  const authSurfaceRows = Array.isArray(inventory.auth_surface_rows)
    ? inventory.auth_surface_rows
    : [];

  const normalizedUserRows = userRows.map(row => {
    const risk = classifyWordpressUserPrivilegeRisk(row);
    return {
      ...row,
      roles: risk.normalized_roles,
      privilege_risk_score: risk.privilege_risk_score,
      privilege_risk_class: risk.privilege_risk_class,
      privilege_risk_reasons: risk.privilege_risk_reasons
    };
  });

  const normalizedRoleRows = roleRows.map(row => {
    const risk = classifyWordpressRolePrivilegeRisk(row);
    return {
      ...row,
      enabled_capabilities: risk.enabled_capabilities,
      privilege_risk_score: risk.privilege_risk_score,
      privilege_risk_class: risk.privilege_risk_class,
      privilege_risk_reasons: risk.privilege_risk_reasons
    };
  });

  const normalizedAuthSurfaceRows = authSurfaceRows.map(row => {
    const risk = classifyWordpressAuthSurfaceRisk(row);
    return {
      ...row,
      auth_value_normalized: risk.auth_value_normalized,
      auth_risk_score: risk.auth_risk_score,
      auth_risk_class: risk.auth_risk_class,
      auth_risk_reasons: risk.auth_risk_reasons
    };
  });

  const summary = {
    user_total_count: normalizedUserRows.length,
    user_high_risk_count: normalizedUserRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "high"
    ).length,
    user_medium_risk_count: normalizedUserRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "medium"
    ).length,
    role_total_count: normalizedRoleRows.length,
    role_high_risk_count: normalizedRoleRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "high"
    ).length,
    role_medium_risk_count: normalizedRoleRows.filter(
      x => String(x?.privilege_risk_class || "").trim() === "medium"
    ).length,
    auth_surface_total_count: normalizedAuthSurfaceRows.length,
    auth_surface_high_risk_count: normalizedAuthSurfaceRows.filter(
      x => String(x?.auth_risk_class || "").trim() === "high"
    ).length,
    auth_surface_medium_risk_count: normalizedAuthSurfaceRows.filter(
      x => String(x?.auth_risk_class || "").trim() === "medium"
    ).length
  };

  return {
    normalized_user_rows: normalizedUserRows,
    normalized_role_rows: normalizedRoleRows,
    normalized_auth_surface_rows: normalizedAuthSurfaceRows,
    risk_summary: summary
  };
}

export function buildWordpressPhaseFNormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_f_privilege_auth_strategy",
    artifact_version: "v1",
    phase_f_gate_status: String(gate.phase_f_gate_status || "").trim(),
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            user_total_count: 0,
            user_high_risk_count: 0,
            user_medium_risk_count: 0,
            role_total_count: 0,
            role_high_risk_count: 0,
            role_medium_risk_count: 0,
            auth_surface_total_count: 0,
            auth_surface_high_risk_count: 0,
            auth_surface_medium_risk_count: 0
          },
    normalized_user_rows: Array.isArray(normalizedInventory.normalized_user_rows)
      ? normalizedInventory.normalized_user_rows
      : [],
    normalized_role_rows: Array.isArray(normalizedInventory.normalized_role_rows)
      ? normalizedInventory.normalized_role_rows
      : [],
    normalized_auth_surface_rows: Array.isArray(
      normalizedInventory.normalized_auth_surface_rows
    )
      ? normalizedInventory.normalized_auth_surface_rows
      : [],
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseFReadinessGate(args = {}) {
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};

  const riskSummary =
    normalizedInventory?.risk_summary &&
    typeof normalizedInventory.risk_summary === "object"
      ? normalizedInventory.risk_summary
      : {};

  const blockingReasons = [...(phaseFGate.blocking_reasons || [])];

  if (phaseFPlan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }

  const userHighRiskCount = Number(riskSummary.user_high_risk_count || 0);
  const roleHighRiskCount = Number(riskSummary.role_high_risk_count || 0);
  const authHighRiskCount = Number(riskSummary.auth_surface_high_risk_count || 0);

  if (userHighRiskCount > 0) {
    blockingReasons.push("high_risk_users_present");
  }
  if (roleHighRiskCount > 0) {
    blockingReasons.push("high_risk_roles_present");
  }
  if (authHighRiskCount > 0) {
    blockingReasons.push("high_risk_auth_surface_present");
  }

  const readiness = blockingReasons.length === 0;

  return {
    readiness_status: readiness
      ? "ready_for_safe_users_roles_auth_reconciliation"
      : "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: readiness,
    user_high_risk_count: userHighRiskCount,
    role_high_risk_count: roleHighRiskCount,
    auth_high_risk_count: authHighRiskCount,
    user_medium_risk_count: Number(riskSummary.user_medium_risk_count || 0),
    role_medium_risk_count: Number(riskSummary.role_medium_risk_count || 0),
    auth_medium_risk_count: Number(riskSummary.auth_surface_medium_risk_count || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseFSafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 100));

  if (readiness.readiness_ready !== true) {
    return {
      safe_candidate_status: "blocked",
      candidate_count: 0,
      user_candidates: [],
      role_candidates: [],
      auth_surface_candidates: [],
      blocking_reasons: Array.isArray(readiness.blocking_reasons)
        ? readiness.blocking_reasons
        : ["phase_f_readiness_not_ready"]
    };
  }

  const normalizedUserRows = Array.isArray(normalizedInventory.normalized_user_rows)
    ? normalizedInventory.normalized_user_rows
    : [];
  const normalizedRoleRows = Array.isArray(normalizedInventory.normalized_role_rows)
    ? normalizedInventory.normalized_role_rows
    : [];
  const normalizedAuthRows = Array.isArray(normalizedInventory.normalized_auth_surface_rows)
    ? normalizedInventory.normalized_auth_surface_rows
    : [];

  const userCandidates = normalizedUserRows
    .filter(row => String(row?.privilege_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "user",
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      username: String(row?.username || "").trim(),
      display_name: String(row?.display_name || "").trim(),
      roles: Array.isArray(row?.roles) ? row.roles : [],
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      candidate_reason: "non_high_risk_user_candidate"
    }));

  const roleCandidates = normalizedRoleRows
    .filter(row => String(row?.privilege_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "role",
      role_key: String(row?.role_key || "").trim(),
      role_label: String(row?.role_label || "").trim(),
      enabled_capabilities: Array.isArray(row?.enabled_capabilities)
        ? row.enabled_capabilities
        : [],
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      candidate_reason: "non_high_risk_role_candidate"
    }));

  const authSurfaceCandidates = normalizedAuthRows
    .filter(row => String(row?.auth_risk_class || "").trim() !== "high")
    .slice(0, limit)
    .map(row => ({
      entity_type: "auth_surface",
      auth_key: String(row?.auth_key || "").trim(),
      auth_value_normalized: String(row?.auth_value_normalized || "").trim(),
      auth_risk_class: String(row?.auth_risk_class || "").trim(),
      candidate_reason: "non_high_risk_auth_surface_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count:
      userCandidates.length + roleCandidates.length + authSurfaceCandidates.length,
    user_candidates: userCandidates,
    role_candidates: roleCandidates,
    auth_surface_candidates: authSurfaceCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseFReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_f_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    user_high_risk_count: Number(readiness.user_high_risk_count || 0),
    role_high_risk_count: Number(readiness.role_high_risk_count || 0),
    auth_high_risk_count: Number(readiness.auth_high_risk_count || 0),
    user_medium_risk_count: Number(readiness.user_medium_risk_count || 0),
    role_medium_risk_count: Number(readiness.role_medium_risk_count || 0),
    auth_medium_risk_count: Number(readiness.auth_medium_risk_count || 0),
    safe_candidate_status: String(safeCandidates.safe_candidate_status || "").trim(),
    candidate_count: Number(safeCandidates.candidate_count || 0),
    user_candidates: Array.isArray(safeCandidates.user_candidates)
      ? safeCandidates.user_candidates
      : [],
    role_candidates: Array.isArray(safeCandidates.role_candidates)
      ? safeCandidates.role_candidates
      : [],
    auth_surface_candidates: Array.isArray(safeCandidates.auth_surface_candidates)
      ? safeCandidates.auth_surface_candidates
      : [],
    blocking_reasons: [
      ...(Array.isArray(readiness.blocking_reasons) ? readiness.blocking_reasons : []),
      ...(Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : [])
    ]
  };
}

export function buildWordpressUserReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "user",
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    username: String(row?.username || "").trim(),
    display_name: String(row?.display_name || "").trim(),
    roles: Array.isArray(row?.roles) ? row.roles : [],
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_mode: "safe_user_reconciliation_candidate",
    payload_shape: {
      username: "preserve_from_source",
      display_name: "preserve_from_source",
      roles: Array.isArray(row?.roles) ? row.roles : [],
      email: "review_before_apply"
    }
  };
}

export function buildWordpressRoleReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "role",
    role_key: String(row?.role_key || "").trim(),
    role_label: String(row?.role_label || "").trim(),
    enabled_capabilities: Array.isArray(row?.enabled_capabilities)
      ? row.enabled_capabilities
      : [],
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_mode: "safe_role_reconciliation_candidate",
    payload_shape: {
      role_key: String(row?.role_key || "").trim(),
      role_label: "preserve_from_source",
      enabled_capabilities: Array.isArray(row?.enabled_capabilities)
        ? row.enabled_capabilities
        : [],
      capability_merge_mode: "review_before_apply"
    }
  };
}

export function buildWordpressAuthSurfaceReconciliationPayloadRow(row = {}) {
  return {
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_value_normalized: String(row?.auth_value_normalized || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    payload_mode: "safe_auth_surface_reconciliation_candidate",
    payload_shape: {
      auth_key: String(row?.auth_key || "").trim(),
      auth_value: String(row?.auth_value_normalized || "").trim(),
      apply_mode: "review_before_apply"
    }
  };
}

export function buildWordpressPhaseFReconciliationPayloadPlanner(args = {}) {
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  if (String(safeCandidates.safe_candidate_status || "").trim() !== "ready") {
    return {
      payload_planner_status: "blocked",
      payload_count: 0,
      user_payload_rows: [],
      role_payload_rows: [],
      auth_surface_payload_rows: [],
      blocking_reasons: Array.isArray(safeCandidates.blocking_reasons)
        ? safeCandidates.blocking_reasons
        : ["phase_f_safe_candidates_not_ready"]
    };
  }

  const userCandidates = Array.isArray(safeCandidates.user_candidates)
    ? safeCandidates.user_candidates
    : [];
  const roleCandidates = Array.isArray(safeCandidates.role_candidates)
    ? safeCandidates.role_candidates
    : [];
  const authSurfaceCandidates = Array.isArray(safeCandidates.auth_surface_candidates)
    ? safeCandidates.auth_surface_candidates
    : [];

  const userPayloadRows = userCandidates.map(buildWordpressUserReconciliationPayloadRow);
  const rolePayloadRows = roleCandidates.map(buildWordpressRoleReconciliationPayloadRow);
  const authSurfacePayloadRows = authSurfaceCandidates.map(
    buildWordpressAuthSurfaceReconciliationPayloadRow
  );

  return {
    payload_planner_status: "ready",
    payload_count:
      userPayloadRows.length + rolePayloadRows.length + authSurfacePayloadRows.length,
    user_payload_rows: userPayloadRows,
    role_payload_rows: rolePayloadRows,
    auth_surface_payload_rows: authSurfacePayloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseFReconciliationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_f_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: String(planner.payload_planner_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    user_payload_rows: Array.isArray(planner.user_payload_rows)
      ? planner.user_payload_rows
      : [],
    role_payload_rows: Array.isArray(planner.role_payload_rows)
      ? planner.role_payload_rows
      : [],
    auth_surface_payload_rows: Array.isArray(planner.auth_surface_payload_rows)
      ? planner.auth_surface_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseFExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const usersRolesAuth =
    migration.users_roles_auth && typeof migration.users_roles_auth === "object"
      ? migration.users_roles_auth
      : {};
  const execution =
    usersRolesAuth.execution && typeof usersRolesAuth.execution === "object"
      ? usersRolesAuth.execution
      : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 100))
  };
}

export function buildWordpressPhaseFExecutionGuard(args = {}) {
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
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

  if (phaseFPlan.enabled !== true) {
    blockingReasons.push("phase_f_not_enabled");
  }
  if (phaseFGate.phase_f_gate_ready !== true) {
    blockingReasons.push("phase_f_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_f_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_f_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_f_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_f_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseFPlan.inventory_only === true && phaseFPlan.apply === true) {
    blockingReasons.push("phase_f_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_users_roles_auth_reconciliation_execution"
      : "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseFExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_f_execution_guard",
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

export function buildWordpressPhaseFMutationCandidateSelector(args = {}) {
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
      selected_user_candidates: [],
      selected_role_candidates: [],
      selected_auth_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(executionGuard.blocking_reasons)
        ? executionGuard.blocking_reasons
        : ["phase_f_execution_guard_not_ready"]
    };
  }

  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    return {
      selector_status: "blocked",
      selected_count: 0,
      rejected_count: 0,
      selected_user_candidates: [],
      selected_role_candidates: [],
      selected_auth_surface_candidates: [],
      rejected_candidates: [],
      blocking_reasons: Array.isArray(payloadPlanner.blocking_reasons)
        ? payloadPlanner.blocking_reasons
        : ["phase_f_payload_planner_not_ready"]
    };
  }

  const userPayloadRows = Array.isArray(payloadPlanner.user_payload_rows)
    ? payloadPlanner.user_payload_rows
    : [];
  const rolePayloadRows = Array.isArray(payloadPlanner.role_payload_rows)
    ? payloadPlanner.role_payload_rows
    : [];
  const authSurfacePayloadRows = Array.isArray(payloadPlanner.auth_surface_payload_rows)
    ? payloadPlanner.auth_surface_payload_rows
    : [];

  const selectedUserCandidates = [];
  const selectedRoleCandidates = [];
  const selectedAuthSurfaceCandidates = [];
  const rejectedCandidates = [];

  for (const row of userPayloadRows) {
    const privilegeRiskClass = String(row?.privilege_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (privilegeRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "user",
        source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
        username: String(row?.username || "").trim(),
        rejection_reason: "high_risk_user_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_user_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "user",
        source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
        username: String(row?.username || "").trim(),
        rejection_reason: "unsupported_user_payload_mode"
      });
      continue;
    }

    selectedUserCandidates.push({
      ...row,
      candidate_reason: "safe_user_candidate_ready_for_mutation"
    });
  }

  for (const row of rolePayloadRows) {
    const privilegeRiskClass = String(row?.privilege_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (privilegeRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "role",
        role_key: String(row?.role_key || "").trim(),
        rejection_reason: "high_risk_role_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_role_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "role",
        role_key: String(row?.role_key || "").trim(),
        rejection_reason: "unsupported_role_payload_mode"
      });
      continue;
    }

    selectedRoleCandidates.push({
      ...row,
      candidate_reason: "safe_role_candidate_ready_for_mutation"
    });
  }

  for (const row of authSurfacePayloadRows) {
    const authRiskClass = String(row?.auth_risk_class || "").trim();
    const payloadMode = String(row?.payload_mode || "").trim();

    if (authRiskClass === "high") {
      rejectedCandidates.push({
        entity_type: "auth_surface",
        auth_key: String(row?.auth_key || "").trim(),
        rejection_reason: "high_risk_auth_surface_not_allowed"
      });
      continue;
    }

    if (payloadMode !== "safe_auth_surface_reconciliation_candidate") {
      rejectedCandidates.push({
        entity_type: "auth_surface",
        auth_key: String(row?.auth_key || "").trim(),
        rejection_reason: "unsupported_auth_surface_payload_mode"
      });
      continue;
    }

    selectedAuthSurfaceCandidates.push({
      ...row,
      candidate_reason: "safe_auth_surface_candidate_ready_for_mutation"
    });
  }

  const candidateLimit = Math.max(1, Number(executionPlan.candidate_limit || 100));
  const limitedSelectedUserCandidates = selectedUserCandidates.slice(0, candidateLimit);
  const limitedSelectedRoleCandidates = selectedRoleCandidates.slice(0, candidateLimit);
  const limitedSelectedAuthSurfaceCandidates =
    selectedAuthSurfaceCandidates.slice(0, candidateLimit);

  return {
    selector_status: "ready",
    selected_count:
      limitedSelectedUserCandidates.length +
      limitedSelectedRoleCandidates.length +
      limitedSelectedAuthSurfaceCandidates.length,
    rejected_count: rejectedCandidates.length,
    selected_user_candidates: limitedSelectedUserCandidates,
    selected_role_candidates: limitedSelectedRoleCandidates,
    selected_auth_surface_candidates: limitedSelectedAuthSurfaceCandidates,
    rejected_candidates: rejectedCandidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseFMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_f_mutation_candidates",
    artifact_version: "v1",
    selector_status: String(selector.selector_status || "").trim(),
    selected_count: Number(selector.selected_count || 0),
    rejected_count: Number(selector.rejected_count || 0),
    selected_user_candidates: Array.isArray(selector.selected_user_candidates)
      ? selector.selected_user_candidates
      : [],
    selected_role_candidates: Array.isArray(selector.selected_role_candidates)
      ? selector.selected_role_candidates
      : [],
    selected_auth_surface_candidates: Array.isArray(
      selector.selected_auth_surface_candidates
    )
      ? selector.selected_auth_surface_candidates
      : [],
    rejected_candidates: Array.isArray(selector.rejected_candidates)
      ? selector.rejected_candidates
      : [],
    blocking_reasons: Array.isArray(selector.blocking_reasons)
      ? selector.blocking_reasons
      : []
  };
}

export function buildWordpressUserMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_user_reconciliation",
    target_scope: "destination_wordpress_user",
    payload: {
      username: Object.prototype.hasOwnProperty.call(payloadShape, "username")
        ? payloadShape.username
        : "preserve_from_source",
      display_name: Object.prototype.hasOwnProperty.call(payloadShape, "display_name")
        ? payloadShape.display_name
        : "preserve_from_source",
      roles: Array.isArray(payloadShape.roles) ? payloadShape.roles : [],
      email: Object.prototype.hasOwnProperty.call(payloadShape, "email")
        ? payloadShape.email
        : "review_before_apply"
    }
  };
}

export function buildWordpressRoleMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_role_reconciliation",
    target_scope: "destination_wordpress_role",
    payload: {
      role_key: Object.prototype.hasOwnProperty.call(payloadShape, "role_key")
        ? payloadShape.role_key
        : String(row?.role_key || "").trim(),
      role_label: Object.prototype.hasOwnProperty.call(payloadShape, "role_label")
        ? payloadShape.role_label
        : "preserve_from_source",
      enabled_capabilities: Array.isArray(payloadShape.enabled_capabilities)
        ? payloadShape.enabled_capabilities
        : [],
      capability_merge_mode: Object.prototype.hasOwnProperty.call(
        payloadShape,
        "capability_merge_mode"
      )
        ? payloadShape.capability_merge_mode
        : "review_before_apply"
    }
  };
}

export function buildWordpressAuthSurfaceMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_auth_surface_reconciliation",
    target_scope: "destination_wordpress_auth_surface",
    payload: {
      auth_key: Object.prototype.hasOwnProperty.call(payloadShape, "auth_key")
        ? payloadShape.auth_key
        : String(row?.auth_key || "").trim(),
      auth_value: Object.prototype.hasOwnProperty.call(payloadShape, "auth_value")
        ? payloadShape.auth_value
        : String(row?.auth_value_normalized || "").trim(),
      apply_mode: Object.prototype.hasOwnProperty.call(payloadShape, "apply_mode")
        ? payloadShape.apply_mode
        : "review_before_apply"
    }
  };
}

export function buildWordpressPhaseFMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      user_composed_payloads: [],
      role_composed_payloads: [],
      auth_surface_composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_f_mutation_candidates_not_ready"]
    };
  }

  const selectedUserCandidates = Array.isArray(selector.selected_user_candidates)
    ? selector.selected_user_candidates
    : [];
  const selectedRoleCandidates = Array.isArray(selector.selected_role_candidates)
    ? selector.selected_role_candidates
    : [];
  const selectedAuthSurfaceCandidates = Array.isArray(
    selector.selected_auth_surface_candidates
  )
    ? selector.selected_auth_surface_candidates
    : [];

  const userComposedPayloads = selectedUserCandidates.map(row => ({
    entity_type: "user",
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    username: String(row?.username || "").trim(),
    display_name: String(row?.display_name || "").trim(),
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_reason: "composed_from_safe_user_candidate",
    mutation_payload: buildWordpressUserMutationPayloadFromCandidate(row)
  }));

  const roleComposedPayloads = selectedRoleCandidates.map(row => ({
    entity_type: "role",
    role_key: String(row?.role_key || "").trim(),
    role_label: String(row?.role_label || "").trim(),
    privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
    payload_reason: "composed_from_safe_role_candidate",
    mutation_payload: buildWordpressRoleMutationPayloadFromCandidate(row)
  }));

  const authSurfaceComposedPayloads = selectedAuthSurfaceCandidates.map(row => ({
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    payload_reason: "composed_from_safe_auth_surface_candidate",
    mutation_payload: buildWordpressAuthSurfaceMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count:
      userComposedPayloads.length +
      roleComposedPayloads.length +
      authSurfaceComposedPayloads.length,
    user_composed_payloads: userComposedPayloads,
    role_composed_payloads: roleComposedPayloads,
    auth_surface_composed_payloads: authSurfaceComposedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseFMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_f_mutation_payloads",
    artifact_version: "v1",
    composer_status: String(composer.composer_status || "").trim(),
    payload_count: Number(composer.payload_count || 0),
    user_composed_payloads: Array.isArray(composer.user_composed_payloads)
      ? composer.user_composed_payloads
      : [],
    role_composed_payloads: Array.isArray(composer.role_composed_payloads)
      ? composer.role_composed_payloads
      : [],
    auth_surface_composed_payloads: Array.isArray(
      composer.auth_surface_composed_payloads
    )
      ? composer.auth_surface_composed_payloads
      : [],
    blocking_reasons: Array.isArray(composer.blocking_reasons)
      ? composer.blocking_reasons
      : []
  };
}

export function simulateWordpressUsersRolesAuthDryRunRow(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  const entityType = String(row?.entity_type || "").trim();

  if (entityType === "user") {
    return {
      entity_type: "user",
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      username: String(row?.username || "").trim(),
      display_name: String(row?.display_name || "").trim(),
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_username_mode: String(payload.username || "").trim(),
        expected_display_name_mode: String(payload.display_name || "").trim(),
        expected_roles_count: Array.isArray(payload.roles) ? payload.roles.length : 0,
        expected_email_mode: String(payload.email || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  if (entityType === "role") {
    return {
      entity_type: "role",
      role_key: String(row?.role_key || "").trim(),
      role_label: String(row?.role_label || "").trim(),
      privilege_risk_class: String(row?.privilege_risk_class || "").trim(),
      dry_run_result: "simulated_ready",
      evidence_preview: {
        mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
        target_scope: String(mutationPayload.target_scope || "").trim(),
        expected_role_key: String(payload.role_key || "").trim(),
        expected_role_label_mode: String(payload.role_label || "").trim(),
        expected_capabilities_count: Array.isArray(payload.enabled_capabilities)
          ? payload.enabled_capabilities.length
          : 0,
        expected_capability_merge_mode: String(payload.capability_merge_mode || "").trim()
      },
      preview_payload: mutationPayload
    };
  }

  return {
    entity_type: "auth_surface",
    auth_key: String(row?.auth_key || "").trim(),
    auth_risk_class: String(row?.auth_risk_class || "").trim(),
    dry_run_result: "simulated_ready",
    evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_auth_key: String(payload.auth_key || "").trim(),
      expected_auth_value: String(payload.auth_value || "").trim(),
      expected_apply_mode: String(payload.apply_mode || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseFDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_user_rows: [],
      simulated_role_rows: [],
      simulated_auth_surface_rows: [],
      evidence_preview_summary: {
        total_rows: 0,
        user_rows: 0,
        role_rows: 0,
        auth_surface_rows: 0,
        review_before_apply_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_f_mutation_payloads_not_ready"]
    };
  }

  const userRows = Array.isArray(composer.user_composed_payloads)
    ? composer.user_composed_payloads
    : [];
  const roleRows = Array.isArray(composer.role_composed_payloads)
    ? composer.role_composed_payloads
    : [];
  const authSurfaceRows = Array.isArray(composer.auth_surface_composed_payloads)
    ? composer.auth_surface_composed_payloads
    : [];

  const simulatedUserRows = userRows.map(simulateWordpressUsersRolesAuthDryRunRow);
  const simulatedRoleRows = roleRows.map(simulateWordpressUsersRolesAuthDryRunRow);
  const simulatedAuthSurfaceRows = authSurfaceRows.map(
    simulateWordpressUsersRolesAuthDryRunRow
  );

  const allRows = [
    ...simulatedUserRows,
    ...simulatedRoleRows,
    ...simulatedAuthSurfaceRows
  ];

  const summary = allRows.reduce(
    (acc, row) => {
      acc.total_rows += 1;

      const entityType = String(row?.entity_type || "").trim();
      if (entityType === "user") acc.user_rows += 1;
      else if (entityType === "role") acc.role_rows += 1;
      else if (entityType === "auth_surface") acc.auth_surface_rows += 1;

      const preview =
        row?.evidence_preview && typeof row.evidence_preview === "object"
          ? row.evidence_preview
          : {};

      if (
        String(preview.expected_email_mode || "").trim() === "review_before_apply" ||
        String(preview.expected_capability_merge_mode || "").trim() ===
          "review_before_apply" ||
        String(preview.expected_apply_mode || "").trim() === "review_before_apply"
      ) {
        acc.review_before_apply_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: allRows.length,
    simulated_user_rows: simulatedUserRows,
    simulated_role_rows: simulatedRoleRows,
    simulated_auth_surface_rows: simulatedAuthSurfaceRows,
    evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseFDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_f_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_user_rows: Array.isArray(simulator.simulated_user_rows)
      ? simulator.simulated_user_rows
      : [],
    simulated_role_rows: Array.isArray(simulator.simulated_role_rows)
      ? simulator.simulated_role_rows
      : [],
    simulated_auth_surface_rows: Array.isArray(simulator.simulated_auth_surface_rows)
      ? simulator.simulated_auth_surface_rows
      : [],
    evidence_preview_summary:
      simulator?.evidence_preview_summary &&
      typeof simulator.evidence_preview_summary === "object"
        ? simulator.evidence_preview_summary
        : {
            total_rows: 0,
            user_rows: 0,
            role_rows: 0,
            auth_surface_rows: 0,
            review_before_apply_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseFFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseFPlan =
    args.phaseFPlan && typeof args.phaseFPlan === "object" ? args.phaseFPlan : {};
  const phaseFGate =
    args.phaseFGate && typeof args.phaseFGate === "object" ? args.phaseFGate : {};
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
    artifact_type: "wordpress_phase_f_final_operator_handoff",
    artifact_version: "v1",
    phase_f_enabled: phaseFPlan.enabled === true,
    phase_f_inventory_only: phaseFPlan.inventory_only === true,
    phase_f_apply_requested: phaseFPlan.apply === true,
    requested_auth_scope: {
      include_users: phaseFPlan.include_users === true,
      include_roles: phaseFPlan.include_roles === true,
      include_auth_surface: phaseFPlan.include_auth_surface === true,
      max_users: Number(phaseFPlan.max_users || 0)
    },
    requested_auth_config:
      migration?.users_roles_auth && typeof migration.users_roles_auth === "object"
        ? migration.users_roles_auth
        : {},
    phase_f_gate_status: String(phaseFGate.phase_f_gate_status || "").trim(),
    phase_f_inventory_status: String(inventoryArtifact.phase_f_inventory_status || "").trim(),
    phase_f_strategy_status: String(
      normalizedInventoryArtifact.phase_f_gate_status || ""
    ).trim(),
    phase_f_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_f_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_f_payload_planner_status: String(
      reconciliationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_f_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_f_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_f_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_f_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            user_count: 0,
            privileged_user_count: 0,
            role_count: 0,
            privileged_role_count: 0,
            auth_surface_count: 0
          },
    risk_summary:
      normalizedInventory?.risk_summary &&
      typeof normalizedInventory.risk_summary === "object"
        ? normalizedInventory.risk_summary
        : {
            user_total_count: 0,
            user_high_risk_count: 0,
            user_medium_risk_count: 0,
            role_total_count: 0,
            role_high_risk_count: 0,
            role_medium_risk_count: 0,
            auth_surface_total_count: 0,
            auth_surface_high_risk_count: 0,
            auth_surface_medium_risk_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseFGate.blocking_reasons) ? phaseFGate.blocking_reasons : []),
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
        ? "review_safe_users_roles_auth_candidates"
        : "resolve_users_roles_auth_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_users_roles_auth_reconciliation_execution"
        ? "approve_users_roles_auth_mutation_trial"
        : "hold_users_roles_auth_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_users_roles_auth_dry_run_preview"
        : "no_users_roles_auth_dry_run_preview_available"
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
