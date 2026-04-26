export function buildActivationRecoveryPolicy(classification = {}) {
  const status = String(classification.activation_status || "").trim();
  const reason = String(classification.reason_code || "").trim();

  if (status === "active") {
    return { retryable: false, recommended_action: "none", retry_after_seconds: null };
  }

  if (status === "validation_rate_limited") {
    return {
      retryable: true,
      recommended_action: "retry_after_backoff",
      retry_after_seconds: 300
    };
  }

  if (status === "authorization_gated") {
    return {
      retryable: false,
      recommended_action: "repair_credentials",
      retry_after_seconds: null
    };
  }

  if (reason === "missing_registry_resolved_endpoint_binding") {
    return {
      retryable: false,
      recommended_action: "repair_binding",
      retry_after_seconds: null
    };
  }

  if (reason === "missing_required_path_params") {
    return {
      retryable: false,
      recommended_action: "supply_missing_params",
      retry_after_seconds: null
    };
  }

  return {
    retryable: false,
    recommended_action: status === "validating" ? "continue_validation" : "re_read_bootstrap",
    retry_after_seconds: null
  };
}
