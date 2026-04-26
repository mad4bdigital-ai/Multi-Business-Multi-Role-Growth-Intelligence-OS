import { buildActivationEnvelope } from "./activationResponse.js";

const ALLOWED_DRIVE_BINDING = Object.freeze({
  parent_action_key: "google_drive_api",
  endpoint_key: "listDriveFiles"
});

const ALLOWED_SHEETS_BINDINGS = Object.freeze([
  "getSpreadsheet",
  "getSheetValues"
]);

function blankEvidence() {
  return {
    transport_attempted: false,
    drive_attempted: false,
    drive_ok: false,
    sheets_attempted: false,
    sheets_ok: false,
    github_attempted: false,
    github_ok: false,
    bootstrap_row_read: false,
    binding_resolved: false,
    validation_complete: false,
    rate_limited: false,
    auth_failed: false,
    executable_binding_mismatch: false,
    retry_count: 0
  };
}

function resolveGithubBindings(row) {
  const parent_action_key = String(row.github_parent_action_key || "").trim();
  const endpoint_key = String(row.github_endpoint_key || "").trim();
  const owner = String(row.github_owner || "").trim();
  const repo = String(row.github_repo || "").trim();
  const branch = String(row.github_branch || "main").trim();

  if (!parent_action_key || !endpoint_key || !owner || !repo) return null;

  return { parent_action_key, endpoint_key, owner, repo, branch };
}

/**
 * Runs the governed three-step provider chain:
 *   1. Google Drive  (parent_action_key: google_drive_api, endpoint_key: listDriveFiles)
 *   2. Google Sheets (parent_action_key: google_sheets_api, endpoint_key: getSpreadsheet|getSheetValues)
 *   3. Read Activation Bootstrap Config!A2:J2 → resolve GitHub bindings
 *   4. GitHub        (parent_action_key/endpoint_key resolved from bootstrap row only)
 *
 * Each step records boolean evidence before classifying.
 * Returns { evidence, runtime_classification, recovery, operator_view }.
 *
 * deps must supply:
 *   attemptDrive()       → { ok, auth_failed? }
 *   attemptSheets()      → { ok, rate_limited?, auth_failed? }
 *   readBootstrapRow()   → { ok, row? }  row has github_* fields
 *   attemptGitHub(bindings) → { ok, auth_failed? }
 */
export async function runGovernedActivation(deps = {}) {
  const { attemptDrive, attemptSheets, readBootstrapRow, attemptGitHub } = deps;
  const evidence = blankEvidence();

  // ── Step 1: Google Drive ────────────────────────────────────────────────────
  evidence.transport_attempted = true;
  evidence.drive_attempted = true;

  const driveResult = await attemptDrive(ALLOWED_DRIVE_BINDING);
  if (!driveResult.ok) {
    if (driveResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.drive_ok = true;

  // ── Step 2: Google Sheets ───────────────────────────────────────────────────
  evidence.sheets_attempted = true;

  const sheetsResult = await attemptSheets({
    parent_action_key: "google_sheets_api",
    endpoint_key: ALLOWED_SHEETS_BINDINGS[0]
  });
  if (!sheetsResult.ok) {
    if (sheetsResult.rate_limited) evidence.rate_limited = true;
    if (sheetsResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.sheets_ok = true;

  // ── Step 3: Bootstrap row ───────────────────────────────────────────────────
  const bootstrapResult = await readBootstrapRow();
  if (!bootstrapResult.ok || !bootstrapResult.row) {
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.bootstrap_row_read = true;

  const githubBindings = resolveGithubBindings(bootstrapResult.row);
  if (!githubBindings) {
    evidence.executable_binding_mismatch = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.binding_resolved = true;

  // ── Step 4: GitHub (bindings from bootstrap row only) ──────────────────────
  evidence.github_attempted = true;

  const githubResult = await attemptGitHub(githubBindings);
  if (!githubResult.ok) {
    if (githubResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.github_ok = true;
  evidence.validation_complete = true;

  return { evidence, ...buildActivationEnvelope(evidence) };
}
