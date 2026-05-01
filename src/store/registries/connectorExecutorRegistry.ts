import type { ConnectorExecutor } from "../../services/connectors/execution/connectorExecutor";
import type { NormalizedExecutionError } from "../../services/connectors/execution/normalizedExecutionError";

export type OperationRisk = "read_only" | "write" | "control" | "destructive";

export interface ConnectorExecutorBinding {
  actionKey: string;
  connectorKey: string;
  executorKey: string;
  operationRisk: OperationRisk;
  requiresApproval: boolean;
  status: "active" | "inactive";
}

export interface ConnectorExecutorRegistry {
  getExecutor(executorKey: string): ConnectorExecutor | undefined;
  getBinding(actionKey: string, connectorKey: string): ConnectorExecutorBinding | undefined;
}

export class InMemoryConnectorExecutorRegistry implements ConnectorExecutorRegistry {
  private readonly executors = new Map<string, ConnectorExecutor>();
  private readonly bindings = new Map<string, ConnectorExecutorBinding>();

  constructor(params?: {
    executors?: Array<{ executorKey: string; executor: ConnectorExecutor }>;
    bindings?: ConnectorExecutorBinding[];
  }) {
    params?.executors?.forEach(({ executorKey, executor }) => {
      this.executors.set(executorKey, executor);
    });

    params?.bindings?.forEach((binding) => {
      this.bindings.set(this.bindingKey(binding.actionKey, binding.connectorKey), binding);
    });
  }

  getExecutor(executorKey: string): ConnectorExecutor | undefined {
    return this.executors.get(executorKey);
  }

  getBinding(actionKey: string, connectorKey: string): ConnectorExecutorBinding | undefined {
    return this.bindings.get(this.bindingKey(actionKey, connectorKey));
  }

  private bindingKey(actionKey: string, connectorKey: string): string {
    return `${connectorKey}:${actionKey}`;
  }
}

export class UnsupportedConnectorActionError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(actionKey: string, connectorKey: string) {
    super(`Unsupported action/connector combination: ${actionKey} on ${connectorKey}`);
    this.name = "UnsupportedConnectorActionError";
    this.normalizedError = {
      errorType: "unsupported_action",
      message: `Action ${actionKey} is not registered for connector ${connectorKey}.`,
      connectorKey,
      actionKey,
      retryable: false,
    };
  }
}

export class ConnectorApprovalRequiredError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(actionKey: string, connectorKey: string) {
    super(`Approval required before dispatching ${actionKey} on ${connectorKey}`);
    this.name = "ConnectorApprovalRequiredError";
    this.normalizedError = {
      errorType: "approval_required",
      message: `Action ${actionKey} requires governed approval before execution.`,
      connectorKey,
      actionKey,
      retryable: false,
    };
  }
}

export class MissingConnectorExecutorError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(actionKey: string, connectorKey: string, executorKey: string) {
    super(`Executor ${executorKey} is not registered for ${actionKey} on ${connectorKey}`);
    this.name = "MissingConnectorExecutorError";
    this.normalizedError = {
      errorType: "connector_unhealthy",
      message: `Executor ${executorKey} is not available for ${connectorKey}.`,
      connectorKey,
      actionKey,
      retryable: false,
      details: { executorKey },
    };
  }
}
