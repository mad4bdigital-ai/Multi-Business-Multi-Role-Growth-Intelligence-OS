export function validateRegistryAlignment(alignmentAudit = {}) {
  const mismatches = [];

  const workflows = alignmentAudit["Workflow Registry!A1:AZ20"] || [];
  const chains = alignmentAudit["Execution Chains Registry!A1:J20"] || [];
  const nodes = alignmentAudit["Knowledge Graph Node Registry!A1:J20"] || [];
  const relations = alignmentAudit["Relationship Graph Registry!A1:J20"] || [];

  const workflowKeys = new Set();
  const nodeIds = new Set();

  for (let i = 1; i < workflows.length; i++) {
    const row = workflows[i] || [];
    const workflowKey = String(row[24] || "").trim();
    if (workflowKey) workflowKeys.add(workflowKey);
  }

  for (let i = 1; i < nodes.length; i++) {
    const row = nodes[i] || [];
    const nodeId = String(row[0] || "").trim();
    if (nodeId) nodeIds.add(nodeId);
  }

  for (let i = 1; i < chains.length; i++) {
    const row = chains[i] || [];
    const chainId = String(row[0] || "").trim();
    const workflowId = String(row[5] || "").trim();
    if (workflowId && !workflowKeys.has(workflowId)) {
      mismatches.push({
        type: "missing_workflow_reference",
        source: "Execution Chains Registry",
        row_key: chainId,
        value: workflowId
      });
    }
  }

  for (let i = 1; i < relations.length; i++) {
    const row = relations[i] || [];
    const relationshipId = String(row[0] || "").trim();
    const fromNodeId = String(row[1] || "").trim();
    const toNodeId = String(row[3] || "").trim();

    if (fromNodeId && !nodeIds.has(fromNodeId)) {
      mismatches.push({
        type: "missing_from_node",
        source: "Relationship Graph Registry",
        row_key: relationshipId,
        value: fromNodeId
      });
    }

    if (toNodeId.startsWith("workflow.")) {
      const workflowSuffix = toNodeId.slice("workflow.".length);
      if (!workflowKeys.has(workflowSuffix)) {
        mismatches.push({
          type: "unresolved_workflow_node_target",
          source: "Relationship Graph Registry",
          row_key: relationshipId,
          value: toNodeId
        });
      }
    } else if (
      toNodeId &&
      !toNodeId.startsWith("route.") &&
      !toNodeId.startsWith("goal.") &&
      !nodeIds.has(toNodeId)
    ) {
      mismatches.push({
        type: "missing_to_node",
        source: "Relationship Graph Registry",
        row_key: relationshipId,
        value: toNodeId
      });
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatch_count: mismatches.length,
    mismatches
  };
}
