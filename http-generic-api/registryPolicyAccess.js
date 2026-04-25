function defaultBoolFromSheet(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function getBoolFromSheet(deps = {}) {
  return deps.boolFromSheet || defaultBoolFromSheet;
}

export function policyValue(policies, group, key, fallback = "", deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const row = (policies || []).find(
    policy =>
      policy.policy_group === group &&
      policy.policy_key === key &&
      boolFromSheet(policy.active)
  );
  return row ? row.policy_value : fallback;
}

export function policyList(policies, group, key, deps = {}) {
  return String(policyValue(policies, group, key, "", deps))
    .split("|")
    .map(value => value.trim())
    .filter(Boolean);
}
