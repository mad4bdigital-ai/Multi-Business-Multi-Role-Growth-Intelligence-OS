import { classifyActivation } from "./activationClassification.js";

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

console.log("== activation classification ==");

{
  const result = classifyActivation({ transport_attempted: false });
  assert(
    "missing transport becomes degraded",
    result.activation_status === "degraded" &&
      result.reason_code === "missing_required_activation_transport_attempt",
    JSON.stringify(result)
  );
}

{
  const result = classifyActivation({
    transport_attempted: true,
    drive_ok: true,
    sheets_ok: true,
    github_ok: true,
    bootstrap_row_read: true,
    binding_resolved: true,
    validation_complete: true
  });
  assert(
    "full provider chain becomes active",
    result.activation_status === "active",
    JSON.stringify(result)
  );
}

{
  const result = classifyActivation({
    transport_attempted: true,
    drive_ok: true,
    sheets_ok: false,
    rate_limited: true
  });
  assert(
    "rate-limited sheets becomes validation_rate_limited",
    result.activation_status === "validation_rate_limited",
    JSON.stringify(result)
  );
}

{
  const result = classifyActivation({
    transport_attempted: true,
    drive_ok: true,
    auth_failed: true
  });
  assert(
    "auth failure becomes authorization_gated",
    result.activation_status === "authorization_gated",
    JSON.stringify(result)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
