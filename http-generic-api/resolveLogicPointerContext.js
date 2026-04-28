/**
 * Canonical Logic Pointer Resolution
 *
 * Implements the 6-step orchestration rule from:
 *   canonicals/system_bootstrap/01_logic_pointer_knowledge.md
 *
 * deps shape:
 *   getPointerRow(logicId)      -> pointerRow | null
 *   isRollbackAuthorized(id)    -> boolean          (optional)
 *   getKnowledgeProfile(id)     -> profileRow | null (required when input.require_knowledge)
 *
 * pointerRow shape:
 *   { canonical_status, canonical_doc_id, legacy_doc_id,
 *     rollback_available, active_pointer }
 */

export function resolveLogicPointerContext(input = {}, deps = {}) {
  const {
    logic_id = "",
    logic_family = "",
    require_knowledge = false
  } = input;

  const { getPointerRow, isRollbackAuthorized, getKnowledgeProfile } = deps;

  const effectiveId = String(logic_id || logic_family || "").trim();

  const evidence = {
    logic_pointer_surface_id: "surface.logic_canonical_pointer_registry",
    logic_pointer_resolution_status: "pending",
    resolved_logic_doc_id: "",
    resolved_logic_doc_mode: "",
    resolved_logic_mode: "",
    logic_association_status: "associated",
    used_logic_id: effectiveId,
    used_logic_name: effectiveId,
    logic_rollback_status: "not_used",
    logic_knowledge_status: require_knowledge ? "pending" : "not_required",
    canonical_status: "",
    active_pointer: "",
    legacy_doc_retained: false,
    rollback_available: false
  };

  // Step 1–2: read pointer state
  if (typeof getPointerRow !== "function") {
    return {
      ok: false,
      blocked_reason: "missing_pointer_registry_dep",
      state: { ...evidence, logic_pointer_resolution_status: "blocked" }
    };
  }

  const row = getPointerRow(effectiveId);

  if (!row) {
    return {
      ok: false,
      blocked_reason: "pointer_registry_unresolved",
      state: { ...evidence, logic_pointer_resolution_status: "degraded" }
    };
  }

  // Step 3–4: determine canonical_status and active_pointer
  const canonicalStatus = String(row.canonical_status || "").trim();
  const activePointer  = String(row.active_pointer  || "").trim();

  const rollbackAvailable = typeof row.rollback_available === "boolean"
    ? row.rollback_available
    : String(row.rollback_available ?? "").toLowerCase() === "true";

  const rollbackAuth = typeof isRollbackAuthorized === "function"
    ? isRollbackAuthorized(effectiveId)
    : false;

  evidence.canonical_status   = canonicalStatus;
  evidence.active_pointer     = activePointer;
  evidence.rollback_available = rollbackAvailable;
  evidence.legacy_doc_retained = Boolean(row.legacy_doc_id);

  // Step 5: resolve active document
  // Governed rollback is checked first — it overrides canonical_active when explicitly authorized.
  if (rollbackAvailable && rollbackAuth) {
    // Governed rollback explicitly authorized — legacy permitted regardless of canonical status
    evidence.resolved_logic_doc_id  = String(row.legacy_doc_id || "").trim();
    evidence.resolved_logic_doc_mode = "legacy_recovery";
    evidence.resolved_logic_mode = "legacy";
    evidence.logic_pointer_resolution_status = "validated";
    evidence.logic_rollback_status = "used";
  } else if (canonicalStatus === "canonical_active") {
    // Canonical pointer wins — legacy is not used
    evidence.resolved_logic_doc_id  = String(row.canonical_doc_id || "").trim();
    evidence.resolved_logic_doc_mode = "canonical";
    evidence.resolved_logic_mode = "canonical";
    evidence.logic_pointer_resolution_status = "validated";
    evidence.logic_rollback_status = rollbackAvailable ? "available_not_used" : "not_available";
  } else if (canonicalStatus === "legacy_recovery") {
    // Pointer explicitly returns legacy mode
    evidence.resolved_logic_doc_id  = String(row.legacy_doc_id || "").trim();
    evidence.resolved_logic_doc_mode = "legacy";
    evidence.resolved_logic_mode = "legacy";
    evidence.logic_pointer_resolution_status = "validated";
    evidence.logic_rollback_status = rollbackAvailable ? "available_not_used" : "legacy_path";
  } else {
    // No valid resolution path
    evidence.logic_pointer_resolution_status = "degraded";
    return {
      ok: false,
      blocked_reason: "pointer_resolution_no_valid_path",
      state: evidence
    };
  }

  const baseResult = { ok: true, state: evidence };

  // Step 5 continued: knowledge profile — must run AFTER pointer resolution (Case 5)
  if (!require_knowledge) return baseResult;

  if (typeof getKnowledgeProfile !== "function") {
    return {
      ...baseResult,
      ok: false,
      blocked_reason: "missing_knowledge_profile_dep",
      knowledge: null
    };
  }

  const profile = getKnowledgeProfile(effectiveId);

  if (!profile) {
    return {
      ...baseResult,
      ok: false,
      blocked_reason: "knowledge_profile_unresolved",
      knowledge: {
        logic_knowledge_surface_id: "surface.logic_knowledge_profiles",
        logic_knowledge_read_required: true,
        required_knowledge_layers: [],
        knowledge_profile_key: "",
        knowledge_read_targets: [],
        knowledge_read_completeness_status: "blocked",
        missing_required_knowledge_sources: [effectiveId],
        execution_blocked_until_logic_knowledge_read: true
      }
    };
  }

  const missingKnowledge = profile.missing_required_knowledge_sources || [];
  const knowledgeComplete =
    profile.knowledge_read_completeness_status === "validated" &&
    missingKnowledge.length === 0;

  const knowledge = {
    logic_knowledge_surface_id: "surface.logic_knowledge_profiles",
    logic_knowledge_read_required: true,
    required_knowledge_layers: profile.required_knowledge_layers || [],
    knowledge_profile_key: profile.knowledge_profile_key || "",
    knowledge_read_targets: profile.knowledge_read_targets || [],
    knowledge_read_completeness_status: profile.knowledge_read_completeness_status || "pending",
    missing_required_knowledge_sources: missingKnowledge,
    execution_blocked_until_logic_knowledge_read: !knowledgeComplete
  };

  evidence.logic_knowledge_status = knowledgeComplete ? "ready" : "blocked";

  return {
    ...baseResult,
    ok: knowledgeComplete,
    blocked_reason: knowledgeComplete ? "" : "required_logic_knowledge_incomplete",
    knowledge
  };
}

/**
 * Guard: block direct legacy execution when canonical pointer is active
 * and no governed rollback is in play.
 *
 * Returns { blocked: true, reason } | { blocked: false }
 */
export function guardDirectLegacyExecution(pointerRow, rollbackAuthorized = false) {
  if (!pointerRow) return { blocked: false };

  const canonicalStatus = String(pointerRow.canonical_status || "").trim();
  const rollbackAvailable = typeof pointerRow.rollback_available === "boolean"
    ? pointerRow.rollback_available
    : String(pointerRow.rollback_available ?? "").toLowerCase() === "true";

  if (canonicalStatus === "canonical_active" && !(rollbackAvailable && rollbackAuthorized)) {
    return {
      blocked: true,
      reason: "canonical_pointer_active_blocks_direct_legacy_execution"
    };
  }

  return { blocked: false };
}
