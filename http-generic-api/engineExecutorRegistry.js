import { getPool } from "./db.js";

async function isLogicKey(engineName) {
  const [rows] = await getPool().query(
    "SELECT logic_key FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
    [engineName]
  );
  return rows.length > 0;
}

async function isActionKey(engineName) {
  const [rows] = await getPool().query(
    "SELECT action_key FROM `actions` WHERE action_key = ? LIMIT 1",
    [engineName]
  );
  return rows.length > 0;
}

function isHttpActionEngine(engineName) {
  return /_api/.test(engineName) || /_(endpoint|action|connector)$/.test(engineName);
}

function isMcpEngine(engineName) {
  return engineName.startsWith("make_") || engineName.startsWith("mcp_");
}

async function resolveDispatch(engineName, input, context, deps, customHandlers) {
  if (customHandlers[engineName]) {
    return customHandlers[engineName](input, context);
  }

  if (isMcpEngine(engineName)) {
    if (typeof deps.dispatchMcpTool !== "function") {
      return { ok: false, error: "mcp_not_configured", engine: engineName };
    }
    return deps.dispatchMcpTool(engineName, input);
  }

  if (isHttpActionEngine(engineName) || await isActionKey(engineName)) {
    if (typeof deps.callHttpAction !== "function") {
      return { ok: false, error: "http_action_not_configured", engine: engineName };
    }
    const { action_key, endpoint_key, body } = input;
    return deps.callHttpAction(action_key || engineName, endpoint_key || "", body || input);
  }

  if (await isLogicKey(engineName)) {
    return deps.runLogicWithModel({ logic_key: engineName, user_input: JSON.stringify(input), context });
  }

  return { ok: false, error: "engine_not_registered", engine: engineName };
}

export function buildEngineExecutorRegistry(deps = {}) {
  const customHandlers = {};

  function register(engineName, handlerFn) {
    customHandlers[engineName] = handlerFn;
  }

  async function dispatch(engineName, input, context) {
    return resolveDispatch(engineName, input, context, deps, customHandlers);
  }

  return { dispatch, register };
}
