import type { ConnectorExecutionRequest } from "../connectors/execution/connectorExecutionRequest";
import type { ConnectorExecutionResult } from "../connectors/execution/connectorExecutionResult";
import type { ConnectorExecutorRegistry } from "../../store/registries/connectorExecutorRegistry";
import {
  dispatchPlanStep,
  type DispatchPlanStepDependencies,
  type DispatchPlanStepOptions,
  type DispatchPlanStepResult,
} from "./dispatchPlanStep";

export interface ExecutionResolverRuntimeGateDependencies
  extends DispatchPlanStepDependencies {
  executorRegistry: ConnectorExecutorRegistry;
}

export interface ExecutionResolverRuntimeGateInput {
  request: ConnectorExecutionRequest;
  approvalGranted?: boolean;
  dryRun?: boolean;
}

export interface ExecutionResolverRuntimeGateSuccess {
  ok: true;
  result: ConnectorExecutionResult;
  dryRun: boolean;
}

export interface ExecutionResolverRuntimeGateFailure {
  ok: false;
  errorType: string;
  message: string;
  retryable: boolean;
}

export type ExecutionResolverRuntimeGateResult =
  | ExecutionResolverRuntimeGateSuccess
  | ExecutionResolverRuntimeGateFailure;

export async function runExecutionResolverRuntimeGate(
  input: ExecutionResolverRuntimeGateInput,
  dependencies: ExecutionResolverRuntimeGateDependencies,
): Promise<ExecutionResolverRuntimeGateResult> {
  const options: DispatchPlanStepOptions = {
    approvalGranted: input.approvalGranted,
    dryRun: input.dryRun,
  };

  const dispatchResult: DispatchPlanStepResult = await dispatchPlanStep(input.request, dependencies, options);

  if (!dispatchResult.success || !dispatchResult.result) {
    return {
      ok: false,
      errorType: dispatchResult.error?.errorType ?? "execution_failed",
      message: dispatchResult.error?.message ?? "Execution resolver runtime gate failed.",
      retryable: dispatchResult.error?.retryable ?? false,
    };
  }

  return {
    ok: true,
    result: dispatchResult.result,
    dryRun: dispatchResult.status === "dry_run",
  };
}
