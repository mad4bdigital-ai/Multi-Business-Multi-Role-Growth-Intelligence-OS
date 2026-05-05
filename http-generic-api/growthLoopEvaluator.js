import { policyValue } from "./registryPolicyAccess.js";

export async function evaluateGrowthLoopTriggers({ parent_action_key, endpoint_key, status, score_after, policies } = {}) {
  const enabled = policyValue(policies, "Growth Loop Governance", "Growth Loop Trigger Enabled", "FALSE");
  if (enabled !== "TRUE") return { triggered: false, trigger_keys: [] };

  const successOnly = policyValue(policies, "Growth Loop Governance", "Trigger On Success Only", "TRUE");
  if (successOnly === "TRUE" && status !== "success") return { triggered: false, trigger_keys: [] };

  const thresholdRaw = policyValue(policies, "Growth Loop Governance", "Score Threshold For Trigger", "70");
  const threshold = Number(thresholdRaw);
  if ((score_after ?? 0) < threshold) return { triggered: false, trigger_keys: [] };

  const triggerKeysRaw = policyValue(policies, "Growth Loop Governance", "Trigger Action Keys", "");
  const allKeys = triggerKeysRaw
    .split(/[|,]/)
    .map(k => k.trim())
    .filter(Boolean);

  const trigger_keys = allKeys.filter(k => k === String(parent_action_key || "").trim());
  const matched = trigger_keys.length > 0 ? trigger_keys : allKeys;

  if (matched.length > 0) {
    console.log(`[growthLoop] Triggers fired: ${matched.join(", ")}`);
  }

  return { triggered: matched.length > 0, trigger_keys: matched };
}
