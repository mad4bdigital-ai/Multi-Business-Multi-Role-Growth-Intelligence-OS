import { runExecutionResolverRuntimeGate } from "../../../src/services/execution/executionResolverRuntimeGate";
import type { ConnectorExecutor } from "../../../src/services/connectors/execution/connectorExecutor";
import type { ConnectorExecutionRequest } from "../../../src/services/connectors/execution/connectorExecutionRequest";
import { InMemoryConnectorExecutorRegistry } from "../../../src/store/registries/connectorExecutorRegistry";

function buildRequest(overrides: Partial<ConnectorExecutionRequest> = {}): ConnectorExecutionRequest {
  return {
    planId: "plan-1",
    stepId: "step-1",
    actionKey: "wordpressGetPost",
    connectorKey: "wordpress_api",
    connectedSystemId: "wp-system-1",
    payload: { id: 1 },
    executionMode: "auto_run_low_risk",
    ...overrides,
  };
}

function buildExecutor(): ConnectorExecutor {
  return {
    connectorKey: "wordpress_api",
    validateTarget: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue({
      success: true,
      connectorKey: "wordpress_api",
      actionKey: "wordpressGetPost",
      summary: "post fetched",
    }),
    dryRun: jest.fn().mockResolvedValue({
      success: true,
      connectorKey: "wordpress_api",
      actionKey: "wordpressGetPost",
      summary: "dry run",
      rawStatus: "dry_run",
    }),
  };
}

function buildDependencies(executor: ConnectorExecutor) {
  return {
    executorRegistry: new InMemoryConnectorExecutorRegistry({
      executors: [{ executorKey: "wordpress-read-executor", executor }],
      bindings: [
        {
          actionKey: "wordpressGetPost",
          connectorKey: "wordpress_api",
          executorKey: "wordpress-read-executor",
          operationRisk: "read_only" as const,
          requiresApproval: false,
          status: "active" as const,
        },
      ],
    }),
    readinessResolver: {
      isConnectorReady: jest.fn().mockResolvedValue(true),
    },
    installationHealthResolver: {
      isInstallationHealthy: jest.fn().mockResolvedValue(true),
      hasPermissionGrant: jest.fn().mockResolvedValue(true),
      isExecutionEligible: jest.fn().mockResolvedValue(true),
    },
  };
}

describe("runExecutionResolverRuntimeGate", () => {
  it("dispatches through resolver gate and returns executor result", async () => {
    const executor = buildExecutor();
    const dependencies = buildDependencies(executor);

    const result = await runExecutionResolverRuntimeGate(
      { request: buildRequest() },
      dependencies,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(false);
      expect(result.result.summary).toBe("post fetched");
    }
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it("supports dry-run without provider side effects", async () => {
    const executor = buildExecutor();
    const dependencies = buildDependencies(executor);

    const result = await runExecutionResolverRuntimeGate(
      { request: buildRequest(), dryRun: true },
      dependencies,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
    }
    expect(executor.dryRun).toHaveBeenCalledTimes(1);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("blocks unregistered connector/action combinations", async () => {
    const executor = buildExecutor();
    const dependencies = buildDependencies(executor);

    const result = await runExecutionResolverRuntimeGate(
      {
        request: buildRequest({ actionKey: "wordpressDeletePost" }),
      },
      dependencies,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe("unsupported_action");
      expect(result.retryable).toBe(false);
    }
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
