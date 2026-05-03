import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import type { ConnectorExecutionResult } from "./connectorExecutionResult";
import type { NormalizedExecutionError } from "./normalizedExecutionError";

export interface ConnectorExecutor {
  connectorKey: string;
  validateTarget(request: ConnectorExecutionRequest): Promise<void>;
  execute(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult>;
  dryRun?(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult>;
  normalizeResult?(result: unknown, request: ConnectorExecutionRequest): ConnectorExecutionResult;
  normalizeError?(error: unknown, request: ConnectorExecutionRequest): NormalizedExecutionError;
}

export interface ConnectorExecutorRegistration {
  executorKey: string;
  executor: ConnectorExecutor;
}
