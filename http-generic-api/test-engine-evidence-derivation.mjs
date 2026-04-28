import { buildEngineEvidenceFromWorkflow } from "./execution.js";

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

// -- explicit evidence takes priority ----------------------------------------
const explicitResult = buildEngineEvidenceFromWorkflow({
  used_engine_names: "GPT-4",
  used_engine_registry_refs: "GPT-4",
  used_engine_file_ids: "file_001",
  engine_resolution_status: "resolved",
  engine_association_status: "associated"
});

assert("explicit: used_engine_names preserved", explicitResult.used_engine_names === "GPT-4", JSON.stringify(explicitResult));
assert("explicit: engine_resolution_status preserved", explicitResult.engine_resolution_status === "resolved", JSON.stringify(explicitResult));

// -- derive from workflow row + registry -------------------------------------
const engineRegistryRows = [
  { engine_name: "GPT-4", file_id: "file_gpt4" },
  { engine_name: "Claude", file_id: "file_claude" }
];

const derivedResult = buildEngineEvidenceFromWorkflow({
  selectedWorkflowRow: { "Mapped Engine(s)": "GPT-4|Claude" },
  engineRegistryRows
});

assert("derived: used_engine_names populated", derivedResult.used_engine_names === "GPT-4|Claude", JSON.stringify(derivedResult));
assert("derived: engine_resolution_status resolved when all matched", derivedResult.engine_resolution_status === "resolved", JSON.stringify(derivedResult));

// -- partial resolution when one engine not found ----------------------------
const partialResult = buildEngineEvidenceFromWorkflow({
  selectedWorkflowRow: { "Mapped Engine(s)": "GPT-4,UnknownEngine" },
  engineRegistryRows
});

assert("partial: engine_resolution_status is partially_resolved", partialResult.engine_resolution_status === "partially_resolved", JSON.stringify(partialResult));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
