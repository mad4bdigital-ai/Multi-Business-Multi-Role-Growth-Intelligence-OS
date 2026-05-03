import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import type { ConnectorExecutionResult } from "./connectorExecutionResult";

export function buildDryRunConnectorResult(
  request: ConnectorExecutionRequest,
  warnings: string[] = [],
): ConnectorExecutionResult {
  return {
    success: true,
    connectorKey: request.connectorKey,
    actionKey: request.actionKey,
    summary: `Dry run only: ${request.actionKey} would be dispatched to ${request.connectorKey}.`,
    rawStatus: "dry_run",
    warnings,
  };
}
