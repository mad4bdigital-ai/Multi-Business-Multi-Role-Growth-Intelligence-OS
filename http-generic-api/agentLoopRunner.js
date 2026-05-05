import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

async function loadWorkflow(workflow_key) {
  const [rows] = await getPool().query(
    "SELECT * FROM `workflows` WHERE workflow_key = ? AND (active = 1 OR active = '1' OR active = 'TRUE') LIMIT 1",
    [workflow_key]
  );
  return rows[0] || null;
}

async function loadLogicDefinition(logic_key) {
  if (!logic_key) return null;
  const [rows] = await getPool().query(
    "SELECT * FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
    [logic_key]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  try { row.body_json = row.body_json ? JSON.parse(row.body_json) : {}; } catch { row.body_json = {}; }
  return row;
}

function buildToolsFromEngines(mappedEngines = "") {
  return mappedEngines
    .split("|")
    .map(e => e.trim())
    .filter(Boolean)
    .map(engineName => ({
      type: "function",
      function: {
        name: engineName,
        description: `Execute engine: ${engineName}`,
        parameters: { type: "object", properties: { input: { type: "string" } }, required: [] },
      },
    }));
}

async function writeRunResult(run_id, result, tenant_id) {
  try {
    await getPool().query(
      `UPDATE \`workflow_runs\`
         SET status = 'completed', output_json = ?, completed_at = NOW()
       WHERE run_id = ?`,
      [JSON.stringify(result), run_id]
    );
  } catch { /* non-blocking — run record may have been created by connectorExecutor */ }

  for (const tc of result.tool_calls_made || []) {
    try {
      await getPool().query(
        `INSERT INTO \`step_runs\`
           (step_run_id, run_id, tenant_id, step_key, step_type, status, input_json, output_json, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'engine', 'completed', ?, ?, NOW(), NOW())`,
        [randomUUID(), run_id, tenant_id || null, tc.tool_name,
         JSON.stringify(tc.args), JSON.stringify(tc.result)]
      );
    } catch { /* non-blocking */ }
  }
}

export async function runAgentLoop(plan, deps = {}) {
  const run_id = plan.run_id || randomUUID();

  const workflow = await loadWorkflow(plan.workflow_key);
  if (!workflow) {
    return { ok: false, error: "workflow_not_found", workflow_key: plan.workflow_key };
  }

  const logicDef = await loadLogicDefinition(workflow.target_module);
  const logicBody = logicDef?.body_json || {};
  const logic_key = logicDef?.logic_key || workflow.target_module || "unknown";

  const context = deps.buildGovernedContext
    ? await deps.buildGovernedContext(plan)
    : { plan_id: plan.plan_id, brand_key: plan.brand_key, workflow_key: plan.workflow_key };

  const pathRows = deps.loadPathResolverRows
    ? await deps.loadPathResolverRows(plan).catch(() => null)
    : null;

  if (pathRows) context.path_resolver_rows = pathRows;

  const tools = buildToolsFromEngines(workflow.mapped_engines || "");

  const engineRegistry = deps.engineExecutorRegistry;

  async function dispatchTool(toolName, args, ctx) {
    if (engineRegistry?.dispatch) return engineRegistry.dispatch(toolName, args, ctx);
    return { ok: false, error: "no_engine_registry" };
  }

  const modelResult = await deps.runLogicWithModel(
    { logic_key, logic_body: logicBody, user_input: plan.intent_key || "", context, tools },
    { callModel: deps.callModel, dispatchTool }
  );

  await writeRunResult(run_id, modelResult, plan.tenant_id);

  return {
    ok: modelResult.ok,
    run_id,
    output: modelResult.output,
    tool_calls_made: modelResult.tool_calls_made,
    iterations: modelResult.iteration_count,
    execution_trace_id: modelResult.execution_trace_id,
  };
}
