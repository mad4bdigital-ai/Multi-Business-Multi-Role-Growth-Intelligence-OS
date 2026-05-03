import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import type { NormalizedExecutionError } from "./normalizedExecutionError";

export interface ConnectorReadinessResolver {
  isConnectorReady(request: ConnectorExecutionRequest): Promise<boolean>;
}

export class ConnectorNotReadyError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(request: ConnectorExecutionRequest) {
    super(`Connector ${request.connectorKey} is not ready for execution.`);
    this.name = "ConnectorNotReadyError";
    this.normalizedError = {
      errorType: "connector_unhealthy",
      message: `Connector ${request.connectorKey} is not ready for execution.`,
      connectorKey: request.connectorKey,
      actionKey: request.actionKey,
      retryable: true,
    };
  }
}

export async function assertConnectorReady(
  request: ConnectorExecutionRequest,
  resolver: ConnectorReadinessResolver,
): Promise<void> {
  const ready = await resolver.isConnectorReady(request);
  if (!ready) {
    throw new ConnectorNotReadyError(request);
  }
}
