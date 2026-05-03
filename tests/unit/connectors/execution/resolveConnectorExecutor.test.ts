import {
  ConnectorApprovalRequiredError,
  InMemoryConnectorExecutorRegistry,
  UnsupportedConnectorActionError,
} from "../../../../src/store/registries/connectorExecutorRegistry";
import { resolveConnectorExecutor } from "../../../../src/services/connectors/execution/resolveConnectorExecutor";
import type { ConnectorExecutor } from "../../../../src/services/connectors/execution/connectorExecutor";
import type { ConnectorExecutionRequest } from "../../../../src/services/connectors/execution/connectorExecutionRequest";

const request: ConnectorExecutionRequest = {
  planId: "plan_1",
  stepId: "step_1",
  actionKey: "list_drive_resources",
  connectorKey: "google_drive",
  connectedSystemId: "system_1",
  payload: {},
  executionMode: "auto_run_low_risk",
};

const executor: ConnectorExecutor = {
  connectorKey: "google_drive",
  validateTarget: async () => undefined,
  execute: async (req) => ({
    success: true,
    connectorKey: req.connectorKey,
    actionKey: req.actionKey,
    summary: "ok",
  }),
};

describe("resolveConnectorExecutor", () => {
  it("resolves an active read-only binding by action and connector", () => {
    const registry = new InMemoryConnectorExecutorRegistry({
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
    });

    const resolved = resolveConnectorExecutor(request, registry);

    expect(resolved.executor.connectorKey).toBe("google_drive");
  });

  it("rejects unsupported action/connector combinations", () => {
    const registry = new InMemoryConnectorExecutorRegistry();

    expect(() => resolveConnectorExecutor(request, registry)).toThrow(UnsupportedConnectorActionError);
  });

  it("requires approval for write/control/destructive bindings", () => {
    const registry = new InMemoryConnectorExecutorRegistry({
      executors: [{ executorKey: "google_drive_executor", executor }],
      bindings: [
        {
          actionKey: "create_drive_folder",
          connectorKey: "google_drive",
          executorKey: "google_drive_executor",
          operationRisk: "write",
          requiresApproval: true,
          status: "active",
        },
      ],
    });

    expect(() =>
      resolveConnectorExecutor(
        {
          ...request,
          actionKey: "create_drive_folder",
        },
        registry,
      ),
    ).toThrow(ConnectorApprovalRequiredError);
  });
});
