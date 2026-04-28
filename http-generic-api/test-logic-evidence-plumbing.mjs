import { resolveLogicPointerContext } from "./resolveLogicPointerContext.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

// -- canonical path ----------------------------------------------------------
const result = resolveLogicPointerContext(
  { logic_id: "logic.pointer.test", require_knowledge: false },
  {
    getPointerRow() {
      return {
        canonical_status: "canonical_active",
        canonical_doc_id: "LOGIC_CANONICAL_001",
        legacy_doc_id: "LOGIC_LEGACY_001",
        rollback_available: true,
        active_pointer: "logic.pointer.test"
      };
    },
    isRollbackAuthorized() { return false; }
  }
);

assert("resolver ok", result.ok === true, JSON.stringify(result));
assert("resolved_logic_doc_id emitted", result.state.resolved_logic_doc_id === "LOGIC_CANONICAL_001", JSON.stringify(result.state));
assert("resolved_logic_mode emitted", result.state.resolved_logic_mode === "canonical", JSON.stringify(result.state));
assert("logic_association_status emitted", result.state.logic_association_status === "associated", JSON.stringify(result.state));
assert("used_logic_id emitted", result.state.used_logic_id === "logic.pointer.test", JSON.stringify(result.state));
assert("used_logic_name emitted", result.state.used_logic_name === "logic.pointer.test", JSON.stringify(result.state));
assert("logic_rollback_status is available_not_used", result.state.logic_rollback_status === "available_not_used", JSON.stringify(result.state));
assert("logic_knowledge_status is not_required", result.state.logic_knowledge_status === "not_required", JSON.stringify(result.state));

// -- rollback path -----------------------------------------------------------
const rollbackResult = resolveLogicPointerContext(
  { logic_id: "logic.pointer.test", require_knowledge: false },
  {
    getPointerRow() {
      return {
        canonical_status: "canonical_active",
        canonical_doc_id: "LOGIC_CANONICAL_001",
        legacy_doc_id: "LOGIC_LEGACY_001",
        rollback_available: true,
        active_pointer: "logic.pointer.test"
      };
    },
    isRollbackAuthorized() { return true; }
  }
);

assert("rollback ok", rollbackResult.ok === true, JSON.stringify(rollbackResult));
assert("rollback resolved_logic_mode is legacy", rollbackResult.state.resolved_logic_mode === "legacy", JSON.stringify(rollbackResult.state));
assert("rollback logic_rollback_status is used", rollbackResult.state.logic_rollback_status === "used", JSON.stringify(rollbackResult.state));

// -- legacy_recovery pointer path --------------------------------------------
const legacyResult = resolveLogicPointerContext(
  { logic_id: "logic.legacy.test", require_knowledge: false },
  {
    getPointerRow() {
      return {
        canonical_status: "legacy_recovery",
        canonical_doc_id: "",
        legacy_doc_id: "LOGIC_LEGACY_001",
        rollback_available: false,
        active_pointer: "legacy_recovery"
      };
    }
  }
);

assert("legacy_recovery ok", legacyResult.ok === true, JSON.stringify(legacyResult));
assert("legacy_recovery resolved_logic_mode is legacy", legacyResult.state.resolved_logic_mode === "legacy", JSON.stringify(legacyResult.state));
assert("legacy_recovery logic_rollback_status is legacy_path", legacyResult.state.logic_rollback_status === "legacy_path", JSON.stringify(legacyResult.state));

// -- knowledge required + complete -------------------------------------------
const knowledgeResult = resolveLogicPointerContext(
  { logic_id: "logic.pointer.test", require_knowledge: true },
  {
    getPointerRow() {
      return {
        canonical_status: "canonical_active",
        canonical_doc_id: "LOGIC_CANONICAL_001",
        legacy_doc_id: "",
        rollback_available: false,
        active_pointer: "canonical_active"
      };
    },
    getKnowledgeProfile() {
      return {
        knowledge_profile_key: "profile_001",
        required_knowledge_layers: ["brand_core"],
        knowledge_read_targets: ["Brand Core Registry"],
        knowledge_read_completeness_status: "validated",
        missing_required_knowledge_sources: []
      };
    }
  }
);

assert("knowledge complete ok", knowledgeResult.ok === true, JSON.stringify(knowledgeResult));
assert("logic_knowledge_status is ready when complete", knowledgeResult.state.logic_knowledge_status === "ready", JSON.stringify(knowledgeResult.state));

// -- knowledge required + incomplete -----------------------------------------
const knowledgeBlockedResult = resolveLogicPointerContext(
  { logic_id: "logic.pointer.test", require_knowledge: true },
  {
    getPointerRow() {
      return {
        canonical_status: "canonical_active",
        canonical_doc_id: "LOGIC_CANONICAL_001",
        legacy_doc_id: "",
        rollback_available: false,
        active_pointer: "canonical_active"
      };
    },
    getKnowledgeProfile() {
      return {
        knowledge_profile_key: "profile_001",
        required_knowledge_layers: ["brand_core"],
        knowledge_read_targets: ["Brand Core Registry"],
        knowledge_read_completeness_status: "degraded",
        missing_required_knowledge_sources: ["Brand Core Registry"]
      };
    }
  }
);

assert("knowledge incomplete not ok", knowledgeBlockedResult.ok === false, JSON.stringify(knowledgeBlockedResult));
assert("logic_knowledge_status is blocked when incomplete", knowledgeBlockedResult.state.logic_knowledge_status === "blocked", JSON.stringify(knowledgeBlockedResult.state));
assert("blocked_reason set", knowledgeBlockedResult.blocked_reason === "required_logic_knowledge_incomplete", JSON.stringify(knowledgeBlockedResult));

// -- resolver state is sink-compatible (no translation step needed) ----------
const sinkCompatFields = [
  "used_logic_id",
  "used_logic_name",
  "resolved_logic_doc_id",
  "resolved_logic_mode",
  "logic_pointer_resolution_status",
  "logic_knowledge_status",
  "logic_rollback_status",
  "logic_association_status"
];

for (const field of sinkCompatFields) {
  assert(
    `state has sink-compatible field: ${field}`,
    Object.prototype.hasOwnProperty.call(result.state, field),
    JSON.stringify(Object.keys(result.state))
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
