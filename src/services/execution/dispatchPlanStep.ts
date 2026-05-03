import { assertConnectorReady, type ConnectorReadinessResolver } from "../connectors/execution/assertConnectorReady";
import {
  assertInstallationHealthy,
  type InstallationHealthResolver,
} from "../connectors/execution/assertInstallationHealthy";
import { buildDryRunConnectorResult } from "../connectors/execution/buildDryRunConnectorResult";
import type { ConnectorExecutionRequest } from "../connectors/execution/connectorExecutionRequest";
import type { ConnectorExecutionResult } from "../connectors/execution/connectorExecutionResult";
import { normalizeConnectorError } from "../connectors/execution/normalizeConnectorError";
import { resolveConnectorExecutor } from "../connectors/execution/resolveConnectorExecutor";
import type { ConnectorExecutorRegistry } from "../../store/registries/connectorExecutorRegistry";

export type DispatchPlanStepStatus = "completed" | "dry_run" | "failed";

export interface DispatchPlanStepResult {
  success: boolean;
  status: DispatchPlanStepStatus;
  result?: ConnectorExecutionResult;
  error?: ReturnType<typeof normalizeConnectorError>;
}

export interface DispatchPlanStepDependencies {
  executorRegistry: ConnectorExecutorRegistry;
  readinessResolver: ConnectorReadinessResolver;
  installationHealthResolver: InstallationHealthResolver;
}

export interface DispatchPlanStepOptions {
  approvalGranted?: boolean;
  dryRun?: boolean;
}

export async function dispatchPlanStep(
  request: ConnectorExecutionRequest,
  dependencies: DispatchPlanStepDependencies,
  options: DispatchPlanStepOptions = {},
): Promise<DispatchPlanStepResult> {
  try {
    if (request.executionMode === "suggest_only") {
      return {
        success: true,
        status: "dry_run",
        result: buildDryRunConnectorResult(request, ["suggest_only mode never executes provider operations."]),
      };
    }

    const { executor } = resolveConnectorExecutor(request, dependencies.executorRegistry, {
      approvalGranted: options.approvalGranted,
    });

    await assertConnectorReady(request, dependencies.readinessResolver);
    await assertInstallationHealthy(request, dependencies.installationHealthResolver);
    await executor.validateTarget(request);

    if (options.dryRun || request.executionMode === "plan_and_confirm") {
      const result = executor.dryRun
        ? await executor.dryRun(request)
        : buildDryRunConnectorResult(request, ["Executor does not implement a connector-specific dry run."]);

      return {
        success: true,
        status: "dry_run",
        result,
      };
    }

    return {
      success: true,
      status: "completed",
      result: await executor.execute(request),
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error: normalizeConnectorError(error, request),
    };
  }
}
