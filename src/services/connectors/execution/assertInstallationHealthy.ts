import type { ConnectorExecutionRequest } from "./connectorExecutionRequest";
import type { NormalizedExecutionError } from "./normalizedExecutionError";

export interface InstallationHealthResolver {
  isInstallationHealthy(request: ConnectorExecutionRequest): Promise<boolean>;
  hasPermissionGrant(request: ConnectorExecutionRequest): Promise<boolean>;
  isExecutionEligible(request: ConnectorExecutionRequest): Promise<boolean>;
}

export class InstallationHealthError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(request: ConnectorExecutionRequest) {
    super(`Installation for ${request.connectedSystemId} is not healthy.`);
    this.name = "InstallationHealthError";
    this.normalizedError = {
      errorType: "connector_unhealthy",
      message: `Connected system ${request.connectedSystemId} is not healthy.`,
      connectorKey: request.connectorKey,
      actionKey: request.actionKey,
      retryable: true,
    };
  }
}

export class PermissionGrantMissingError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(request: ConnectorExecutionRequest) {
    super(`Permission grant missing for ${request.actionKey} on ${request.connectorKey}.`);
    this.name = "PermissionGrantMissingError";
    this.normalizedError = {
      errorType: "unauthorized",
      message: `Permission grant missing for ${request.actionKey} on ${request.connectorKey}.`,
      connectorKey: request.connectorKey,
      actionKey: request.actionKey,
      retryable: false,
    };
  }
}

export class ExecutionEligibilityError extends Error {
  readonly normalizedError: NormalizedExecutionError;

  constructor(request: ConnectorExecutionRequest) {
    super(`Execution is not eligible for ${request.actionKey} on ${request.connectorKey}.`);
    this.name = "ExecutionEligibilityError";
    this.normalizedError = {
      errorType: "unsupported_action",
      message: `Execution eligibility denied for ${request.actionKey} on ${request.connectorKey}.`,
      connectorKey: request.connectorKey,
      actionKey: request.actionKey,
      retryable: false,
    };
  }
}

export async function assertInstallationHealthy(
  request: ConnectorExecutionRequest,
  resolver: InstallationHealthResolver,
): Promise<void> {
  if (!(await resolver.isInstallationHealthy(request))) {
    throw new InstallationHealthError(request);
  }
  if (!(await resolver.hasPermissionGrant(request))) {
    throw new PermissionGrantMissingError(request);
  }
  if (!(await resolver.isExecutionEligible(request))) {
    throw new ExecutionEligibilityError(request);
  }
}
