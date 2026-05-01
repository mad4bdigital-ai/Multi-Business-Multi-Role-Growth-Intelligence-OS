import type { ConnectorExecutor } from "./connectorExecutor";
import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import {
  ConnectorApprovalRequiredError,
  MissingConnectorExecutorError,
  type ConnectorExecutorBinding,
  type ConnectorExecutorRegistry,
  UnsupportedConnectorActionError,
} from "../../../store/registries/connectorExecutorRegistry";

export interface ResolvedConnectorExecutor {
  binding: ConnectorExecutorBinding;
  executor: ConnectorExecutor;
}

export function resolveConnectorExecutor(
  request: ConnectorExecutionRequest,
  registry: ConnectorExecutorRegistry,
  options: { approvalGranted?: boolean } = {},
): ResolvedConnectorExecutor {
  const binding = registry.getBinding(request.actionKey, request.connectorKey);

  if (!binding || binding.status !== "active") {
    throw new UnsupportedConnectorActionError(request.actionKey, request.connectorKey);
  }

  if (binding.requiresApproval && !options.approvalGranted) {
    throw new ConnectorApprovalRequiredError(request.actionKey, request.connectorKey);
  }

  if (
    (binding.operationRisk === "write" ||
      binding.operationRisk === "control" ||
      binding.operationRisk === "destructive") &&
    !options.approvalGranted
  ) {
    throw new ConnectorApprovalRequiredError(request.actionKey, request.connectorKey);
  }

  const executor = registry.getExecutor(binding.executorKey);

  if (!executor) {
    throw new MissingConnectorExecutorError(request.actionKey, request.connectorKey, binding.executorKey);
  }

  return {
    binding,
    executor,
  };
}
