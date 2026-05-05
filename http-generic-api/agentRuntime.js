// agentRuntime.js — composed agent execution dependencies (singleton)
//
// Wires together buildCallModel → runLogicWithModel → buildEngineExecutorRegistry
// into a single deps object that agentLoopRunner.runAgentLoop() accepts.
//
// Usage:
//   import { getAgentDeps } from "./agentRuntime.js";
//   const result = await runAgentLoop(plan, { ...getAgentDeps(), workflowDef });

import { buildCallModel } from "./modelAdapterRouter.js";
import { runLogicWithModel } from "./modelAdapter.js";
import { buildEngineExecutorRegistry } from "./engineExecutorRegistry.js";

function buildAgentDeps(config = {}) {
  const callModel = buildCallModel({
    provider: config.provider,
    model:    config.model,
    api_key:  config.api_key,
  });

  function boundRunLogic(input, extraDeps = {}) {
    return runLogicWithModel(input, { callModel, ...extraDeps });
  }

  const engineExecutorRegistry = buildEngineExecutorRegistry({
    callModel,
    runLogicWithModel: boundRunLogic,
    // MCP and HTTP action dispatchers are optional; when absent, registry returns
    // a graceful error rather than throwing. Callers can extend via registry.register().
    dispatchMcpTool: config.dispatchMcpTool || null,
    callHttpAction:  config.callHttpAction  || null,
  });

  return {
    callModel,
    runLogicWithModel: boundRunLogic,
    engineExecutorRegistry,
  };
}

let _singleton = null;

export function getAgentDeps() {
  if (_singleton) return _singleton;

  // Provider resolution order: AGENT_MODEL_PROVIDER → "anthropic"
  // API key resolution: whichever key matches the chosen provider.
  const provider = process.env.AGENT_MODEL_PROVIDER || "anthropic";
  const apiKeyByProvider = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    gemini:    process.env.GOOGLE_AI_API_KEY,
  };

  _singleton = buildAgentDeps({
    provider,
    model:   process.env.AGENT_MODEL,
    api_key: apiKeyByProvider[provider],
  });

  return _singleton;
}

// Allow tests / app bootstrap to override the singleton before first use.
export function setAgentDeps(deps) {
  _singleton = deps;
}
