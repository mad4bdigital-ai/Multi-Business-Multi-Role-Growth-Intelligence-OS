import assert from "node:assert/strict";
import { generateImplementationPlan } from "./services/planningResolver.js";
import { generateTaskManifest } from "./services/taskResolver.js";
import { buildAiResolverRoutes } from "./routes/aiResolverRoutes.js";

function createMockFetch() {
  const calls = [];

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;

    if (prompt.includes("Build a simple notification system")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "# Implementation Plan\n\n## Goal Description\nBuild a basic notification queue.\n\n## Proposed Changes\n- [NEW] notificationQueue.js\n- [MODIFY] server.js"
            }
          }],
          usage: { total_tokens: 150 }
        })
      };
    }

    if (prompt.includes("Here is the Implementation Plan")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "- [ ] Create notificationQueue.js file\n- [ ] Implement queue logic\n- [ ] Inject into server.js execution facade\n- [ ] Test the integration"
            }
          }],
          usage: { total_tokens: 80 }
        })
      };
    }

    return { ok: false, status: 400, text: async () => "Unknown prompt" };
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

const fetchImpl = createMockFetch();

const planResult = await generateImplementationPlan({
  userPrompt: "Build a simple notification system",
  apiKey: "mock-key-123",
  fetchImpl
});

assert.match(planResult.planMarkdown, /Implementation Plan/);
assert.equal(planResult.usage.total_tokens, 150);

const taskResult = await generateTaskManifest({
  implementationPlan: planResult.planMarkdown,
  apiKey: "mock-key-123",
  fetchImpl
});

assert.match(taskResult.taskMarkdown, /Create notificationQueue/);
assert.equal(taskResult.usage.total_tokens, 80);

await assert.rejects(
  () => generateImplementationPlan({ userPrompt: "", apiKey: "mock-key-123", fetchImpl }),
  /userPrompt is required/
);

await assert.rejects(
  () => generateTaskManifest({ implementationPlan: "", apiKey: "mock-key-123", fetchImpl }),
  /implementationPlan is required/
);

const router = buildAiResolverRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
  generateImplementationPlan,
  generateTaskManifest
});

assert.ok(router.stack.some(layer => layer.route?.path === "/ai/implementation-plan"));
assert.ok(router.stack.some(layer => layer.route?.path === "/ai/task-manifest"));

console.log("AI resolver tests passed");
