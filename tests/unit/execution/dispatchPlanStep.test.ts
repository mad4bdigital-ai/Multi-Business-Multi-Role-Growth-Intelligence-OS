import { dispatchPlanStep } from "../../../src/services/execution/dispatchPlanStep";
import { InMemoryConnectorExecutorRegistry } from "../../../src/store/registries/connectorExecutorRegistry";
import type { ConnectorExecutor } from "../../../src/services/connectors/execution/connectorExecutor";
import type { ConnectorExecutionRequest } from "../../../src/services/connectors/execution/connectorExecutionRequest";

const executor: ConnectorExecutor = {
  connectorKey: "google_drive",
  validateTarget: async () => undefined,
  dryRun: async (req) => ({
    success: true,
    connectorKey: req.connectorKey,
    actionKey: req.actionKey,
    summary: "dry run",
    rawStatus: "dry_run",
  }),
  execute: async (req) => ({
    success: true,
    connectorKey: req.connectorKey,
    actionKey: req.actionKey,
    summary: "executed",
  }),
};

const request: ConnectorExecutionRequest = {
  planId: "plan_1",
  stepId: "step_1",
  actionKey: "list_drive_resources",
  connectorKey: "google_drive",
  connectedSystemId: "system_1",
  payload: {},
  executionMode: "auto_run_low_risk",
};

const dependencies = {
  executorRegistry: new InMemoryConnectorExecutorRegistry({
    executors: [{ executorKey: "google_drive_executor", executor }],
    bindings: [
      {
        actionKey: "list_drive_resources",
        connectorKey: "google_drive",
        executorKey: "google_drive_executor",
        operationRisk: "read_only",
        requiresApproval: false,
        status: "active",
      },
    ],
  }),
  readinessResolver: {
    isConnectorReady: async () => true,
  },
  installationHealthResolver: {
    isInstallationHealthy: async () => true,
    hasPermissionGrant: async () => true,
    isExecutionEligible: async () => true,
  },
};

describe("dispatchPlanStep", () => {
  it("dispatches through the resolver and executor", async () => {
    const result = await dispatchPlanStep(request, dependencies);

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.result?.summary).toBe("executed");
  });

  it("returns dry-run output without provider side effects", async () => {
    const result = await dispatchPlanStep(request, dependencies, { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe("dry_run");
    expect(result.result?.rawStatus).toBe("dry_run");
  });

  it("blocks execution when permission grant is missing", async () => {
    const result = await dispatchPlanStep(request, {
      ...dependencies,
      installationHealthResolver: {
        isInstallationHealthy: async () => true,
        hasPermissionGrant: async () => false,
        isExecutionEligible: async () => true,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.errorType).toBe("unauthorized");
  });
});
