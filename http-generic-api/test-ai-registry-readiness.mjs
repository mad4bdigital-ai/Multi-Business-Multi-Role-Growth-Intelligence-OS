import assert from "node:assert/strict";
import express from "express";
import { buildGovernanceRoutes } from "./routes/governanceRoutes.js";
import { buildAiResolverRegistryReadiness } from "./routeWorkflowGovernance.js";

const requiredIntentKeys = [
  "ai_implementation_plan_generation",
  "ai_task_manifest_generation"
];

{
  const readiness = buildAiResolverRegistryReadiness({
    requiredIntentKeys,
    taskRoutes: [
      {
        task_key: "route_ai_plan",
        route_id: "route_ai_plan",
        intent_key: "ai_implementation_plan_generation",
        workflow_key: "wf_ai_plan",
        executable_authority: true
      },
      {
        task_key: "route_ai_tasks",
        route_id: "route_ai_tasks",
        intent_key: "ai_task_manifest_generation",
        workflow_key: "wf_ai_tasks",
        executable_authority: true
      }
    ],
    workflows: [
      {
        workflow_id: "wf_ai_plan",
        workflow_key: "wf_ai_plan",
        route_key: "route_ai_plan",
        executable_authority: true
      },
      {
        workflow_id: "wf_ai_tasks",
        workflow_key: "wf_ai_tasks",
        route_key: "route_ai_tasks",
        executable_authority: true
      }
    ]
  });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.task_routes_ready, true);
  assert.equal(readiness.workflow_registry_ready, true);
  assert.equal(readiness.bindings.length, 2);
  assert.equal(readiness.bindings[0].workflow_id, "wf_ai_plan");
}

{
  const readiness = buildAiResolverRegistryReadiness({
    requiredIntentKeys,
    taskRoutes: [
      {
        task_key: "route_ai_plan",
        route_id: "route_ai_plan",
        intent_key: "ai_implementation_plan_generation",
        workflow_key: "wf_ai_plan",
        executable_authority: true
      }
    ],
    workflows: [
      {
        workflow_id: "wf_ai_plan",
        workflow_key: "wf_ai_plan",
        route_key: "route_ai_plan",
        executable_authority: true
      }
    ]
  });

  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.missing_intent_keys, ["ai_task_manifest_generation"]);
  assert.equal(readiness.task_routes_ready, false);
}

{
  const readiness = buildAiResolverRegistryReadiness({
    requiredIntentKeys: ["ai_task_manifest_generation"],
    taskRoutes: [
      {
        task_key: "route_ai_tasks",
        route_id: "route_ai_tasks",
        intent_key: "ai_task_manifest_generation",
        workflow_key: "wf_ai_tasks",
        executable_authority: true
      }
    ],
    workflows: [
      {
        workflow_id: "wf_ai_tasks",
        workflow_key: "wf_ai_tasks",
        route_key: "route_ai_tasks",
        executable_authority: false
      }
    ]
  });

  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.unresolved_workflow_authority, ["ai_task_manifest_generation"]);
  assert.equal(readiness.workflow_registry_ready, false);
}

{
  const app = express();
  app.use(express.json());
  app.use(buildGovernanceRoutes({
    requireBackendApiKey: (_req, _res, next) => next(),
    requireEnv: () => "registry_sheet_id",
    async ensureAiResolverRouteWorkflowRows() {
      return buildAiResolverRegistryReadiness({
        requiredIntentKeys,
        taskRoutes: [
          {
            task_key: "route_ai_plan",
            route_id: "route_ai_plan",
            intent_key: "ai_implementation_plan_generation",
            workflow_key: "wf_ai_plan",
            executable_authority: true
          },
          {
            task_key: "route_ai_tasks",
            route_id: "route_ai_tasks",
            intent_key: "ai_task_manifest_generation",
            workflow_key: "wf_ai_tasks",
            executable_authority: true
          }
        ],
        workflows: [
          {
            workflow_id: "wf_ai_plan",
            workflow_key: "wf_ai_plan",
            executable_authority: true
          },
          {
            workflow_id: "wf_ai_tasks",
            workflow_key: "wf_ai_tasks",
            executable_authority: true
          }
        ]
      });
    }
  }));

  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/ai/registry-readiness`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.readiness.ok, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

console.log("AI registry readiness tests passed");
