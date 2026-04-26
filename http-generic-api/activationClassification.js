export const ACTIVATION_STATUSES = Object.freeze({
  ACTIVE: "active",
  VALIDATING: "validating",
  DEGRADED: "degraded",
  AUTHORIZATION_GATED: "authorization_gated",
  VALIDATION_RATE_LIMITED: "validation_rate_limited"
});

export const ACTIVATION_REASON_CODES = Object.freeze({
  PROVIDER_CHAIN_COMPLETE: "provider_chain_complete",
  PROVIDER_CHAIN_INCOMPLETE: "provider_chain_incomplete",
  MISSING_REQUIRED_ACTIVATION_TRANSPORT_ATTEMPT: "missing_required_activation_transport_attempt",
  MISSING_REGISTRY_RESOLVED_ENDPOINT_BINDING: "missing_registry_resolved_endpoint_binding",
  EXECUTABLE_BINDING_MISMATCH: "executable_binding_mismatch",
  GOOGLE_SHEETS_RATE_LIMITED: "google_sheets_rate_limited",
  AUTHORIZATION_FAILED: "authorization_failed",
  MISSING_REQUIRED_PATH_PARAMS: "missing_required_path_params",
  VALIDATION_INCOMPLETE: "validation_incomplete"
});

export function createActivationEvidence(input = {}) {
  return {
    transport_attempted: !!input.transport_attempted,
    drive_attempted: !!input.drive_attempted,
    drive_ok: !!input.drive_ok,
    sheets_attempted: !!input.sheets_attempted,
    sheets_ok: !!input.sheets_ok,
    github_attempted: !!input.github_attempted,
    github_ok: !!input.github_ok,
    bootstrap_row_read: !!input.bootstrap_row_read,
    binding_resolved: !!input.binding_resolved,
    validation_complete: !!input.validation_complete,
    rate_limited: !!input.rate_limited,
    auth_failed: !!input.auth_failed,
    missing_required_path_params: !!input.missing_required_path_params,
    executable_binding_mismatch: !!input.executable_binding_mismatch
  };
}

export function classifyActivation(evidenceInput = {}) {
  const evidence = createActivationEvidence(evidenceInput);

  if (!evidence.transport_attempted) {
    return {
      activation_status: ACTIVATION_STATUSES.DEGRADED,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.MISSING_REQUIRED_ACTIVATION_TRANSPORT_ATTEMPT,
      evidence
    };
  }

  if (evidence.rate_limited) {
    return {
      activation_status: ACTIVATION_STATUSES.VALIDATION_RATE_LIMITED,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.GOOGLE_SHEETS_RATE_LIMITED,
      evidence
    };
  }

  if (evidence.auth_failed) {
    return {
      activation_status: ACTIVATION_STATUSES.AUTHORIZATION_GATED,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.AUTHORIZATION_FAILED,
      evidence
    };
  }

  if (evidence.executable_binding_mismatch) {
    return {
      activation_status: ACTIVATION_STATUSES.DEGRADED,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.EXECUTABLE_BINDING_MISMATCH,
      evidence
    };
  }

  if (evidence.missing_required_path_params) {
    return {
      activation_status: ACTIVATION_STATUSES.DEGRADED,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.MISSING_REQUIRED_PATH_PARAMS,
      evidence
    };
  }

  if (
    evidence.drive_ok &&
    evidence.sheets_ok &&
    evidence.github_ok &&
    evidence.bootstrap_row_read &&
    evidence.binding_resolved &&
    evidence.validation_complete
  ) {
    return {
      activation_status: ACTIVATION_STATUSES.ACTIVE,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.PROVIDER_CHAIN_COMPLETE,
      evidence
    };
  }

  if (
    evidence.transport_attempted &&
    (evidence.drive_ok || evidence.sheets_ok || evidence.github_ok || evidence.bootstrap_row_read)
  ) {
    return {
      activation_status: ACTIVATION_STATUSES.VALIDATING,
      status_authority: "runtime_canonical",
      reason_code: ACTIVATION_REASON_CODES.VALIDATION_INCOMPLETE,
      evidence
    };
  }

  return {
    activation_status: ACTIVATION_STATUSES.DEGRADED,
    status_authority: "runtime_canonical",
    reason_code: ACTIVATION_REASON_CODES.PROVIDER_CHAIN_INCOMPLETE,
    evidence
  };
}
