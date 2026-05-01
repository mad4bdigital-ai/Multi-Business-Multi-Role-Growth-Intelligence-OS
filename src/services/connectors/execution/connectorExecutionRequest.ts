export type ExecutionMode =
  | "suggest_only"
  | "plan_and_confirm"
  | "auto_run_low_risk"
  | "auto_run_with_guardrails"
  | "restricted_high_risk_requires_approval";

export interface ConnectorExecutionRequest {
  planId: string;
  stepId: string;
  actionKey: string;
  connectorKey: string;
  connectedSystemId: string;
  workspaceId?: string;
  targetResourceId?: string;
  payload: Record<string, unknown>;
  executionMode: ExecutionMode | string;
}
