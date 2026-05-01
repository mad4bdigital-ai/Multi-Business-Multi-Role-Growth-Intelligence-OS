import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import type { ConnectorExecutor } from "./connectorExecutor";
import type { NormalizedExecutionError } from "./normalizedExecutionError";

function hasStatus(error: unknown): error is { status: number; message?: string } {
  return typeof error === "object" && error !== null && "status" in error;
}

function hasNormalizedError(error: unknown): error is { normalizedError: NormalizedExecutionError } {
  return (
    typeof error === "object" &&
    error !== null &&
    "normalizedError" in error &&
    typeof (error as Record<string, unknown>).normalizedError === "object"
  );
}

export function normalizeConnectorError(
  error: unknown,
  request: ConnectorExecutionRequest,
  executor?: ConnectorExecutor,
): NormalizedExecutionError {
  if (executor?.normalizeError) {
    return executor.normalizeError(error, request);
  }

  if (hasNormalizedError(error)) {
    return error.normalizedError;
  }

  if (hasStatus(error)) {
    if (error.status === 401 || error.status === 403) {
      return {
        errorType: "unauthorized",
        message: "Connector authorization failed or is not permitted for this action.",
        connectorKey: request.connectorKey,
        actionKey: request.actionKey,
        retryable: false,
      };
    }

    if (error.status === 404) {
      return {
        errorType: "resource_not_found",
        message: "Target connector resource was not found.",
        connectorKey: request.connectorKey,
        actionKey: request.actionKey,
        retryable: false,
      };
    }

    if (error.status === 429) {
      return {
        errorType: "rate_limited",
        message: "Connector rate limit was reached.",
        connectorKey: request.connectorKey,
        actionKey: request.actionKey,
        retryable: true,
      };
    }
  }

  return {
    errorType: "temporary_failure",
    message: "Connector execution failed with a normalized runtime error.",
    connectorKey: request.connectorKey,
    actionKey: request.actionKey,
    retryable: true,
  };
}
