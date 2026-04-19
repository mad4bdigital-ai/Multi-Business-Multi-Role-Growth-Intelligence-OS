// Auto-extracted from server.js — do not edit manually, use domain logic here.

export function resolveWordpressPhaseEPlan(payload = {}) {
  const migration = payload?.migration || {};
  const media = migration.media_assets && typeof migration.media_assets === "object"
    ? migration.media_assets
    : {};

  return {
    enabled: media.enabled === true,
    inventory_only:
      media.inventory_only === undefined ? true : media.inventory_only === true,
    apply: media.apply === true,
    include_featured_media:
      media.include_featured_media === undefined
        ? true
        : media.include_featured_media === true,
    include_inline_media:
      media.include_inline_media === undefined
        ? true
        : media.include_inline_media === true,
    include_unattached:
      media.include_unattached === true,
    max_items: Math.max(1, toPositiveInt(media.max_items, 1000))
  };
}

export function assertWordpressPhaseEPlan(plan = {}) {
  const blockingReasons = [];

  if (plan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }

  if (plan.apply === true && plan.inventory_only === true) {
    blockingReasons.push("phase_e_apply_conflicts_with_inventory_only");
  }

  return {
    phase_e_status:
      blockingReasons.length === 0 ? "inventory_ready" : "blocked",
    phase_e_ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseEGate(args = {}) {
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
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEPlanStatus =
    args.phaseEPlanStatus && typeof args.phaseEPlanStatus === "object"
      ? args.phaseEPlanStatus
      : {};

  const blockingReasons = [...(phaseEPlanStatus.blocking_reasons || [])];

  if (
    String(phaseAFinalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
    "do_not_cutover"
  ) {
    blockingReasons.push("phase_a_not_stable_enough_for_phase_e");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseBFinalOperatorHandoffBundle.phase_b_enabled === true &&
    String(phaseBFinalOperatorHandoffBundle.phase_b_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_b_builder_stage_blocked");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseCFinalOperatorHandoffBundle.phase_c_enabled === true &&
    String(phaseCFinalOperatorHandoffBundle.phase_c_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_c_settings_stage_blocked");
  }

  if (
    phaseEPlan.enabled === true &&
    phaseDFinalOperatorHandoffBundle.phase_d_enabled === true &&
    String(phaseDFinalOperatorHandoffBundle.phase_d_gate_status || "").trim() === "blocked"
  ) {
    blockingReasons.push("phase_d_forms_stage_blocked");
  }

  return {
    phase_e_gate_status:
      blockingReasons.length === 0 ? "ready_for_media_inventory" : "blocked",
    phase_e_gate_ready: blockingReasons.length === 0,
    inventory_only: phaseEPlan.inventory_only === true,
    blocking_reasons: blockingReasons
  };
}

export function extractWordpressInlineMediaRefs(item = {}) {
  const content = String(
    item?.content?.rendered ||
    item?.content ||
    ""
  );

  const refs = {
    attachment_ids: [],
    urls: []
  };

  const attachmentIdMatches = new Set();
  const urlMatches = new Set();

  const patterns = [
    /wp-image-(\d+)/gi,
    /attachment[_-]?id["':=\s]+(\d+)/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const v = Number(match[1]);
      if (Number.isFinite(v)) attachmentIdMatches.add(v);
    }
  }

  const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|pdf)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(content)) !== null) {
    const v = String(urlMatch[0] || "").trim();
    if (v) urlMatches.add(v);
  }

  refs.attachment_ids = [...attachmentIdMatches];
  refs.urls = [...urlMatches];
  return refs;
}

export function classifyWordpressMediaInventoryRow(item = {}, attachmentContext = {}) {
  const inlineRefs = extractWordpressInlineMediaRefs(item);
  const featuredMediaId = Number(item?.featured_media);
  const parentId = Number(item?.post || item?.parent);
  const mimeType = String(item?.mime_type || item?.mime || "").trim().toLowerCase();

  return {
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
    media_type: String(item?.media_type || "").trim(),
    mime_type: mimeType,
    source_url: String(item?.source_url || item?.guid?.rendered || "").trim(),
    alt_text: String(item?.alt_text || "").trim(),
    parent_post_id: Number.isFinite(parentId) ? parentId : null,
    featured_media_self_reference:
      Number.isFinite(featuredMediaId) &&
      Number.isFinite(Number(item?.id)) &&
      Number(item.id) === featuredMediaId,
    inline_attachment_refs: inlineRefs.attachment_ids,
    inline_url_refs: inlineRefs.urls,
    dependency_count:
      (Number.isFinite(parentId) ? 1 : 0) +
      inlineRefs.attachment_ids.length +
      inlineRefs.urls.length,
    attachment_classification:
      Number.isFinite(parentId) ? "attached_media" : "unattached_media",
    migration_candidate:
      attachmentContext.include_unattached === true
        ? true
        : Number.isFinite(parentId)
  };
}

export async function runWordpressMediaInventory(args = {}) {
  const {
    wpContext = {},
    phaseEPlan = {},
    phaseEGate = {}
  } = args;

  if (phaseEGate.phase_e_gate_ready !== true) {
    return {
      phase_e_inventory_status: "blocked",
      inventory_rows: [],
      summary: {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      },
      failures: [
        {
          code: "phase_e_media_inventory_blocked",
          message: "Phase E media inventory blocked by phase_e_gate.",
          blocking_reasons: phaseEGate.blocking_reasons || []
        }
      ]
    };
  }

  try {
    const itemsRaw = await listWordpressEntriesByType({
      siteRef: wpContext.source,
      postType: "attachment",
      authRequired: false
    });

    const limitedItems = itemsRaw.slice(0, phaseEPlan.max_items);
    const inventoryRows = limitedItems
      .map(item => classifyWordpressMediaInventoryRow(item, phaseEPlan))
      .filter(row => phaseEPlan.include_unattached === true || row.migration_candidate === true);

    const summary = inventoryRows.reduce(
      (acc, row) => {
        acc.total_count += 1;
        if (String(row?.attachment_classification || "").trim() === "attached_media") {
          acc.attached_count += 1;
        } else {
          acc.unattached_count += 1;
        }
        acc.inline_ref_count += Array.isArray(row?.inline_attachment_refs)
          ? row.inline_attachment_refs.length
          : 0;
        return acc;
      },
      {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      }
    );

    return {
      phase_e_inventory_status: "completed",
      inventory_rows: inventoryRows,
      summary,
      failures: []
    };
  } catch (err) {
    return {
      phase_e_inventory_status: "completed_with_failures",
      inventory_rows: [],
      summary: {
        total_count: 0,
        attached_count: 0,
        unattached_count: 0,
        inline_ref_count: 0
      },
      failures: [
        {
          code: err?.code || "wordpress_media_inventory_failed",
          message: err?.message || "WordPress media inventory failed."
        }
      ]
    };
  }
}

export function buildWordpressPhaseEInventoryArtifact(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_e_media_inventory",
    artifact_version: "v1",
    phase_e_gate_status: String(gate.phase_e_gate_status || "").trim(),
    phase_e_inventory_status: String(inventory.phase_e_inventory_status || "").trim(),
    inventory_only: gate.inventory_only === true,
    summary:
      inventory?.summary && typeof inventory.summary === "object"
        ? inventory.summary
        : {
            total_count: 0,
            attached_count: 0,
            unattached_count: 0,
            inline_ref_count: 0
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

export function normalizeWordpressMediaMimeClass(mimeType = "") {
  const value = String(mimeType || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (value === "application/pdf") return "document";
  if (value.startsWith("application/")) return "application";
  return "other";
}

export function classifyWordpressMediaMigrationStrategy(row = {}, phaseEPlan = {}) {
  const mimeClass = normalizeWordpressMediaMimeClass(row?.mime_type || "");
  const attached = String(row?.attachment_classification || "").trim() === "attached_media";
  const inlineAttachmentRefs = Array.isArray(row?.inline_attachment_refs)
    ? row.inline_attachment_refs
    : [];
  const inlineUrlRefs = Array.isArray(row?.inline_url_refs) ? row.inline_url_refs : [];

  let strategyScore = 0;
  const reasons = [];

  if (attached) {
    strategyScore += 1;
    reasons.push("attached_media");
  } else {
    strategyScore += 3;
    reasons.push("unattached_media");
  }

  if (inlineAttachmentRefs.length > 0) {
    strategyScore += 2;
    reasons.push("inline_attachment_refs_present");
  }

  if (inlineUrlRefs.length > 0) {
    strategyScore += 2;
    reasons.push("inline_url_refs_present");
  }

  if (row?.featured_media_self_reference === true) {
    strategyScore += 1;
    reasons.push("featured_media_self_reference");
  }

  if (mimeClass === "video" || mimeClass === "audio") {
    strategyScore += 3;
    reasons.push("heavy_media_type");
  } else if (mimeClass === "document" || mimeClass === "application") {
    strategyScore += 2;
    reasons.push("document_like_media_type");
  } else if (mimeClass === "image") {
    strategyScore += 1;
    reasons.push("image_media_type");
  }

  let migration_strategy = "safe_attached_migrate_candidate";
  let migration_strategy_reason = "attached_media_with_low_dependency_complexity";

  if (!attached && phaseEPlan.include_unattached !== true) {
    migration_strategy = "excluded_unattached_media";
    migration_strategy_reason = "unattached_media_not_included";
  } else if (strategyScore >= 7) {
    migration_strategy = "rebuild_or_manual_rebind_required";
    migration_strategy_reason = "high_media_dependency_complexity";
  } else if (strategyScore >= 4) {
    migration_strategy = "reviewed_media_migrate";
    migration_strategy_reason = "medium_media_dependency_complexity";
  }

  return {
    mime_class: mimeClass,
    media_strategy_score: strategyScore,
    media_strategy_reasons: reasons,
    migration_strategy,
    migration_strategy_reason
  };
}

export function buildWordpressPhaseENormalizedInventory(args = {}) {
  const inventory =
    args.inventory && typeof args.inventory === "object" ? args.inventory : {};
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};

  const rows = Array.isArray(inventory.inventory_rows)
    ? inventory.inventory_rows
    : [];

  const normalizedRows = rows.map(row => {
    const strategy = classifyWordpressMediaMigrationStrategy(row, phaseEPlan);
    return {
      ...row,
      mime_class: strategy.mime_class,
      media_strategy_score: strategy.media_strategy_score,
      media_strategy_reasons: strategy.media_strategy_reasons,
      migration_strategy: strategy.migration_strategy,
      migration_strategy_reason: strategy.migration_strategy_reason
    };
  });

  const strategySummary = normalizedRows.reduce(
    (acc, row) => {
      acc.total_count += 1;

      const strategy = String(row?.migration_strategy || "").trim();
      if (strategy === "safe_attached_migrate_candidate") {
        acc.safe_attached_migrate_candidate_count += 1;
      } else if (strategy === "reviewed_media_migrate") {
        acc.reviewed_media_migrate_count += 1;
      } else if (strategy === "rebuild_or_manual_rebind_required") {
        acc.rebuild_or_manual_rebind_required_count += 1;
      } else if (strategy === "excluded_unattached_media") {
        acc.excluded_unattached_media_count += 1;
      }

      const mimeClass = String(row?.mime_class || "").trim();
      if (mimeClass === "image") acc.image_count += 1;
      else if (mimeClass === "video") acc.video_count += 1;
      else if (mimeClass === "audio") acc.audio_count += 1;
      else if (mimeClass === "document") acc.document_count += 1;
      else acc.other_count += 1;

      return acc;
    },
    {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    }
  );

  const strategyBuckets = {
    safe_attached_migrate_candidate: normalizedRows.filter(
      row =>
        String(row?.migration_strategy || "").trim() ===
        "safe_attached_migrate_candidate"
    ),
    reviewed_media_migrate: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "reviewed_media_migrate"
    ),
    rebuild_or_manual_rebind_required: normalizedRows.filter(
      row =>
        String(row?.migration_strategy || "").trim() ===
        "rebuild_or_manual_rebind_required"
    ),
    excluded_unattached_media: normalizedRows.filter(
      row => String(row?.migration_strategy || "").trim() === "excluded_unattached_media"
    )
  };

  return {
    normalized_inventory_rows: normalizedRows,
    strategy_summary: strategySummary,
    strategy_buckets: strategyBuckets
  };
}

export function buildWordpressPhaseENormalizedInventoryArtifact(args = {}) {
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const gate =
    args.gate && typeof args.gate === "object" ? args.gate : {};

  return {
    artifact_type: "wordpress_phase_e_media_strategy",
    artifact_version: "v1",
    phase_e_gate_status: String(gate.phase_e_gate_status || "").trim(),
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            safe_attached_migrate_candidate_count: 0,
            reviewed_media_migrate_count: 0,
            rebuild_or_manual_rebind_required_count: 0,
            excluded_unattached_media_count: 0,
            image_count: 0,
            video_count: 0,
            audio_count: 0,
            document_count: 0,
            other_count: 0
          },
    normalized_inventory_rows: Array.isArray(normalizedInventory.normalized_inventory_rows)
      ? normalizedInventory.normalized_inventory_rows
      : [],
    strategy_buckets:
      normalizedInventory?.strategy_buckets &&
      typeof normalizedInventory.strategy_buckets === "object"
        ? normalizedInventory.strategy_buckets
        : {
            safe_attached_migrate_candidate: [],
            reviewed_media_migrate: [],
            rebuild_or_manual_rebind_required: [],
            excluded_unattached_media: []
          },
    blocking_reasons: Array.isArray(gate.blocking_reasons)
      ? gate.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseEReadinessGate(args = {}) {
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
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

  const blockingReasons = [...(phaseEGate.blocking_reasons || [])];

  if (phaseEPlan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }

  const rebuildRequiredCount = Number(
    strategySummary.rebuild_or_manual_rebind_required_count || 0
  );
  const reviewedCount = Number(
    strategySummary.reviewed_media_migrate_count || 0
  );
  const safeCount = Number(
    strategySummary.safe_attached_migrate_candidate_count || 0
  );

  if (rebuildRequiredCount > 0) {
    blockingReasons.push("media_manual_rebind_required_present");
  }

  if (phaseEPlan.include_unattached !== true) {
    const excludedUnattachedCount = Number(
      strategySummary.excluded_unattached_media_count || 0
    );
    if (excludedUnattachedCount > 0) {
      blockingReasons.push("unattached_media_excluded_from_scope");
    }
  }

  const readiness = blockingReasons.length === 0;

  const safeCandidates = Array.isArray(strategyBuckets.safe_attached_migrate_candidate)
    ? strategyBuckets.safe_attached_migrate_candidate
    : [];

  return {
    readiness_status: readiness
      ? "ready_for_safe_media_migration"
      : "blocked_for_media_migration",
    readiness_ready: readiness,
    safe_attached_migrate_candidate_count: safeCount,
    reviewed_media_migrate_count: reviewedCount,
    rebuild_or_manual_rebind_required_count: rebuildRequiredCount,
    safe_candidate_count: safeCandidates.length,
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseESafeCandidates(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const normalizedInventory =
    args.normalizedInventory && typeof args.normalizedInventory === "object"
      ? args.normalizedInventory
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 100));

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
        : ["phase_e_readiness_not_ready"]
    };
  }

  const candidates = (
    Array.isArray(strategyBuckets.safe_attached_migrate_candidate)
      ? strategyBuckets.safe_attached_migrate_candidate
      : []
  )
    .slice(0, limit)
    .map(row => ({
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      mime_type: String(row?.mime_type || "").trim(),
      mime_class: String(row?.mime_class || "").trim(),
      source_url: String(row?.source_url || "").trim(),
      parent_post_id: Number.isFinite(Number(row?.parent_post_id))
        ? Number(row.parent_post_id)
        : null,
      attachment_classification: String(row?.attachment_classification || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      candidate_reason: "safe_attached_migrate_candidate"
    }));

  return {
    safe_candidate_status: "ready",
    candidate_count: candidates.length,
    candidates,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseEReadinessArtifact(args = {}) {
  const readiness =
    args.readiness && typeof args.readiness === "object" ? args.readiness : {};
  const safeCandidates =
    args.safeCandidates && typeof args.safeCandidates === "object"
      ? args.safeCandidates
      : {};

  return {
    artifact_type: "wordpress_phase_e_readiness_gate",
    artifact_version: "v1",
    readiness_status: String(readiness.readiness_status || "").trim(),
    readiness_ready: readiness.readiness_ready === true,
    safe_attached_migrate_candidate_count: Number(
      readiness.safe_attached_migrate_candidate_count || 0
    ),
    reviewed_media_migrate_count: Number(
      readiness.reviewed_media_migrate_count || 0
    ),
    rebuild_or_manual_rebind_required_count: Number(
      readiness.rebuild_or_manual_rebind_required_count || 0
    ),
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

export function buildWordpressMediaSafeMigrationPayloadRow(row = {}) {
  return {
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_mode: "safe_media_migration_candidate",
    payload_shape: {
      title: "preserve_from_source",
      slug: "preserve_from_source",
      status: "inherit",
      source_url: "download_and_reupload_from_source",
      alt_text: "preserve_if_present",
      mime_type: String(row?.mime_type || "").trim(),
      parent_binding: Number.isFinite(Number(row?.parent_post_id))
        ? "rebind_to_destination_parent_if_resolved"
        : "leave_unbound",
      inline_reference_strategy:
        Array.isArray(row?.inline_attachment_refs) && row.inline_attachment_refs.length > 0
          ? "rebind_inline_attachment_refs_if_resolved"
          : "no_inline_attachment_rebind_required"
    }
  };
}

export function buildWordpressPhaseEMigrationPayloadPlanner(args = {}) {
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
        : ["phase_e_safe_candidates_not_ready"]
    };
  }

  const candidates = Array.isArray(safeCandidates.candidates)
    ? safeCandidates.candidates
    : [];

  const payloadRows = candidates.map(buildWordpressMediaSafeMigrationPayloadRow);

  return {
    payload_planner_status: "ready",
    payload_count: payloadRows.length,
    payload_rows: payloadRows,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseEMigrationPayloadArtifact(args = {}) {
  const planner =
    args.planner && typeof args.planner === "object" ? args.planner : {};

  return {
    artifact_type: "wordpress_phase_e_migration_payloads",
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

export function resolveWordpressPhaseEExecutionPlan(payload = {}) {
  const migration = payload?.migration || {};
  const media = migration.media_assets && typeof migration.media_assets === "object"
    ? migration.media_assets
    : {};
  const execution = media.execution && typeof media.execution === "object"
    ? media.execution
    : {};

  return {
    enabled: execution.enabled === true,
    apply: execution.apply === true,
    dry_run_only:
      execution.dry_run_only === undefined ? true : execution.dry_run_only === true,
    candidate_limit: Math.max(1, toPositiveInt(execution.candidate_limit, 100))
  };
}

export function buildWordpressPhaseEExecutionGuard(args = {}) {
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
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

  if (phaseEPlan.enabled !== true) {
    blockingReasons.push("phase_e_not_enabled");
  }
  if (phaseEGate.phase_e_gate_ready !== true) {
    blockingReasons.push("phase_e_gate_not_ready");
  }
  if (readiness.readiness_ready !== true) {
    blockingReasons.push("phase_e_readiness_not_ready");
  }
  if (String(payloadPlanner.payload_planner_status || "").trim() !== "ready") {
    blockingReasons.push("phase_e_payloads_not_ready");
  }
  if (executionPlan.enabled !== true) {
    blockingReasons.push("phase_e_execution_not_enabled");
  }
  if (executionPlan.apply === true && executionPlan.dry_run_only === true) {
    blockingReasons.push("phase_e_execution_apply_conflicts_with_dry_run_only");
  }
  if (phaseEPlan.inventory_only === true && phaseEPlan.apply === true) {
    blockingReasons.push("phase_e_plan_apply_conflicts_with_inventory_only");
  }

  const executionReady = blockingReasons.length === 0;

  return {
    execution_guard_status: executionReady
      ? "ready_for_media_migration_execution"
      : "blocked_before_media_mutation",
    execution_guard_ready: executionReady,
    dry_run_only: executionPlan.dry_run_only === true,
    apply_requested: executionPlan.apply === true,
    candidate_limit: Number(executionPlan.candidate_limit || 0),
    blocking_reasons: blockingReasons
  };
}

export function buildWordpressPhaseEExecutionGuardArtifact(args = {}) {
  const guard =
    args.guard && typeof args.guard === "object" ? args.guard : {};

  return {
    artifact_type: "wordpress_phase_e_execution_guard",
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

export function buildWordpressPhaseEMutationCandidateSelector(args = {}) {
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
        : ["phase_e_execution_guard_not_ready"]
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
        : ["phase_e_payload_planner_not_ready"]
    };
  }

  const payloadRows = Array.isArray(payloadPlanner.payload_rows)
    ? payloadPlanner.payload_rows
    : [];

  const selected = [];
  const rejected = [];

  for (const row of payloadRows) {
    const baseRecord = {
      source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
      slug: String(row?.slug || "").trim(),
      title: String(row?.title || "").trim(),
      mime_type: String(row?.mime_type || "").trim(),
      mime_class: String(row?.mime_class || "").trim(),
      source_url: String(row?.source_url || "").trim(),
      parent_post_id: Number.isFinite(Number(row?.parent_post_id))
        ? Number(row.parent_post_id)
        : null,
      attachment_classification: String(row?.attachment_classification || "").trim(),
      migration_strategy: String(row?.migration_strategy || "").trim(),
      migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
      payload_mode: String(row?.payload_mode || "").trim(),
      payload_shape:
        row?.payload_shape && typeof row.payload_shape === "object"
          ? row.payload_shape
          : {}
    };

    if (
      String(baseRecord.migration_strategy || "").trim() !==
      "safe_attached_migrate_candidate"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_safe_attached_migrate_strategy"
      });
      continue;
    }

    if (
      String(baseRecord.attachment_classification || "").trim() !==
      "attached_media"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_attached_media"
      });
      continue;
    }

    if (
      String(baseRecord.payload_mode || "").trim() !==
      "safe_media_migration_candidate"
    ) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "unsupported_payload_mode"
      });
      continue;
    }

    selected.push({
      ...baseRecord,
      candidate_reason: "safe_attached_media_candidate_ready_for_mutation"
    });
  }

  const limitedSelected = selected.slice(
    0,
    Math.max(1, Number(executionPlan.candidate_limit || 100))
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

export function buildWordpressPhaseEMutationCandidateArtifact(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  return {
    artifact_type: "wordpress_phase_e_mutation_candidates",
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

export function buildWordpressMediaMutationPayloadFromCandidate(row = {}) {
  const payloadShape =
    row?.payload_shape && typeof row.payload_shape === "object"
      ? row.payload_shape
      : {};

  return {
    mutation_mode: "safe_media_migration",
    target_scope: "destination_media_attachment",
    payload: {
      title: Object.prototype.hasOwnProperty.call(payloadShape, "title")
        ? payloadShape.title
        : "preserve_from_source",
      slug: Object.prototype.hasOwnProperty.call(payloadShape, "slug")
        ? payloadShape.slug
        : "preserve_from_source",
      status: Object.prototype.hasOwnProperty.call(payloadShape, "status")
        ? payloadShape.status
        : "inherit",
      source_url: Object.prototype.hasOwnProperty.call(payloadShape, "source_url")
        ? payloadShape.source_url
        : "download_and_reupload_from_source",
      alt_text: Object.prototype.hasOwnProperty.call(payloadShape, "alt_text")
        ? payloadShape.alt_text
        : "preserve_if_present",
      mime_type: String(payloadShape.mime_type || "").trim(),
      parent_binding: String(payloadShape.parent_binding || "").trim(),
      inline_reference_strategy: String(
        payloadShape.inline_reference_strategy || ""
      ).trim()
    }
  };
}

export function buildWordpressPhaseEMutationPayloadComposer(args = {}) {
  const selector =
    args.selector && typeof args.selector === "object" ? args.selector : {};

  if (String(selector.selector_status || "").trim() !== "ready") {
    return {
      composer_status: "blocked",
      payload_count: 0,
      composed_payloads: [],
      blocking_reasons: Array.isArray(selector.blocking_reasons)
        ? selector.blocking_reasons
        : ["phase_e_mutation_candidates_not_ready"]
    };
  }

  const selectedCandidates = Array.isArray(selector.selected_candidates)
    ? selector.selected_candidates
    : [];

  const composedPayloads = selectedCandidates.map(row => ({
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    migration_strategy_reason: String(row?.migration_strategy_reason || "").trim(),
    payload_reason: "composed_from_safe_attached_media_candidate",
    mutation_payload: buildWordpressMediaMutationPayloadFromCandidate(row)
  }));

  return {
    composer_status: "ready",
    payload_count: composedPayloads.length,
    composed_payloads: composedPayloads,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseEMutationPayloadArtifact(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  return {
    artifact_type: "wordpress_phase_e_mutation_payloads",
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

export function simulateWordpressMediaDryRunResult(row = {}) {
  const mutationPayload =
    row?.mutation_payload && typeof row.mutation_payload === "object"
      ? row.mutation_payload
      : {};
  const payload =
    mutationPayload?.payload && typeof mutationPayload.payload === "object"
      ? mutationPayload.payload
      : {};

  return {
    source_id: Number.isFinite(Number(row?.source_id)) ? Number(row.source_id) : null,
    slug: String(row?.slug || "").trim(),
    title: String(row?.title || "").trim(),
    mime_type: String(row?.mime_type || "").trim(),
    mime_class: String(row?.mime_class || "").trim(),
    source_url: String(row?.source_url || "").trim(),
    parent_post_id: Number.isFinite(Number(row?.parent_post_id))
      ? Number(row.parent_post_id)
      : null,
    attachment_classification: String(row?.attachment_classification || "").trim(),
    migration_strategy: String(row?.migration_strategy || "").trim(),
    dry_run_result: "simulated_ready",
    attachment_evidence_preview: {
      mutation_mode: String(mutationPayload.mutation_mode || "").trim(),
      target_scope: String(mutationPayload.target_scope || "").trim(),
      expected_status: String(payload.status || "").trim(),
      expected_title_mode: String(payload.title || "").trim(),
      expected_slug_mode: String(payload.slug || "").trim(),
      expected_source_transfer_mode: String(payload.source_url || "").trim(),
      expected_alt_text_mode: String(payload.alt_text || "").trim(),
      expected_parent_binding: String(payload.parent_binding || "").trim(),
      expected_inline_reference_strategy: String(
        payload.inline_reference_strategy || ""
      ).trim(),
      mime_type: String(payload.mime_type || "").trim()
    },
    preview_payload: mutationPayload
  };
}

export function buildWordpressPhaseEDryRunExecutionSimulator(args = {}) {
  const composer =
    args.composer && typeof args.composer === "object" ? args.composer : {};

  if (String(composer.composer_status || "").trim() !== "ready") {
    return {
      simulator_status: "blocked",
      simulated_count: 0,
      simulated_rows: [],
      attachment_evidence_preview_summary: {
        total_rows: 0,
        expected_inherit_count: 0,
        safe_media_migration_count: 0,
        source_transfer_count: 0,
        parent_rebind_count: 0,
        inline_rebind_count: 0
      },
      blocking_reasons: Array.isArray(composer.blocking_reasons)
        ? composer.blocking_reasons
        : ["phase_e_mutation_payloads_not_ready"]
    };
  }

  const composedPayloads = Array.isArray(composer.composed_payloads)
    ? composer.composed_payloads
    : [];

  const simulatedRows = composedPayloads.map(simulateWordpressMediaDryRunResult);

  const summary = simulatedRows.reduce(
    (acc, row) => {
      const preview =
        row?.attachment_evidence_preview &&
        typeof row.attachment_evidence_preview === "object"
          ? row.attachment_evidence_preview
          : {};

      acc.total_rows += 1;

      if (String(preview.expected_status || "").trim() === "inherit") {
        acc.expected_inherit_count += 1;
      }
      if (String(preview.mutation_mode || "").trim() === "safe_media_migration") {
        acc.safe_media_migration_count += 1;
      }
      if (
        String(preview.expected_source_transfer_mode || "").trim() ===
        "download_and_reupload_from_source"
      ) {
        acc.source_transfer_count += 1;
      }
      if (
        String(preview.expected_parent_binding || "").trim() ===
        "rebind_to_destination_parent_if_resolved"
      ) {
        acc.parent_rebind_count += 1;
      }
      if (
        String(preview.expected_inline_reference_strategy || "").trim() ===
        "rebind_inline_attachment_refs_if_resolved"
      ) {
        acc.inline_rebind_count += 1;
      }

      return acc;
    },
    {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    }
  );

  return {
    simulator_status: "ready",
    simulated_count: simulatedRows.length,
    simulated_rows: simulatedRows,
    attachment_evidence_preview_summary: summary,
    blocking_reasons: []
  };
}

export function buildWordpressPhaseEDryRunExecutionArtifact(args = {}) {
  const simulator =
    args.simulator && typeof args.simulator === "object" ? args.simulator : {};

  return {
    artifact_type: "wordpress_phase_e_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: String(simulator.simulator_status || "").trim(),
    simulated_count: Number(simulator.simulated_count || 0),
    simulated_rows: Array.isArray(simulator.simulated_rows)
      ? simulator.simulated_rows
      : [],
    attachment_evidence_preview_summary:
      simulator?.attachment_evidence_preview_summary &&
      typeof simulator.attachment_evidence_preview_summary === "object"
        ? simulator.attachment_evidence_preview_summary
        : {
            total_rows: 0,
            expected_inherit_count: 0,
            safe_media_migration_count: 0,
            source_transfer_count: 0,
            parent_rebind_count: 0,
            inline_rebind_count: 0
          },
    blocking_reasons: Array.isArray(simulator.blocking_reasons)
      ? simulator.blocking_reasons
      : []
  };
}

export function buildWordpressPhaseEFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseEPlan =
    args.phaseEPlan && typeof args.phaseEPlan === "object" ? args.phaseEPlan : {};
  const phaseEGate =
    args.phaseEGate && typeof args.phaseEGate === "object" ? args.phaseEGate : {};
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
    artifact_type: "wordpress_phase_e_final_operator_handoff",
    artifact_version: "v1",
    phase_e_enabled: phaseEPlan.enabled === true,
    phase_e_inventory_only: phaseEPlan.inventory_only === true,
    phase_e_apply_requested: phaseEPlan.apply === true,
    requested_media_scope: {
      include_featured_media: phaseEPlan.include_featured_media === true,
      include_inline_media: phaseEPlan.include_inline_media === true,
      include_unattached: phaseEPlan.include_unattached === true,
      max_items: Number(phaseEPlan.max_items || 0)
    },
    requested_media_config:
      migration?.media_assets && typeof migration.media_assets === "object"
        ? migration.media_assets
        : {},
    phase_e_gate_status: String(phaseEGate.phase_e_gate_status || "").trim(),
    phase_e_inventory_status: String(inventoryArtifact.phase_e_inventory_status || "").trim(),
    phase_e_strategy_status: String(
      normalizedInventoryArtifact.phase_e_gate_status || ""
    ).trim(),
    phase_e_readiness_status: String(readinessArtifact.readiness_status || "").trim(),
    phase_e_safe_candidate_status: String(
      readinessArtifact.safe_candidate_status || ""
    ).trim(),
    phase_e_payload_planner_status: String(
      migrationPayloadArtifact.payload_planner_status || ""
    ).trim(),
    phase_e_execution_guard_status: String(
      executionGuardArtifact.execution_guard_status || ""
    ).trim(),
    phase_e_mutation_selector_status: String(
      mutationCandidateArtifact.selector_status || ""
    ).trim(),
    phase_e_mutation_payload_status: String(
      mutationPayloadArtifact.composer_status || ""
    ).trim(),
    phase_e_dry_run_execution_status: String(
      dryRunExecutionArtifact.simulator_status || ""
    ).trim(),
    inventory_summary:
      inventoryArtifact?.summary && typeof inventoryArtifact.summary === "object"
        ? inventoryArtifact.summary
        : {
            total_count: 0,
            attached_count: 0,
            unattached_count: 0,
            inline_ref_count: 0
          },
    strategy_summary:
      normalizedInventory?.strategy_summary &&
      typeof normalizedInventory.strategy_summary === "object"
        ? normalizedInventory.strategy_summary
        : {
            total_count: 0,
            safe_attached_migrate_candidate_count: 0,
            reviewed_media_migrate_count: 0,
            rebuild_or_manual_rebind_required_count: 0,
            excluded_unattached_media_count: 0,
            image_count: 0,
            video_count: 0,
            audio_count: 0,
            document_count: 0,
            other_count: 0
          },
    safe_candidate_count: Number(readinessArtifact.safe_candidate_count || 0),
    mutation_candidate_count: Number(mutationCandidateArtifact.selected_count || 0),
    mutation_rejected_count: Number(mutationCandidateArtifact.rejected_count || 0),
    composed_payload_count: Number(mutationPayloadArtifact.payload_count || 0),
    dry_run_simulated_count: Number(dryRunExecutionArtifact.simulated_count || 0),
    blocking_reasons: [
      ...(Array.isArray(phaseEGate.blocking_reasons) ? phaseEGate.blocking_reasons : []),
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
        ? "review_safe_media_candidates"
        : "resolve_media_migration_blockers",
      String(executionGuardArtifact.execution_guard_status || "").trim() ===
      "ready_for_media_migration_execution"
        ? "approve_media_mutation_trial"
        : "hold_media_mutation_execution",
      Number(dryRunExecutionArtifact.simulated_count || 0) > 0
        ? "review_media_dry_run_preview"
        : "no_media_dry_run_preview_available"
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
