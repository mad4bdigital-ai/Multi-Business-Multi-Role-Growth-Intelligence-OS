// Auto-extracted from server.js — do not edit manually, use domain logic here.

export function normalizeWordpressBuilderType(value = "") {
  return normalizeWordpressPhaseAType(value);
}

export function isWordpressPhaseBBuilderType(value = "") {
  return WORDPRESS_PHASE_B_BUILDER_TYPES.has(
    normalizeWordpressBuilderType(value)
  );
}

export function resolveWordpressPhaseBPlan(payload = {}) {
  const migration = payload?.migration || {};
  const builder = migration.builder_assets && typeof migration.builder_assets === "object"
    ? migration.builder_assets
    : {};

  const requestedTypes = Array.isArray(builder.post_types)
    ? builder.post_types.map(x => normalizeWordpressBuilderType(x)).filter(Boolean)
    : ["elementor_library", "wp_template", "wp_template_part", "wp_navigation"];

  const normalizedTypes = requestedTypes.filter(isWordpressPhaseBBuilderType);

  return {
    enabled: builder.enabled === true,
    audit_only: builder.audit_only === undefined ? true : builder.audit_only === true,
    apply: builder.apply === true,
    post_types: normalizedTypes,
    max_items_per_type: Math.max(1, toPositiveInt(builder.max_items_per_type, 250)),
    dependency_scan_enabled:
      builder.dependency_scan_enabled === undefined
        ? true
        : builder.dependency_scan_enabled === true,
    include_inactive:
      builder.include_inactive === true
  };
}

export function assertWordpressPhaseBPlan(plan = {}) {
  if (plan.enabled !== true) {
    return {
      phase_b_status: "disabled",
      phase_b_ready: false,
      blocking_reasons: ["phase_b_not_enabled"]
    };
  }

  const blockingReasons = [];

  if (plan.apply === true && plan.audit_only === true) {
    blockingReasons.push("phase_b_apply_conflicts_with_audit_only");
  }

  if (!Array.isArray(plan.post_types) || plan.post_types.length === 0) {
    blockingReasons.push("phase_b_no_supported_builder_types");
  }

  return {
    phase_b_status:
      blockingReasons.length === 0 ? "audit_ready" : "blocked",
    phase_b_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function inferWordpressBuilderDependencies(item = {}) {
  const raw = JSON.stringify(item || {});

  const signals = {
    uses_elementor_data:
      raw.includes("_elementor_data") || raw.includes("elementor"),
    uses_template_conditions:
      raw.includes("display_conditions") || raw.includes("location"),
    uses_popup_rules:
      raw.includes("popup") || raw.includes("triggers") || raw.includes("conditions"),
    uses_navigation_refs:
      raw.includes("wp_navigation") || raw.includes("navigation"),
    uses_theme_json_refs:
      raw.includes("theme.json") || raw.includes("template_part"),
    uses_global_widget_refs:
      raw.includes("global_widget") || raw.includes("widgetType"),
    uses_shortcode_like_refs:
      raw.includes("[") && raw.includes("]")
  };

  return {
    dependency_flags: signals,
    dependency_count: Object.values(signals).filter(v => v === true).length
  };
}

export function buildWordpressBuilderAuditRow(args = {}) {
  const item = args.item || {};
  const postType = normalizeWordpressBuilderType(args.postType);
  const deps = inferWordpressBuilderDependencies(item);
  const refs = extractWordpressBuilderCrossReferences(item);

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
    dependency_count: deps.dependency_count,
    dependency_flags: deps.dependency_flags,
    cross_references: refs,
    cross_reference_counts: {
      template_ids: refs.template_ids.length,
      widget_ids: refs.widget_ids.length,
      navigation_ids: refs.navigation_ids.length,
      popup_ids: refs.popup_ids.length,
      shortcode_tags: refs.shortcode_tags.length
    },
    audit_classification:
      deps.dependency_count > 0 ? "dependency_review_required" : "low_dependency_asset",
    migration_candidate: true
  };
}

export function buildWordpressBuilderPhaseBGate(args = {}) {
  const phaseARecommendation =
    args.phaseAFinalCutoverRecommendation &&
    typeof args.phaseAFinalCutoverRecommendation === "object"
      ? args.phaseAFinalCutoverRecommendation
      : {};
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object"
      ? args.phaseBPlan
      : {};
  const phaseBPlanStatus =
    args.phaseBPlanStatus && typeof args.phaseBPlanStatus === "object"
      ? args.phaseBPlanStatus
      : {};

  const blockingReasons = [...(phaseBPlanStatus.blocking_reasons || [])];

  if (
    String(phaseARecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_b");
  }

  return {
    phase_b_gate_status:
      blockingReasons.length === 0 ? "ready_for_builder_audit" : "blocked",
    phase_b_gate_ready: blockingReasons.length === 0,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    blocking_reasons: blockingReasons
  };
}

export function normalizeWordpressBuilderDependencyFlags(flags = {}) {
  const safeFlags = flags && typeof flags === "object" && !Array.isArray(flags)
    ? flags
    : {};

  return {
    uses_elementor_data: safeFlags.uses_elementor_data === true,
    uses_template_conditions: safeFlags.uses_template_conditions === true,
    uses_popup_rules: safeFlags.uses_popup_rules === true,
    uses_navigation_refs: safeFlags.uses_navigation_refs === true,
    uses_theme_json_refs: safeFlags.uses_theme_json_refs === true,
    uses_global_widget_refs: safeFlags.uses_global_widget_refs === true,
    uses_shortcode_like_refs: safeFlags.uses_shortcode_like_refs === true
  };
}

export function classifyWordpressBuilderDependencyRisk(row = {}) {
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const flags = normalizeWordpressBuilderDependencyFlags(row?.dependency_flags || {});

  let riskScore = 0;
  const reasons = [];

  if (flags.uses_elementor_data) {
    riskScore += 3;
    reasons.push("elementor_data_present");
  }
  if (flags.uses_template_conditions) {
    riskScore += 2;
    reasons.push("template_conditions_present");
  }
  if (flags.uses_popup_rules) {
    riskScore += 3;
    reasons.push("popup_rules_present");
  }
  if (flags.uses_navigation_refs) {
    riskScore += 2;
    reasons.push("navigation_refs_present");
  }
  if (flags.uses_theme_json_refs) {
    riskScore += 2;
    reasons.push("theme_json_refs_present");
  }
  if (flags.uses_global_widget_refs) {
    riskScore += 2;
    reasons.push("global_widget_refs_present");
  }
  if (flags.uses_shortcode_like_refs) {
    riskScore += 1;
    reasons.push("shortcode_like_refs_present");
  }

  if (postType === "popup") {
    riskScore += 2;
    reasons.push("popup_post_type");
  }
  if (postType === "wp_template" || postType === "wp_template_part") {
    riskScore += 2;
    reasons.push("theme_template_post_type");
  }
  if (postType === "elementor_library") {
    riskScore += 1;
    reasons.push("elementor_library_post_type");
  }

  let riskClass = "low";
  if (riskScore >= 7) riskClass = "high";
  else if (riskScore >= 4) riskClass = "medium";

  return {
    normalized_dependency_flags: flags,
    dependency_risk_score: riskScore,
    dependency_risk_class: riskClass,
    dependency_risk_reasons: reasons
  };
}

export function buildWordpressPhaseBDependencySummary(auditRows = []) {
  const rows = Array.isArray(auditRows) ? auditRows : [];
  const byType = new Map();

  for (const row of rows) {
    const postType = normalizeWordpressBuilderType(row?.post_type || "");
    if (!byType.has(postType)) {
      byType.set(postType, {
        post_type: postType,
        total_count: 0,
        low_risk_count: 0,
        medium_risk_count: 0,
        high_risk_count: 0,
        dependency_review_required_count: 0
      });
    }

    const bucket = byType.get(postType);
    bucket.total_count += 1;

    const riskClass = String(row?.dependency_risk_class || "").trim();
    if (riskClass === "high") bucket.high_risk_count += 1;
    else if (riskClass === "medium") bucket.medium_risk_count += 1;
    else bucket.low_risk_count += 1;

    if (String(row?.audit_classification || "").trim() === "dependency_review_required") {
      bucket.dependency_review_required_count += 1;
    }
  }

  return [...byType.values()];
}

export function classifyWordpressBuilderAssetFamily(postType = "") {
  const normalized = normalizeWordpressBuilderType(postType);

  if (normalized === "elementor_library") {
    return "elementor_assets";
  }
  if (normalized === "wp_template" || normalized === "wp_template_part") {
    return "theme_templates";
  }
  if (normalized === "wp_navigation") {
    return "navigation_assets";
  }
  if (normalized === "popup") {
    return "popup_assets";
  }
  if (normalized === "global_widget") {
    return "global_widget_assets";
  }
  if (normalized === "wp_block" || normalized === "reusable_block") {
    return "reusable_block_assets";
  }

  return "other_builder_assets";
}

export function classifyWordpressBuilderMigrationBucket(row = {}) {
  const family = classifyWordpressBuilderAssetFamily(row?.post_type || "");
  const riskClass = String(row?.dependency_risk_class || "").trim();
  const auditClass = String(row?.audit_classification || "").trim();

  let bucket = "manual_review";
  let bucketReason = "default_manual_review";

  if (riskClass === "low" && auditClass !== "dependency_review_required") {
    bucket = "candidate_low_complexity";
    bucketReason = "low_risk_low_dependency";
  } else if (riskClass === "low") {
    bucket = "candidate_reviewed_low_risk";
    bucketReason = "low_risk_but_dependency_review_required";
  } else if (riskClass === "medium") {
    bucket = "staged_dependency_review";
    bucketReason = "medium_risk_requires_mapping_review";
  } else if (riskClass === "high") {
    bucket = "blocked_high_dependency";
    bucketReason = "high_risk_dependency_profile";
  }

  if (family === "popup_assets" && bucket !== "blocked_high_dependency") {
    bucket = "staged_dependency_review";
    bucketReason = "popup_assets_require_rule_review";
  }

  if (family === "theme_templates" && riskClass !== "low") {
    bucket = "blocked_high_dependency";
    bucketReason = "theme_templates_not_safe_without_deep_review";
  }

  return {
    asset_family: family,
    migration_bucket: bucket,
    migration_bucket_reason: bucketReason
  };
}

export function buildWordpressPhaseBFamilySummary(normalizedAuditRows = []) {
  const rows = Array.isArray(normalizedAuditRows) ? normalizedAuditRows : [];
  const byFamily = new Map();

  for (const row of rows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";

    if (!byFamily.has(family)) {
      byFamily.set(family, {
        asset_family: family,
        total_count: 0,
        candidate_low_complexity_count: 0,
        candidate_reviewed_low_risk_count: 0,
        staged_dependency_review_count: 0,
        blocked_high_dependency_count: 0,
        manual_review_count: 0
      });
    }

    const bucket = byFamily.get(family);
    bucket.total_count += 1;

    const migrationBucket = String(row?.migration_bucket || "").trim();
    if (migrationBucket === "candidate_low_complexity") {
      bucket.candidate_low_complexity_count += 1;
    } else if (migrationBucket === "candidate_reviewed_low_risk") {
      bucket.candidate_reviewed_low_risk_count += 1;
    } else if (migrationBucket === "staged_dependency_review") {
      bucket.staged_dependency_review_count += 1;
    } else if (migrationBucket === "blocked_high_dependency") {
      bucket.blocked_high_dependency_count += 1;
    } else {
      bucket.manual_review_count += 1;
    }
  }

  return [...byFamily.values()];
}

export function buildWordpressPhaseBMigrationBuckets(normalizedAuditRows = []) {
  const rows = Array.isArray(normalizedAuditRows) ? normalizedAuditRows : [];
  const buckets = {
    candidate_low_complexity: [],
    candidate_reviewed_low_risk: [],
    staged_dependency_review: [],
    blocked_high_dependency: [],
    manual_review: []
  };

  for (const row of rows) {
    const key = String(row?.migration_bucket || "").trim();
    if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
      buckets.manual_review.push(row);
      continue;
    }
    buckets[key].push(row);
  }

  return buckets;
}

export function extractWordpressBuilderCrossReferences(item = {}) {
  const raw = JSON.stringify(item || {});

  const patterns = {
    template_ids: [
      /template[_-]?id["':=\s]+(\d+)/gi,
      /templateId["':=\s]+(\d+)/gi
    ],
    widget_ids: [
      /widget[_-]?id["':=\s]+(\d+)/gi,
      /global[_-]?widget["':=\s]+(\d+)/gi
    ],
    navigation_ids: [
      /navigation[_-]?id["':=\s]+(\d+)/gi,
      /menu[_-]?id["':=\s]+(\d+)/gi
    ],
    popup_ids: [
      /popup[_-]?id["':=\s]+(\d+)/gi,
      /trigger[_-]?popup["':=\s]+(\d+)/gi
    ],
    shortcode_tags: [
      /\[([a-zA-Z0-9_\-]+)(?:\s|\])/g
    ]
  };

  const out = {
    template_ids: [],
    widget_ids: [],
    navigation_ids: [],
    popup_ids: [],
    shortcode_tags: []
  };

  for (const [key, regexList] of Object.entries(patterns)) {
    const values = new Set();
    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(raw)) !== null) {
        const v = String(match[1] || "").trim();
        if (!v) continue;
        values.add(v);
      }
    }
    out[key] = [...values];
  }

  return out;
}

export function summarizeWordpressBuilderCrossReferences(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const summary = {
    total_rows: safeRows.length,
    rows_with_template_refs: 0,
    rows_with_widget_refs: 0,
    rows_with_navigation_refs: 0,
    rows_with_popup_refs: 0,
    rows_with_shortcode_refs: 0
  };

  for (const row of safeRows) {
    if ((row?.cross_reference_counts?.template_ids || 0) > 0) {
      summary.rows_with_template_refs += 1;
    }
    if ((row?.cross_reference_counts?.widget_ids || 0) > 0) {
      summary.rows_with_widget_refs += 1;
    }
    if ((row?.cross_reference_counts?.navigation_ids || 0) > 0) {
      summary.rows_with_navigation_refs += 1;
    }
    if ((row?.cross_reference_counts?.popup_ids || 0) > 0) {
      summary.rows_with_popup_refs += 1;
    }
    if ((row?.cross_reference_counts?.shortcode_tags || 0) > 0) {
      summary.rows_with_shortcode_refs += 1;
    }
  }

  return summary;
}

export function buildWordpressBuilderNodeKey(row = {}) {
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const sourceId = Number(row?.source_id);
  if (!postType || !Number.isFinite(sourceId)) return "";
  return `${postType}:${sourceId}`;
}

export function buildWordpressBuilderReferenceIndex(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const byNodeKey = {};
  const bySourceId = {};

  for (const row of safeRows) {
    const nodeKey = buildWordpressBuilderNodeKey(row);
    const sourceId = Number(row?.source_id);

    if (nodeKey) {
      byNodeKey[nodeKey] = {
        node_key: nodeKey,
        post_type: normalizeWordpressBuilderType(row?.post_type || ""),
        source_id: Number.isFinite(sourceId) ? sourceId : null,
        slug: String(row?.slug || "").trim(),
        asset_family: String(row?.asset_family || "").trim(),
        migration_bucket: String(row?.migration_bucket || "").trim()
      };
    }

    if (Number.isFinite(sourceId)) {
      if (!bySourceId[String(sourceId)]) bySourceId[String(sourceId)] = [];
      bySourceId[String(sourceId)].push({
        node_key: nodeKey,
        post_type: normalizeWordpressBuilderType(row?.post_type || ""),
        source_id: sourceId,
        slug: String(row?.slug || "").trim()
      });
    }
  }

  return {
    by_node_key: byNodeKey,
    by_source_id: bySourceId
  };
}

export function buildWordpressBuilderDependencyEdges(rows = [], referenceIndex = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const bySourceId =
    referenceIndex && typeof referenceIndex === "object" && referenceIndex.by_source_id
      ? referenceIndex.by_source_id
      : {};

  const edges = [];
  const unresolved = [];

  const refKinds = [
    ["template_ids", "template_ref"],
    ["widget_ids", "widget_ref"],
    ["navigation_ids", "navigation_ref"],
    ["popup_ids", "popup_ref"]
  ];

  for (const row of safeRows) {
    const fromNode = buildWordpressBuilderNodeKey(row);
    if (!fromNode) continue;

    const refs =
      row?.cross_references && typeof row.cross_references === "object"
        ? row.cross_references
        : {};

    for (const [field, relation] of refKinds) {
      const ids = Array.isArray(refs[field]) ? refs[field] : [];

      for (const rawId of ids) {
        const refId = String(rawId || "").trim();
        if (!refId) continue;

        const matches = Array.isArray(bySourceId[refId]) ? bySourceId[refId] : [];
        if (matches.length === 0) {
          unresolved.push({
            from_node_key: fromNode,
            from_post_type: normalizeWordpressBuilderType(row?.post_type || ""),
            from_source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
            from_slug: String(row?.slug || "").trim(),
            reference_type: relation,
            referenced_source_id: Number(refId) || null,
            unresolved_reason: "missing_target_in_phase_b_inventory"
          });
          continue;
        }

        for (const match of matches) {
          edges.push({
            from_node_key: fromNode,
            from_post_type: normalizeWordpressBuilderType(row?.post_type || ""),
            from_source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
            from_slug: String(row?.slug || "").trim(),
            to_node_key: String(match.node_key || "").trim(),
            to_post_type: String(match.post_type || "").trim(),
            to_source_id: Number.isFinite(Number(match.source_id)) ? Number(match.source_id) : null,
            to_slug: String(match.slug || "").trim(),
            reference_type: relation
          });
        }
      }
    }
  }

  return {
    edges,
    unresolved
  };
}

export function summarizeWordpressBuilderDependencyGraph(args = {}) {
  const edges = Array.isArray(args.edges) ? args.edges : [];
  const unresolved = Array.isArray(args.unresolved) ? args.unresolved : [];

  const byRelation = {};
  for (const edge of edges) {
    const relation = String(edge?.reference_type || "").trim() || "unknown";
    byRelation[relation] = (byRelation[relation] || 0) + 1;
  }

  const unresolvedByRelation = {};
  for (const row of unresolved) {
    const relation = String(row?.reference_type || "").trim() || "unknown";
    unresolvedByRelation[relation] = (unresolvedByRelation[relation] || 0) + 1;
  }

  return {
    edge_count: edges.length,
    unresolved_count: unresolved.length,
    relation_counts: byRelation,
    unresolved_relation_counts: unresolvedByRelation
  };
}

export function evaluateWordpressPhaseBGraphStability(args = {}) {
  const dependencyGraphSummary =
    args.dependencyGraphSummary &&
    typeof args.dependencyGraphSummary === "object"
      ? args.dependencyGraphSummary
      : {};
  const normalizedAuditRows = Array.isArray(args.normalizedAuditRows)
    ? args.normalizedAuditRows
    : [];
  const migrationBuckets =
    args.migrationBuckets && typeof args.migrationBuckets === "object"
      ? args.migrationBuckets
      : {};

  const unresolvedCount = Number(dependencyGraphSummary.unresolved_count || 0);
  const highRiskCount = normalizedAuditRows.filter(
    row => String(row?.dependency_risk_class || "").trim() === "high"
  ).length;
  const blockedBucketCount = Array.isArray(migrationBuckets.blocked_high_dependency)
    ? migrationBuckets.blocked_high_dependency.length
    : 0;
  const stagedBucketCount = Array.isArray(migrationBuckets.staged_dependency_review)
    ? migrationBuckets.staged_dependency_review.length
    : 0;

  const blockingReasons = [];

  if (unresolvedCount > 0) {
    blockingReasons.push("unresolved_builder_references_present");
  }
  if (highRiskCount > 0) {
    blockingReasons.push("high_risk_builder_assets_present");
  }
  if (blockedBucketCount > 0) {
    blockingReasons.push("blocked_builder_assets_present");
  }

  const graphStable = blockingReasons.length === 0;

  return {
    phase_b_graph_stable: graphStable,
    phase_b_readiness_status: graphStable
      ? "ready_for_builder_migration_planning"
      : "blocked_by_graph_instability",
    blocking_reasons: blockingReasons,
    unresolved_reference_count: unresolvedCount,
    high_risk_asset_count: highRiskCount,
    blocked_bucket_count: blockedBucketCount,
    staged_dependency_review_count: stagedBucketCount
  };
}

export function buildWordpressPhaseBReadinessArtifact(args = {}) {
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const phaseBGate =
    args.phaseBGate && typeof args.phaseBGate === "object" ? args.phaseBGate : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const dependencyGraphSummary =
    args.dependencyGraphSummary &&
    typeof args.dependencyGraphSummary === "object"
      ? args.dependencyGraphSummary
      : {};
  const familySummary = Array.isArray(args.familySummary) ? args.familySummary : [];

  return {
    artifact_type: "wordpress_phase_b_readiness_gate",
    artifact_version: "v1",
    phase_b_enabled: phaseBPlan.enabled === true,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    phase_b_gate_status: String(phaseBGate.phase_b_gate_status || "").trim(),
    phase_b_graph_stable: graphStability.phase_b_graph_stable === true,
    phase_b_readiness_status: String(graphStability.phase_b_readiness_status || "").trim(),
    blocking_reasons: Array.isArray(graphStability.blocking_reasons)
      ? graphStability.blocking_reasons
      : [],
    unresolved_reference_count: Number(graphStability.unresolved_reference_count || 0),
    high_risk_asset_count: Number(graphStability.high_risk_asset_count || 0),
    blocked_bucket_count: Number(graphStability.blocked_bucket_count || 0),
    staged_dependency_review_count: Number(
      graphStability.staged_dependency_review_count || 0
    ),
    dependency_graph_edge_count: Number(dependencyGraphSummary.edge_count || 0),
    dependency_graph_unresolved_count: Number(
      dependencyGraphSummary.unresolved_count || 0
    ),
    family_summary: familySummary
  };
}

export function buildWordpressPhaseBMigrationPlanningCandidates(args = {}) {
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const migrationBuckets =
    args.migrationBuckets && typeof args.migrationBuckets === "object"
      ? args.migrationBuckets
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (graphStability.phase_b_graph_stable !== true) {
    return {
      planning_status: "blocked",
      candidate_count: 0,
      blocked_count: 0,
      planning_candidates: [],
      blocked_candidates: [],
      blocking_reasons: Array.isArray(graphStability.blocking_reasons)
        ? graphStability.blocking_reasons
        : ["phase_b_graph_not_stable"]
    };
  }

  const stableCandidates = [
    ...(Array.isArray(migrationBuckets.candidate_low_complexity)
      ? migrationBuckets.candidate_low_complexity
      : []),
    ...(Array.isArray(migrationBuckets.candidate_reviewed_low_risk)
      ? migrationBuckets.candidate_reviewed_low_risk
      : [])
  ].slice(0, limit);

  const blockedCandidates = [
    ...(Array.isArray(migrationBuckets.staged_dependency_review)
      ? migrationBuckets.staged_dependency_review
      : []),
    ...(Array.isArray(migrationBuckets.blocked_high_dependency)
      ? migrationBuckets.blocked_high_dependency
      : []),
    ...(Array.isArray(migrationBuckets.manual_review)
      ? migrationBuckets.manual_review
      : [])
  ].slice(0, limit);

  return {
    planning_status: "ready",
    candidate_count: stableCandidates.length,
    blocked_count: blockedCandidates.length,
    planning_candidates: stableCandidates.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      planning_reason: "stable_bucket_candidate"
    })),
    blocked_candidates: blockedCandidates.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      blocked_reason:
        String(row?.migration_bucket_reason || "").trim() || "non_stable_bucket"
    })),
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBPlanningArtifact(args = {}) {
  const planningCandidates =
    args.planningCandidates && typeof args.planningCandidates === "object"
      ? args.planningCandidates
      : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};

  return {
    artifact_type: "wordpress_phase_b_planning_candidates",
    artifact_version: "v1",
    planning_status: String(planningCandidates.planning_status || "").trim(),
    phase_b_graph_stable: graphStability.phase_b_graph_stable === true,
    candidate_count: Number(planningCandidates.candidate_count || 0),
    blocked_count: Number(planningCandidates.blocked_count || 0),
    blocking_reasons: Array.isArray(planningCandidates.blocking_reasons)
      ? planningCandidates.blocking_reasons
      : [],
    planning_candidates: Array.isArray(planningCandidates.planning_candidates)
      ? planningCandidates.planning_candidates
      : [],
    blocked_candidates: Array.isArray(planningCandidates.blocked_candidates)
      ? planningCandidates.blocked_candidates
      : []
  };
}

export function computeWordpressBuilderSequenceWeight(row = {}) {
  const family = String(row?.asset_family || "").trim();
  const riskClass = String(row?.dependency_risk_class || "").trim();
  const dependencyScore = Number(row?.dependency_risk_score || 0);
  const crossRefCounts =
    row?.cross_reference_counts && typeof row.cross_reference_counts === "object"
      ? row.cross_reference_counts
      : {};

  const familyBaseWeightMap = {
    reusable_block_assets: 10,
    global_widget_assets: 20,
    navigation_assets: 30,
    elementor_assets: 40,
    theme_templates: 50,
    popup_assets: 60,
    other_builder_assets: 70
  };

  const familyBase = Number(familyBaseWeightMap[family] || 70);

  const refWeight =
    Number(crossRefCounts.template_ids || 0) * 3 +
    Number(crossRefCounts.widget_ids || 0) * 2 +
    Number(crossRefCounts.navigation_ids || 0) * 2 +
    Number(crossRefCounts.popup_ids || 0) * 4 +
    Number(crossRefCounts.shortcode_tags || 0);

  const riskWeight =
    riskClass === "low" ? 0 : riskClass === "medium" ? 15 : 30;

  return familyBase + dependencyScore + refWeight + riskWeight;
}

export function buildWordpressPhaseBSequencePlanner(args = {}) {
  const planningCandidates =
    args.planningCandidates && typeof args.planningCandidates === "object"
      ? args.planningCandidates
      : {};
  const normalizedAuditRows = Array.isArray(args.normalizedAuditRows)
    ? args.normalizedAuditRows
    : [];

  if (String(planningCandidates.planning_status || "").trim() !== "ready") {
    return {
      sequence_status: "blocked",
      total_sequence_count: 0,
      family_sequence_summary: [],
      migration_sequence: [],
      blocking_reasons: Array.isArray(planningCandidates.blocking_reasons)
        ? planningCandidates.blocking_reasons
        : ["phase_b_planning_not_ready"]
    };
  }

  const candidateKeySet = new Set(
    (Array.isArray(planningCandidates.planning_candidates)
      ? planningCandidates.planning_candidates
      : []
    ).map(row => {
      const postType = normalizeWordpressBuilderType(row?.post_type || "");
      const sourceId = Number(row?.source_id);
      return Number.isFinite(sourceId) ? `${postType}:${sourceId}` : "";
    }).filter(Boolean)
  );

  const selectedRows = normalizedAuditRows
    .filter(row => candidateKeySet.has(buildWordpressBuilderNodeKey(row)))
    .map(row => ({
      ...row,
      migration_sequence_weight: computeWordpressBuilderSequenceWeight(row)
    }))
    .sort((a, b) => {
      const weightDelta =
        Number(a?.migration_sequence_weight || 0) -
        Number(b?.migration_sequence_weight || 0);
      if (weightDelta !== 0) return weightDelta;

      const familyA = String(a?.asset_family || "").trim();
      const familyB = String(b?.asset_family || "").trim();
      if (familyA !== familyB) return familyA.localeCompare(familyB);

      return String(a?.slug || "").trim().localeCompare(String(b?.slug || "").trim());
    })
    .map((row, index) => ({
      sequence_index: index + 1,
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      dependency_risk_class: String(row?.dependency_risk_class || "").trim(),
      migration_sequence_weight: Number(row?.migration_sequence_weight || 0),
      planning_reason: "ordered_by_family_and_dependency_weight"
    }));

  const familySummaryMap = new Map();
  for (const row of selectedRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familySummaryMap.has(family)) {
      familySummaryMap.set(family, {
        asset_family: family,
        total_count: 0,
        first_sequence_index: null,
        last_sequence_index: null
      });
    }
    const bucket = familySummaryMap.get(family);
    bucket.total_count += 1;
    if (bucket.first_sequence_index === null) {
      bucket.first_sequence_index = row.sequence_index;
    }
    bucket.last_sequence_index = row.sequence_index;
  }

  return {
    sequence_status: "ready",
    total_sequence_count: selectedRows.length,
    family_sequence_summary: [...familySummaryMap.values()],
    migration_sequence: selectedRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBSequenceArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_b_sequence_plan",
    artifact_version: "v1",
    sequence_status: String(planner.sequence_status || "").trim(),
    total_sequence_count: Number(planner.total_sequence_count || 0),
    family_sequence_summary: Array.isArray(planner.family_sequence_summary)
      ? planner.family_sequence_summary
      : [],
    migration_sequence: Array.isArray(planner.migration_sequence)
      ? planner.migration_sequence
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function extractWordpressBuilderCompatibilitySignals(row = {}) {
  const flags =
    row?.dependency_flags && typeof row.dependency_flags === "object"
      ? row.dependency_flags
      : {};
  const postType = normalizeWordpressBuilderType(row?.post_type || "");
  const assetFamily = String(row?.asset_family || "").trim();

  return {
    requires_elementor:
      postType === "elementor_library" ||
      assetFamily === "elementor_assets" ||
      flags.uses_elementor_data === true,
    requires_theme_templates:
      postType === "wp_template" ||
      postType === "wp_template_part" ||
      assetFamily === "theme_templates" ||
      flags.uses_theme_json_refs === true,
    requires_navigation_support:
      postType === "wp_navigation" ||
      assetFamily === "navigation_assets" ||
      flags.uses_navigation_refs === true,
    requires_popup_support:
      postType === "popup" ||
      assetFamily === "popup_assets" ||
      flags.uses_popup_rules === true,
    requires_global_widget_support:
      postType === "global_widget" ||
      assetFamily === "global_widget_assets" ||
      flags.uses_global_widget_refs === true,
    requires_shortcode_review:
      flags.uses_shortcode_like_refs === true
  };
}

export function evaluateWordpressBuilderCompatibilityForRow(row = {}) {
  const signals = extractWordpressBuilderCompatibilitySignals(row);
  const reasons = [];

  if (signals.requires_elementor) {
    reasons.push("elementor_compatibility_required");
  }
  if (signals.requires_theme_templates) {
    reasons.push("theme_template_compatibility_required");
  }
  if (signals.requires_navigation_support) {
    reasons.push("navigation_support_required");
  }
  if (signals.requires_popup_support) {
    reasons.push("popup_rule_support_required");
  }
  if (signals.requires_global_widget_support) {
    reasons.push("global_widget_support_required");
  }
  if (signals.requires_shortcode_review) {
    reasons.push("shortcode_review_required");
  }

  const strictBlock =
    signals.requires_popup_support ||
    signals.requires_theme_templates;

  return {
    compatibility_signals: signals,
    compatibility_reasons: reasons,
    compatibility_gate_status: strictBlock
      ? "mapping_review_required"
      : reasons.length > 0
      ? "compatibility_review_required"
      : "compatible_for_mapping",
    compatibility_blocking: strictBlock === true
  };
}

export function buildWordpressPhaseBMappingPrerequisiteGate(args = {}) {
  const sequencePlanner =
    args.sequencePlanner && typeof args.sequencePlanner === "object"
      ? args.sequencePlanner
      : {};

  if (String(sequencePlanner.sequence_status || "").trim() !== "ready") {
    return {
      mapping_gate_status: "blocked",
      mapping_gate_ready: false,
      mapping_ready_count: 0,
      mapping_review_required_count: 0,
      compatibility_review_required_count: 0,
      blocked_count: 0,
      blocking_reasons: Array.isArray(sequencePlanner.blocking_reasons)
        ? sequencePlanner.blocking_reasons
        : ["phase_b_sequence_not_ready"],
      mapping_rows: []
    };
  }

  const rows = Array.isArray(sequencePlanner.migration_sequence)
    ? sequencePlanner.migration_sequence
    : [];

  const mappingRows = rows.map(row => {
    const compatibility = evaluateWordpressBuilderCompatibilityForRow(row);
    return {
      ...row,
      compatibility_signals: compatibility.compatibility_signals,
      compatibility_reasons: compatibility.compatibility_reasons,
      compatibility_gate_status: compatibility.compatibility_gate_status,
      compatibility_blocking: compatibility.compatibility_blocking,
      mapping_prerequisite_status:
        compatibility.compatibility_blocking === true
          ? "blocked"
          : compatibility.compatibility_gate_status === "compatible_for_mapping"
          ? "ready_for_mapping"
          : "review_before_mapping"
    };
  });

  const mappingReadyCount = mappingRows.filter(
    row => String(row?.mapping_prerequisite_status || "").trim() === "ready_for_mapping"
  ).length;

  const mappingReviewRequiredCount = mappingRows.filter(
    row => String(row?.compatibility_gate_status || "").trim() === "mapping_review_required"
  ).length;

  const compatibilityReviewRequiredCount = mappingRows.filter(
    row => String(row?.compatibility_gate_status || "").trim() === "compatibility_review_required"
  ).length;

  const blockedCount = mappingRows.filter(
    row => row?.compatibility_blocking === true
  ).length;

  return {
    mapping_gate_status:
      blockedCount === 0 ? "ready_for_mapping_planning" : "blocked_by_mapping_prerequisites",
    mapping_gate_ready: blockedCount === 0,
    mapping_ready_count: mappingReadyCount,
    mapping_review_required_count: mappingReviewRequiredCount,
    compatibility_review_required_count: compatibilityReviewRequiredCount,
    blocked_count: blockedCount,
    blocking_reasons:
      blockedCount === 0 ? [] : ["builder_mapping_prerequisites_unresolved"],
    mapping_rows: mappingRows
  };
}

export function buildWordpressPhaseBMappingPrerequisiteArtifact(args = {}) {
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_b_mapping_prerequisite_gate",
    artifact_version: "v1",
    mapping_gate_status: String(gate.mapping_gate_status || "").trim(),
    mapping_gate_ready: gate.mapping_gate_ready === true,
    mapping_ready_count: Number(gate.mapping_ready_count || 0),
    mapping_review_required_count: Number(gate.mapping_review_required_count || 0),
    compatibility_review_required_count: Number(
      gate.compatibility_review_required_count || 0
    ),
    blocked_count: Number(gate.blocked_count || 0),
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : [],
    mapping_rows: Array.isArray(gate.mapping_rows) ? gate.mapping_rows : []
  };
}

export function buildWordpressBuilderFamilyMappingTemplate(assetFamily = "") {
  const family = String(assetFamily || "").trim();

  if (family === "elementor_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "meta._elementor_data"],
      target_fields: ["title", "slug", "status", "content", "meta._elementor_data"],
      prerequisite_checks: [
        "elementor_plugin_available",
        "elementor_meta_supported",
        "shortcode_review_if_present"
      ],
      mapping_mode: "meta_preserving"
    };
  }

  if (family === "theme_templates") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "template_meta"],
      target_fields: ["title", "slug", "status", "content", "template_meta"],
      prerequisite_checks: [
        "theme_template_support_available",
        "theme_compatibility_review",
        "template_condition_review"
      ],
      mapping_mode: "template_condition_aware"
    };
  }

  if (family === "navigation_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content"],
      target_fields: ["title", "slug", "status", "content"],
      prerequisite_checks: [
        "navigation_post_type_available",
        "navigation_reference_review"
      ],
      mapping_mode: "structure_preserving"
    };
  }

  if (family === "popup_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "popup_rules"],
      target_fields: ["title", "slug", "status", "content", "popup_rules"],
      prerequisite_checks: [
        "popup_support_available",
        "popup_trigger_review",
        "display_condition_review"
      ],
      mapping_mode: "rule_aware"
    };
  }

  if (family === "global_widget_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content", "widget_meta"],
      target_fields: ["title", "slug", "status", "content", "widget_meta"],
      prerequisite_checks: [
        "global_widget_support_available",
        "widget_reference_review"
      ],
      mapping_mode: "widget_meta_preserving"
    };
  }

  if (family === "reusable_block_assets") {
    return {
      mapping_family: family,
      source_fields: ["title", "slug", "status", "content"],
      target_fields: ["title", "slug", "status", "content"],
      prerequisite_checks: [
        "reusable_block_support_available"
      ],
      mapping_mode: "content_preserving"
    };
  }

  return {
    mapping_family: family || "other_builder_assets",
    source_fields: ["title", "slug", "status", "content"],
    target_fields: ["title", "slug", "status", "content"],
    prerequisite_checks: [
      "manual_family_review"
    ],
    mapping_mode: "manual_review"
  };
}

export function buildWordpressPhaseBMappingPlanSkeleton(args = {}) {
  const mappingGate =
    args.mappingGate && typeof args.mappingGate === "object"
      ? args.mappingGate
      : {};

  if (mappingGate.mapping_gate_ready !== true) {
    return {
      mapping_plan_status: "blocked",
      family_mapping_plans: [],
      asset_mapping_rows: [],
      blocking_reasons: Array.isArray(mappingGate.blocking_reasons)
        ? mappingGate.blocking_reasons
        : ["phase_b_mapping_gate_not_ready"]
    };
  }

  const mappingRows = Array.isArray(mappingGate.mapping_rows)
    ? mappingGate.mapping_rows
    : [];

  const familyPlanMap = new Map();
  const assetMappingRows = [];

  for (const row of mappingRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";

    if (!familyPlanMap.has(family)) {
      familyPlanMap.set(family, {
        ...buildWordpressBuilderFamilyMappingTemplate(family),
        asset_count: 0
      });
    }

    const familyPlan = familyPlanMap.get(family);
    familyPlan.asset_count += 1;

    assetMappingRows.push({
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: family,
      migration_bucket: String(row?.migration_bucket || "").trim(),
      mapping_prerequisite_status: String(row?.mapping_prerequisite_status || "").trim(),
      compatibility_gate_status: String(row?.compatibility_gate_status || "").trim(),
      mapping_mode: String(familyPlan.mapping_mode || "").trim(),
      source_fields: Array.isArray(familyPlan.source_fields)
        ? familyPlan.source_fields
        : [],
      target_fields: Array.isArray(familyPlan.target_fields)
        ? familyPlan.target_fields
        : [],
      prerequisite_checks: Array.isArray(familyPlan.prerequisite_checks)
        ? familyPlan.prerequisite_checks
        : []
    });
  }

  return {
    mapping_plan_status: "ready",
    family_mapping_plans: [...familyPlanMap.values()],
    asset_mapping_rows: assetMappingRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBMappingPlanArtifact(args = {}) {
  const mappingPlan =
    args.mappingPlan && typeof args.mappingPlan === "object"
      ? args.mappingPlan
      : {};

  return {
    artifact_type: "wordpress_phase_b_mapping_plan_skeleton",
    artifact_version: "v1",
    mapping_plan_status: String(mappingPlan.mapping_plan_status || "").trim(),
    family_mapping_plans: Array.isArray(mappingPlan.family_mapping_plans)
      ? mappingPlan.family_mapping_plans
      : [],
    asset_mapping_rows: Array.isArray(mappingPlan.asset_mapping_rows)
      ? mappingPlan.asset_mapping_rows
      : [],
    blocking_reasons: Array.isArray(mappingPlan.blocking_reasons)
      ? mappingPlan.blocking_reasons
      : []
  };
}

export function buildWordpressBuilderFamilyMetaPreservationPlan(assetFamily = "") {
  const family = String(assetFamily || "").trim();

  if (family === "elementor_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_edit_mode",
        "_elementor_template_type",
        "_elementor_version"
      ],
      optional_meta_keys: [
        "_wp_page_template"
      ],
      content_strategy: "preserve_rendered_and_builder_meta"
    };
  }

  if (family === "theme_templates") {
    return {
      preserve_meta_keys: [
        "_wp_template_type",
        "_wp_theme"
      ],
      optional_meta_keys: [
        "_wp_page_template"
      ],
      content_strategy: "preserve_template_content_and_template_meta"
    };
  }

  if (family === "popup_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_template_type"
      ],
      optional_meta_keys: [
        "_elementor_conditions",
        "_elementor_triggers"
      ],
      content_strategy: "preserve_popup_content_and_rule_meta"
    };
  }

  if (family === "global_widget_assets") {
    return {
      preserve_meta_keys: [
        "_elementor_data",
        "_elementor_template_type"
      ],
      optional_meta_keys: [
        "_elementor_widget_type"
      ],
      content_strategy: "preserve_widget_meta_and_content"
    };
  }

  if (family === "navigation_assets") {
    return {
      preserve_meta_keys: [],
      optional_meta_keys: [
        "_menu_item_type"
      ],
      content_strategy: "preserve_navigation_structure"
    };
  }

  if (family === "reusable_block_assets") {
    return {
      preserve_meta_keys: [],
      optional_meta_keys: [],
      content_strategy: "preserve_block_content"
    };
  }

  return {
    preserve_meta_keys: [],
    optional_meta_keys: [],
    content_strategy: "manual_review"
  };
}

export function resolveWordpressBuilderFieldMappingRow(row = {}) {
  const assetFamily = String(row?.asset_family || "").trim() || "other_builder_assets";
  const metaPlan = buildWordpressBuilderFamilyMetaPreservationPlan(assetFamily);

  const sourceFields = Array.isArray(row?.source_fields) ? row.source_fields : [];
  const targetFields = Array.isArray(row?.target_fields) ? row.target_fields : [];
  const preserveMetaKeys = Array.isArray(metaPlan.preserve_meta_keys)
    ? metaPlan.preserve_meta_keys
    : [];
  const optionalMetaKeys = Array.isArray(metaPlan.optional_meta_keys)
    ? metaPlan.optional_meta_keys
    : [];

  const fieldMappings = sourceFields.map(field => ({
    source_field: String(field || "").trim(),
    target_field: targetFields.includes(field) ? String(field || "").trim() : "",
    mapping_status: targetFields.includes(field) ? "mapped_direct" : "requires_review"
  }));

  const metaMappings = [
    ...preserveMetaKeys.map(key => ({
      meta_key: String(key || "").trim(),
      preservation_mode: "required_preserve",
      mapping_status: "planned"
    })),
    ...optionalMetaKeys.map(key => ({
      meta_key: String(key || "").trim(),
      preservation_mode: "optional_preserve",
      mapping_status: "planned_optional"
    }))
  ];

  const directMappingsReady = fieldMappings.every(
    row => String(row?.mapping_status || "").trim() === "mapped_direct"
  );

  return {
    ...row,
    field_mappings: fieldMappings,
    meta_preservation_plan: {
      preserve_meta_keys: preserveMetaKeys,
      optional_meta_keys: optionalMetaKeys,
      content_strategy: String(metaPlan.content_strategy || "").trim()
    },
    meta_mappings: metaMappings,
    field_mapping_status:
      directMappingsReady ? "direct_mapping_ready" : "field_review_required"
  };
}

export function buildWordpressPhaseBFieldMappingResolver(args = {}) {
  const mappingPlan =
    args.mappingPlan && typeof args.mappingPlan === "object"
      ? args.mappingPlan
      : {};

  if (String(mappingPlan.mapping_plan_status || "").trim() !== "ready") {
    return {
      field_mapping_status: "blocked",
      resolved_mapping_rows: [],
      family_mapping_summary: [],
      blocking_reasons: Array.isArray(mappingPlan.blocking_reasons)
        ? mappingPlan.blocking_reasons
        : ["phase_b_mapping_plan_not_ready"]
    };
  }

  const assetRows = Array.isArray(mappingPlan.asset_mapping_rows)
    ? mappingPlan.asset_mapping_rows
    : [];

  const resolvedRows = assetRows.map(resolveWordpressBuilderFieldMappingRow);

  const familyMap = new Map();
  for (const row of resolvedRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        asset_family: family,
        total_count: 0,
        direct_mapping_ready_count: 0,
        field_review_required_count: 0,
        required_meta_keys: new Set(),
        optional_meta_keys: new Set()
      });
    }

    const bucket = familyMap.get(family);
    bucket.total_count += 1;

    if (String(row?.field_mapping_status || "").trim() === "direct_mapping_ready") {
      bucket.direct_mapping_ready_count += 1;
    } else {
      bucket.field_review_required_count += 1;
    }

    const metaPlan =
      row?.meta_preservation_plan && typeof row.meta_preservation_plan === "object"
        ? row.meta_preservation_plan
        : {};

    for (const key of Array.isArray(metaPlan.preserve_meta_keys)
      ? metaPlan.preserve_meta_keys
      : []) {
      if (String(key || "").trim()) bucket.required_meta_keys.add(String(key || "").trim());
    }

    for (const key of Array.isArray(metaPlan.optional_meta_keys)
      ? metaPlan.optional_meta_keys
      : []) {
      if (String(key || "").trim()) bucket.optional_meta_keys.add(String(key || "").trim());
    }
  }

  const familyMappingSummary = [...familyMap.values()].map(row => ({
    asset_family: row.asset_family,
    total_count: row.total_count,
    direct_mapping_ready_count: row.direct_mapping_ready_count,
    field_review_required_count: row.field_review_required_count,
    required_meta_keys: [...row.required_meta_keys],
    optional_meta_keys: [...row.optional_meta_keys]
  }));

  return {
    field_mapping_status: "ready",
    resolved_mapping_rows: resolvedRows,
    family_mapping_summary: familyMappingSummary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBFieldMappingArtifact(args = {}) {
  const resolver =
    args.resolver && typeof args.resolver === "object"
      ? args.resolver
      : {};

  return {
    artifact_type: "wordpress_phase_b_field_mapping_plan",
    artifact_version: "v1",
    field_mapping_status: String(resolver.field_mapping_status || "").trim(),
    resolved_mapping_rows: Array.isArray(resolver.resolved_mapping_rows)
      ? resolver.resolved_mapping_rows
      : [],
    family_mapping_summary: Array.isArray(resolver.family_mapping_summary)
      ? resolver.family_mapping_summary
      : [],
    blocking_reasons: Array.isArray(resolver.blocking_reasons)
      ? resolver.blocking_reasons
      : []
  };
}

export function buildWordpressBuilderDryRunPayloadRow(row = {}) {
  const fieldMappings = Array.isArray(row?.field_mappings) ? row.field_mappings : [];
  const metaMappings = Array.isArray(row?.meta_mappings) ? row.meta_mappings : [];

  const mappedFields = fieldMappings
    .filter(x => String(x?.mapping_status || "").trim() === "mapped_direct")
    .map(x => ({
      source_field: String(x?.source_field || "").trim(),
      target_field: String(x?.target_field || "").trim()
    }));

  const requiredMeta = metaMappings
    .filter(x => String(x?.preservation_mode || "").trim() === "required_preserve")
    .map(x => String(x?.meta_key || "").trim())
    .filter(Boolean);

  const optionalMeta = metaMappings
    .filter(x => String(x?.preservation_mode || "").trim() === "optional_preserve")
    .map(x => String(x?.meta_key || "").trim())
    .filter(Boolean);

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    asset_family: String(row?.asset_family || "").trim(),
    mapping_mode: String(row?.mapping_mode || "").trim(),
    field_mapping_status: String(row?.field_mapping_status || "").trim(),
    mapped_fields: mappedFields,
    meta_preservation: {
      required_meta_keys: requiredMeta,
      optional_meta_keys: optionalMeta,
      content_strategy: String(
        row?.meta_preservation_plan?.content_strategy || ""
      ).trim()
    },
    dry_run_mutation_shape: {
      title: "source->target",
      slug: "source->target",
      status: "draft",
      content: mappedFields.some(x => x.target_field === "content")
        ? "preserve_from_source"
        : "review_required",
      meta: {
        required: requiredMeta,
        optional: optionalMeta
      }
    }
  };
}

export function buildWordpressPhaseBDryRunMigrationPayloadPlanner(args = {}) {
  const resolver =
    args.resolver && typeof args.resolver === "object"
      ? args.resolver
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  if (String(resolver.field_mapping_status || "").trim() !== "ready") {
    return {
      dry_run_status: "blocked",
      payload_count: 0,
      dry_run_payload_rows: [],
      family_payload_summary: [],
      blocking_reasons: Array.isArray(resolver.blocking_reasons)
        ? resolver.blocking_reasons
        : ["phase_b_field_mapping_not_ready"]
    };
  }

  const resolvedRows = Array.isArray(resolver.resolved_mapping_rows)
    ? resolver.resolved_mapping_rows
    : [];

  const eligibleRows = resolvedRows.filter(row => {
    const status = String(row?.mapping_prerequisite_status || "").trim();
    return status === "ready_for_mapping" || status === "review_before_mapping";
  });

  const dryRunPayloadRows = eligibleRows
    .slice(0, limit)
    .map(buildWordpressBuilderDryRunPayloadRow);

  const familyMap = new Map();
  for (const row of dryRunPayloadRows) {
    const family = String(row?.asset_family || "").trim() || "other_builder_assets";
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        asset_family: family,
        payload_count: 0,
        direct_mapping_ready_count: 0,
        field_review_required_count: 0
      });
    }
    const bucket = familyMap.get(family);
    bucket.payload_count += 1;
    if (String(row?.field_mapping_status || "").trim() === "direct_mapping_ready") {
      bucket.direct_mapping_ready_count += 1;
    } else {
      bucket.field_review_required_count += 1;
    }
  }

  return {
    dry_run_status: "ready",
    payload_count: dryRunPayloadRows.length,
    dry_run_payload_rows: dryRunPayloadRows,
    family_payload_summary: [...familyMap.values()],
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBDryRunArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object"
      ? args.planner
      : {};

  return {
    artifact_type: "wordpress_phase_b_dry_run_payload_plan",
    artifact_version: "v1",
    dry_run_status: String(planner.dry_run_status || "").trim(),
    payload_count: Number(planner.payload_count || 0),
    family_payload_summary: Array.isArray(planner.family_payload_summary)
      ? planner.family_payload_summary
      : [],
    dry_run_payload_rows: Array.isArray(planner.dry_run_payload_rows)
      ? planner.dry_run_payload_rows
      : [],
    blocking_reasons: Array.isArray(planner.blocking_reasons)
      ? planner.blocking_reasons
      : []
  };
}

export function resolveWordpressPhaseBExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const builder = migration.builder_assets && typeof migration.builder_assets === "object"
    ? migration.builder_assets
    : {};
  const execution = builder.execution && typeof builder.execution === "object"
    ? builder.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 50)),
    allow_review_required_rows: execution.allow_review_required_rows === true
  };
}

export function buildWordpressPhaseBExecutionGuard(args = {}) {
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const graphStability =
    args.graphStability && typeof args.graphStability === "object"
      ? args.graphStability
      : {};
  const mappingGate =
    args.mappingGate && typeof args.mappingGate === "object"
      ? args.mappingGate
      : {};
  const dryRunPlanner =
    args.dryRunPlanner && typeof args.dryRunPlanner === "object"
      ? args.dryRunPlanner
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  const blockingReasons = [];

  if (phaseBPlan.enabled !== true) {
    blockingReasons.push("phase_b_not_enabled");
  }
  if (phaseBPlan.audit_only === true) {
    blockingReasons.push("phase_b_audit_only_enabled");
  }
  if (graphStability.phase_b_graph_stable !== true) {
    blockingReasons.push("phase_b_graph_not_stable");
  }
  if (mappingGate.mapping_gate_ready !== true) {
    blockingReasons.push("phase_b_mapping_gate_not_ready");
  }
  if (String(dryRunPlanner.dry_run_status || "").trim() !== "ready") {
    blockingReasons.push("phase_b_dry_run_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_b_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_b_execution_apply_conflicts_with_dry_run_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_builder_mutation_execution"
      : "blocked_before_builder_mutation_execution",
    execution_guard_ready: executionReady,
    blocking_reasons: blockingReasons,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0)
  };
}

export function buildWordpressPhaseBExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_b_execution_guard",
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

export function buildWordpressPhaseBMutationCandidateSelector(args = {}) {
  const executionGuard =
    args.executionGuard && typeof args.executionGuard === "object"
      ? args.executionGuard
      : {};
  const fieldMappingResolver =
    args.fieldMappingResolver && typeof args.fieldMappingResolver === "object"
      ? args.fieldMappingResolver
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
        : ["phase_b_execution_guard_not_ready"]
    };
  }

  const rows = Array.isArray(fieldMappingResolver.resolved_mapping_rows)
    ? fieldMappingResolver.resolved_mapping_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of rows) {
    const mappingStatus = String(row?.field_mapping_status || "").trim();
    const prerequisiteStatus = String(row?.mapping_prerequisite_status || "").trim();

    const baseRecord = {
      post_type: String(row?.post_type || "").trim(),
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      asset_family: String(row?.asset_family || "").trim(),
      migration_bucket: String(row?.migration_bucket || "").trim(),
      field_mapping_status: mappingStatus,
      mapping_prerequisite_status: prerequisiteStatus,
      mapping_mode: String(row?.mapping_mode || "").trim()
    };

    if (mappingStatus !== "direct_mapping_ready") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "field_mapping_not_direct_ready"
      });
      continue;
    }

    if (prerequisiteStatus === "blocked") {
      rejected.push({
        ...baseRecord,
        rejection_reason: "mapping_prerequisite_blocked"
      });
      continue;
    }

    if (
      prerequisiteStatus === "review_before_mapping" &&
      executionPlan.allow_review_required_rows !== true
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "review_required_rows_not_allowed"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "direct_mapping_ready_for_builder_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 50))
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

export function buildWordpressPhaseBMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_b_mutation_candidates",
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

export function buildWordpressBuilderMutationPayloadFromResolvedRow(row = {}) {
  const fieldMappings = Array.isArray(row?.field_mappings) ? row.field_mappings : [];
  const metaPlan =
    row?.meta_preservation_plan && typeof row.meta_preservation_plan === "object"
      ? row.meta_preservation_plan
      : {};

  const payload = {};

  for (const mapping of fieldMappings) {
    const sourceField = String(mapping?.source_field || "").trim();
    const targetField = String(mapping?.target_field || "").trim();
    const mappingStatus = String(mapping?.mapping_status || "").trim();

    if (!sourceField || !targetField || mappingStatus !== "mapped_direct") {
      continue;
    }

    if (targetField === "title") payload.title = "preserve_from_source";
    else if (targetField === "slug") payload.slug = "preserve_from_source";
    else if (targetField === "status") payload.status = "draft";
    else if (targetField === "content") payload.content = "preserve_from_source";
    else payload[targetField] = "preserve_from_source";
  }

  payload.meta = {
    required: Array.isArray(metaPlan.preserve_meta_keys)
      ? metaPlan.preserve_meta_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    optional: Array.isArray(metaPlan.optional_meta_keys)
      ? metaPlan.optional_meta_keys.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    content_strategy: String(metaPlan.content_strategy || "").trim()
  };

  return payload;
}

export function buildWordpressPhaseBMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};
  const resolver =
    args.resolver && typeof args.resolver === "object" ? args.resolver : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_b_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];
  const resolvedRows = Array.isArray(resolver.resolved_mapping_rows)
    ? resolver.resolved_mapping_rows
    : [];

  const resolvedMap = new Map(
    resolvedRows.map(row => [
      `${normalizeWordpressBuilderType(row?.post_type || "")}:${Number(row?.source_id || 0)}`,
      row
    ])
  );

  const composedPayloads = selectedCandidates.map(candidate => {
    const key = `${normalizeWordpressBuilderType(candidate?.post_type || "")}:${Number(candidate?.source_id || 0)}`;
    const resolvedRow = resolvedMap.get(key) || {};

    return {
      post_type: String(candidate?.post_type || "").trim(),
      source_id: Number.isFinite(Number(candidate?.source_id))
        ? Number(candidate.source_id)
        : null,
      slug: String(candidate?.slug || "").trim(),
      title: String(candidate?.title || "").trim(),
      asset_family: String(candidate?.asset_family || "").trim(),
      mapping_mode: String(resolvedRow?.mapping_mode || candidate?.mapping_mode || "").trim(),
      field_mapping_status: String(
        resolvedRow?.field_mapping_status || candidate?.field_mapping_status || ""
      ).trim(),
      mutation_payload: buildWordpressBuilderMutationPayloadFromResolvedRow(resolvedRow),
      payload_reason: "composed_from_direct_mapping_ready_candidate"
    };
  });

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_b_mutation_payloads",
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

export function simulateWordpressBuilderDryRunResult(row = {}) {
  const payload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};

  const requiredMeta = Array.isArray(payload?.meta?.required)
    ? payload.meta.required
    : [];
  const optionalMeta = Array.isArray(payload?.meta?.optional)
    ? payload.meta.optional
    : [];

  const preview = {
    mutation_mode: "dry_run",
    expected_target_status: String(payload?.status || "draft").trim(),
    expected_content_strategy: String(payload?.meta?.content_strategy || "").trim(),
    mapped_field_count: Object.keys(payload).filter(k => k !== "meta").length,
    required_meta_key_count: requiredMeta.length,
    optional_meta_key_count: optionalMeta.length
  };

  return {
    post_type: String(row?.post_type || "").trim(),
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    asset_family: String(row?.asset_family || "").trim(),
    mapping_mode: String(row?.mapping_mode || "").trim(),
    field_mapping_status: String(row?.field_mapping_status || "").trim(),
    dry_run_result: "simulated_ready",
    mutation_evidence_preview: preview,
    preview_payload: payload
  };
}

export function buildWordpressPhaseBDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      mutation_evidence_preview_summary: {
        total_rows: 0,
        expected_draft_count: 0,
        total_required_meta_keys: 0,
        total_optional_meta_keys: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_b_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressBuilderDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.mutation_evidence_preview && typeof row.mutation_evidence_preview === "object"
          ? row.mutation_evidence_preview
          : {};

      acc.total_rows += 1;
      if (String(preview.expected_target_status || "").trim() === "draft") {
        acc.expected_draft_count += 1;
      }
      acc.total_required_meta_keys += Number(preview.required_meta_key_count || 0);
      acc.total_optional_meta_keys += Number(preview.optional_meta_key_count || 0);
      return acc;
    },
    {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    mutation_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseBDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_b_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    mutation_evidence_preview_summary:
      simulator?.mutation_evidence_preview_summary &&
      typeof simulator.mutation_evidence_preview_summary === "object"
        ? simulator.mutation_evidence_preview_summary
        : {
            total_rows: 0,
            expected_draft_count: 0,
            total_required_meta_keys: 0,
            total_optional_meta_keys: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseBFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseBPlan =
    args.phaseBPlan && typeof args.phaseBPlan === "object" ? args.phaseBPlan : {};
  const phaseBGate =
    args.phaseBGate && typeof args.phaseBGate === "object" ? args.phaseBGate : {};
  const readinessArtifact =
    args.readinessArtifact && typeof args.readinessArtifact === "object"
      ? args.readinessArtifact
      : {};
  const planningArtifact =
    args.planningArtifact && typeof args.planningArtifact === "object"
      ? args.planningArtifact
      : {};
  const sequenceArtifact =
    args.sequenceArtifact && typeof args.sequenceArtifact === "object"
      ? args.sequenceArtifact
      : {};
  const mappingPrerequisiteArtifact =
    args.mappingPrerequisiteArtifact &&
    typeof args.mappingPrerequisiteArtifact === "object"
      ? args.mappingPrerequisiteArtifact
      : {};
  const mappingPlanArtifact =
    args.mappingPlanArtifact && typeof args.mappingPlanArtifact === "object"
      ? args.mappingPlanArtifact
      : {};
  const fieldMappingArtifact =
    args.fieldMappingArtifact && typeof args.fieldMappingArtifact === "object"
      ? args.fieldMappingArtifact
      : {};
  const dryRunArtifact =
    args.dryRunArtifact && typeof args.dryRunArtifact === "object"
      ? args.dryRunArtifact
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
  const normalizedAudit =
    args.normalizedAudit && typeof args.normalizedAudit === "object"
      ? args.normalizedAudit
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_b_final_operator_handoff",
    artifact_version: "v1",
    phase_b_enabled: phaseBPlan.enabled === true,
    phase_b_audit_only: phaseBPlan.audit_only === true,
    phase_b_apply_requested: phaseBPlan.apply === true,
    requested_builder_post_types: Array.isArray(phaseBPlan.post_types)
      ? phaseBPlan.post_types
      : (
          Array.isArray(migration?.builder_assets?.post_types)
            ? migration.builder_assets.post_types
            : []
        ),
    phase_b_gate_status: String(phaseBGate.phase_b_gate_status || "").trim(),
    phase_b_readiness_status: String(readinessArtifact.phase_b_readiness_status || "").trim(),
    phase_b_graph_stable: readinessArtifact.phase_b_graph_stable === true,
    phase_b_planning_status: String(planningArtifact.planning_status || "").trim(),
    phase_b_sequence_status: String(sequenceArtifact.sequence_status || "").trim(),
    phase_b_mapping_gate_status: String(
      mappingPrerequisiteArtifact.mapping_gate_status || ""
    ).trim(),
    phase_b_mapping_plan_status: String(mappingPlanArtifact.mapping_plan_status || "").trim(),
    phase_b_field_mapping_status: String(
      fieldMappingArtifact.field_mapping_status || ""
    ).trim(),
    phase_b_dry_run_status: String(dryRunArtifact.dry_run_status || "").trim(),
    phase_b_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_b_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_b_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_b_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_totals:
      normalizedAudit?.dependency_totals &&
      typeof normalizedAudit.dependency_totals === "object"
        ? normalizedAudit.dependency_totals
        : {
            total_count: 0,
            low_risk_count: 0,
            medium_risk_count: 0,
            high_risk_count: 0
          },
    graph_summary:
      normalizedAudit?.dependency_graph_summary &&
      typeof normalizedAudit.dependency_graph_summary === "object"
        ? normalizedAudit.dependency_graph_summary
        : {
            edge_count: 0,
            unresolved_count: 0,
            relation_counts: {},
            unresolved_relation_counts: {}
          },
    family_summary: Array.isArray(normalizedAudit.family_summary)
      ? normalizedAudit.family_summary
      : [],
    planning_candidate_count: Number(planningArtifact.candidate_count || 0),
    planning_blocked_count: Number(planningArtifact.blocked_count || 0),
    mapping_ready_count: Number(mappingPrerequisiteArtifact.mapping_ready_count || 0),
    mapping_review_required_count: Number(
      mappingPrerequisiteArtifact.mapping_review_required_count || 0
    ),
    compatibility_review_required_count: Number(
      mappingPrerequisiteArtifact.compatibility_review_required_count || 0
    ),
    blocked_mapping_count: Number(mappingPrerequisiteArtifact.blocked_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseBGate.blocking_reasons) ? phaseBGate.blocking_reasons : []),
      ...(Array.isArray(readinessArtifact.blocking_reasons)
        ? readinessArtifact.blocking_reasons
        : []),
      ...(Array.isArray(planningArtifact.blocking_reasons)
        ? planningArtifact.blocking_reasons
        : []),
      ...(Array.isArray(mappingPrerequisiteArtifact.blocking_reasons)
        ? mappingPrerequisiteArtifact.blocking_reasons
        : []),
      ...(Array.isArray(executionGuardArtifact.blocking_reasons)
        ? executionGuardArtifact.blocking_reasons
        : [])
    ],
    operator_actions: [
      readinessArtifact.phase_b_graph_stable === true
        ? "review_stable_builder_candidates"
        : "resolve_builder_graph_instability",
      String(mappingPrerequisiteArtifact.mapping_gate_status || "").trim() ===
      "ready_for_mapping_planning"
        ? "review_mapping_plan"
        : "resolve_mapping_prerequisites",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_builder_mutation_execution"
        ? "approve_builder_mutation_trial"
        : "hold_builder_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_dry_run_execution_preview"
        : "no_dry_run_preview_available"
    ],
    readiness_artifact: readinessArtifact,
    planning_artifact: planningArtifact,
    sequence_artifact: sequenceArtifact,
    mapping_prerequisite_artifact: mappingPrerequisiteArtifact,
    mapping_plan_artifact: mappingPlanArtifact,
    field_mapping_artifact: fieldMappingArtifact,
    dry_run_artifact: dryRunArtifact,
    execution_guard_artifact: executionGuardArtifact,
    mutation_candidate_artifact: mutationCandidateArtifact,
    mutation_payload_artifact: mutationPayloadArtifact,
    dry_run_execution_artifact: dryRunExecutionArtifact
  };
}

export function buildWordpressPhaseBNormalizedAudit(args = {}) {
  const auditRows = Array.isArray(args.auditRows) ? args.auditRows : [];

  const normalizedAuditRows = auditRows.map(row => {
    const risk = classifyWordpressBuilderDependencyRisk(row);
    const familyAndBucket = classifyWordpressBuilderMigrationBucket({
      ...row,
      dependency_risk_class: risk.dependency_risk_class,
      audit_classification: row?.audit_classification
    });

    return {
      ...row,
      dependency_flags: risk.normalized_dependency_flags,
      dependency_risk_score: risk.dependency_risk_score,
      dependency_risk_class: risk.dependency_risk_class,
      dependency_risk_reasons: risk.dependency_risk_reasons,
      asset_family: familyAndBucket.asset_family,
      migration_bucket: familyAndBucket.migration_bucket,
      migration_bucket_reason: familyAndBucket.migration_bucket_reason,
      phase_b_migration_readiness:
        risk.dependency_risk_class === "low"
          ? "candidate_for_later_migration"
          : "dependency_audit_required"
    };
  });

  const dependencySummary = buildWordpressPhaseBDependencySummary(normalizedAuditRows);
  const familySummary = buildWordpressPhaseBFamilySummary(normalizedAuditRows);
  const migrationBuckets = buildWordpressPhaseBMigrationBuckets(normalizedAuditRows);
  const crossReferenceSummary = summarizeWordpressBuilderCrossReferences(normalizedAuditRows);
  const referenceIndex = buildWordpressBuilderReferenceIndex(normalizedAuditRows);
  const dependencyGraph = buildWordpressBuilderDependencyEdges(
    normalizedAuditRows,
    referenceIndex
  );
  const dependencyGraphSummary = summarizeWordpressBuilderDependencyGraph({
    edges: dependencyGraph.edges,
    unresolved: dependencyGraph.unresolved
  });

  const totals = normalizedAuditRows.reduce(
    (acc, row) => {
      const riskClass = String(row?.dependency_risk_class || "").trim();
      acc.total_count += 1;
      if (riskClass === "high") acc.high_risk_count += 1;
      else if (riskClass === "medium") acc.medium_risk_count += 1;
      else acc.low_risk_count += 1;
      return acc;
    },
    {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    }
  );

  return {
    normalized_audit_rows: normalizedAuditRows,
    dependency_summary: dependencySummary,
    dependency_totals: totals,
    family_summary: familySummary,
    migration_buckets: migrationBuckets,
    cross_reference_summary: crossReferenceSummary,
    dependency_reference_index: referenceIndex,
    dependency_graph_edges: dependencyGraph.edges,
    dependency_graph_unresolved: dependencyGraph.unresolved,
    dependency_graph_summary: dependencyGraphSummary
  };
}
