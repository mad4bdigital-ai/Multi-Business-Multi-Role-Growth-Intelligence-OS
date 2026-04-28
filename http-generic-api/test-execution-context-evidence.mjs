import assert from "node:assert/strict";
import { buildExecutionContextEvidence } from "./execution.js";

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  console.log(`  PASS: ${label}`);
  passed++;
}

console.log("=== test-execution-context-evidence ===");

// --- routed run ---
const routed = buildExecutionContextEvidence({
  userInput: "review execution log evidence health",
  matchedAliases: ["review execution log evidence health"],
  routeKeys: ["execution_log_evidence_health_review"],
  selectedWorkflows: ["wf_execution_log_evidence_health_review"],
  engineChain: ["review_governance_module", "execution_log_validator"],
  executionMode: "review_first",
  decisionTrigger: "keyword_trigger_match",
  scoreBefore: "77",
  scoreAfter: "79"
});

ok("routed user_input", routed.user_input === "review execution log evidence health");
ok("routed matched_aliases pipe-joined", routed.matched_aliases === "review execution log evidence health");
ok("routed route_keys pipe-joined", routed.route_keys === "execution_log_evidence_health_review");
ok("routed selected_workflows pipe-joined", routed.selected_workflows === "wf_execution_log_evidence_health_review");
ok("routed engine_chain pipe-joined", routed.engine_chain === "review_governance_module|execution_log_validator");
ok("routed execution_mode", routed.execution_mode === "review_first");
ok("routed performance_delta is numeric diff", routed.performance_delta === "2");
ok("routed score_before preserved", routed.score_before === "77");

// --- direct validation run ---
const validation = buildExecutionContextEvidence({ isDirectValidation: true });

ok("validation user_input sentinel", validation.user_input === "system_validation");
ok("validation matched_aliases sentinel", validation.matched_aliases === "not_applicable");
ok("validation route_keys sentinel", validation.route_keys === "direct_validation");
ok("validation selected_workflows sentinel", validation.selected_workflows === "not_applicable");
ok("validation engine_chain sentinel", validation.engine_chain === "not_applicable");
ok("validation execution_mode sentinel", validation.execution_mode === "direct_validation");
ok("validation score_before sentinel", validation.score_before === "not_scored");
ok("validation performance_delta sentinel", validation.performance_delta === "not_scored");

console.log(`\nAll ${passed} assertions passed.`);
