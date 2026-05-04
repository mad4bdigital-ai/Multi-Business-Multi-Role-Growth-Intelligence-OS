import assert from "node:assert/strict";
import express from "express";
import { buildAiResolverRoutes } from "./routes/aiResolverRoutes.js";

const calls = [];
const app = express();
app.use(express.json());
app.use(buildAiResolverRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
  async generateImplementationPlan(input) {
    calls.push({ type: "plan", input });
    return {
      planMarkdown: "# Runtime Plan\n\n## Proposed Changes\n- [NEW] runtimePlan.js",
      usage: { total_tokens: 21 }
    };
  },
  async generateTaskManifest(input) {
    calls.push({ type: "task", input });
    return {
      taskMarkdown: "- [ ] Create runtimePlan.js",
      usage: { total_tokens: 13 }
    };
  }
}));

const server = app.listen(0);

try {
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const planResponse = await fetch(`${baseUrl}/ai/implementation-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: "Build a runtime plan",
      intent_key: "ai_implementation_plan_generation",
      route_id: "route_ai_runtime_plan",
      workflow_id: "wf_ai_runtime_plan"
    })
  });
  const planBody = await planResponse.json();

  assert.equal(planResponse.status, 200);
  assert.equal(planBody.ok, true);
  assert.equal(planBody.intent_maturation.intent_key, "ai_implementation_plan_generation");
  assert.equal(planBody.intent_maturation.route_workflow_state.route_id, "route_ai_runtime_plan");
  assert.match(calls[0].input.systemContext, /First-class intent maturation context/);

  const taskResponse = await fetch(`${baseUrl}/ai/task-manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      implementationPlan: planBody.planMarkdown,
      intent_key: "ai_task_manifest_generation",
      intent_maturation: planBody.intent_maturation
    })
  });
  const taskBody = await taskResponse.json();

  assert.equal(taskResponse.status, 200);
  assert.equal(taskBody.ok, true);
  assert.equal(taskBody.intent_maturation.intent_key, "ai_task_manifest_generation");
  assert.equal(taskBody.intent_maturation.upstream_intent_key, "ai_implementation_plan_generation");
  assert.equal(taskBody.intent_maturation.route_workflow_state.route_id, "route_ai_runtime_plan");
  assert.equal(taskBody.intent_maturation.route_workflow_state.workflow_id, "wf_ai_runtime_plan");
  assert.match(calls[1].input.systemContext, /route_ai_runtime_plan/);

  console.log("AI resolver HTTP route tests passed");
} finally {
  await new Promise(resolve => server.close(resolve));
}
