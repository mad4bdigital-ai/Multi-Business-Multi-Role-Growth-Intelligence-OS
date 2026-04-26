import { runGovernedActivation } from "./governedActivationRunner.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

const VALID_BOOTSTRAP_ROW = {
  github_parent_action_key: "github_api_mcp",
  github_endpoint_key: "getRepositoryContent",
  github_owner: "mad4bdigital-ai",
  github_repo: "multi-business-multi-role-growth-intelligence-os",
  github_branch: "main"
};

function fullDeps(overrides = {}) {
  return {
    attemptDrive: async () => ({ ok: true }),
    attemptSheets: async () => ({ ok: true }),
    readBootstrapRow: async () => ({ ok: true, row: VALID_BOOTSTRAP_ROW }),
    attemptGitHub: async () => ({ ok: true }),
    ...overrides
  };
}

section("no transport started → degraded");
{
  // Drive fails immediately
  const result = await runGovernedActivation(fullDeps({
    attemptDrive: async () => ({ ok: false })
  }));
  assert("drive fail → degraded", result.runtime_classification?.activation_status === "degraded", JSON.stringify(result.runtime_classification));
  assert("drive fail → transport_attempted true", result.evidence?.transport_attempted === true);
  assert("drive fail → drive_ok false", result.evidence?.drive_ok === false);
  assert("drive fail → recovery re_read_bootstrap", result.recovery?.recommended_action === "re_read_bootstrap");
}

section("auth failure → authorization_gated");
{
  const result = await runGovernedActivation(fullDeps({
    attemptDrive: async () => ({ ok: false, auth_failed: true })
  }));
  assert("auth fail → authorization_gated", result.runtime_classification?.activation_status === "authorization_gated", JSON.stringify(result.runtime_classification));
  assert("auth fail → recovery repair_credentials", result.recovery?.recommended_action === "repair_credentials");
  assert("auth fail → not retryable", result.recovery?.retryable === false);
}

section("Sheets 429 → validation_rate_limited");
{
  const result = await runGovernedActivation(fullDeps({
    attemptSheets: async () => ({ ok: false, rate_limited: true })
  }));
  assert("sheets 429 → validation_rate_limited", result.runtime_classification?.activation_status === "validation_rate_limited", JSON.stringify(result.runtime_classification));
  assert("sheets 429 → recovery retry_after_backoff", result.recovery?.recommended_action === "retry_after_backoff");
  assert("sheets 429 → retryable true", result.recovery?.retryable === true);
  assert("sheets 429 → drive completed", result.evidence?.drive_ok === true);
  assert("sheets 429 → sheets_ok false", result.evidence?.sheets_ok === false);
}

section("bootstrap row missing → degraded");
{
  const result = await runGovernedActivation(fullDeps({
    readBootstrapRow: async () => ({ ok: false })
  }));
  // drive+sheets succeeded → partial chain → validating (not degraded)
  assert("no bootstrap → validating", result.runtime_classification?.activation_status === "validating", JSON.stringify(result.runtime_classification));
  assert("no bootstrap → sheets completed", result.evidence?.sheets_ok === true);
  assert("no bootstrap → bootstrap_row_read false", result.evidence?.bootstrap_row_read === false);
}

section("incomplete GitHub bindings → degraded (executable_binding_mismatch)");
{
  const result = await runGovernedActivation(fullDeps({
    readBootstrapRow: async () => ({
      ok: true,
      row: { github_parent_action_key: "github_api_mcp", github_endpoint_key: "" }
    })
  }));
  assert("bad bindings → degraded", result.runtime_classification?.activation_status === "degraded", JSON.stringify(result.runtime_classification));
  assert("bad bindings → executable_binding_mismatch", result.evidence?.executable_binding_mismatch === true);
  assert("bad bindings → recovery repair_binding", result.recovery?.recommended_action === "repair_binding");
}

section("GitHub call fails → degraded");
{
  const result = await runGovernedActivation(fullDeps({
    attemptGitHub: async () => ({ ok: false })
  }));
  // drive+sheets+bootstrap succeeded → partial chain → validating
  assert("github fail → validating", result.runtime_classification?.activation_status === "validating", JSON.stringify(result.runtime_classification));
  assert("github fail → binding_resolved true", result.evidence?.binding_resolved === true);
  assert("github fail → github_ok false", result.evidence?.github_ok === false);
}

section("GitHub bindings must come from bootstrap row only");
{
  let capturedBindings = null;
  const result = await runGovernedActivation(fullDeps({
    attemptGitHub: async (bindings) => {
      capturedBindings = bindings;
      return { ok: true };
    }
  }));
  assert("github binding parent_action_key from row", capturedBindings?.parent_action_key === "github_api_mcp");
  assert("github binding endpoint_key from row", capturedBindings?.endpoint_key === "getRepositoryContent");
  assert("github binding owner from row", capturedBindings?.owner === "mad4bdigital-ai");
  assert("github binding repo from row", capturedBindings?.repo === "multi-business-multi-role-growth-intelligence-os");
}

section("full provider chain → active");
{
  const result = await runGovernedActivation(fullDeps());
  assert("full chain → active", result.runtime_classification?.activation_status === "active", JSON.stringify(result.runtime_classification));
  assert("full chain → all evidence true", (
    result.evidence?.transport_attempted &&
    result.evidence?.drive_ok &&
    result.evidence?.sheets_ok &&
    result.evidence?.bootstrap_row_read &&
    result.evidence?.binding_resolved &&
    result.evidence?.github_ok &&
    result.evidence?.validation_complete
  ), JSON.stringify(result.evidence));
  assert("full chain → recovery none", result.recovery?.recommended_action === "none");
  assert("full chain → not retryable", result.recovery?.retryable === false);
  assert("full chain → operator view active headline", result.operator_view?.headline === "Activation is complete.");
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
