export type NormalizedExecutionErrorType =
  | "unauthorized"
  | "resource_not_found"
  | "validation_failed"
  | "rate_limited"
  | "temporary_failure"
  | "unsupported_action"
  | "connector_unhealthy"
  | "approval_required";

export interface NormalizedExecutionError {
  errorType: NormalizedExecutionErrorType;
  message: string;
  connectorKey?: string;
  actionKey?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}
