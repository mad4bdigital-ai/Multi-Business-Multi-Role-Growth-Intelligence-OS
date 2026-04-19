export function classifyGovernedMutationIntent(args = {}) {
  const {
    mutationType = "append",
    duplicateCandidates = [],
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  if (mutationType === "append") {
    if (duplicateCandidates.length) return "blocked_duplicate";
    return "append_new";
  }

  if (mutationType === "update") {
    if (renameOnly) return "rename_existing";
    if (mergeCandidate) return "merge_existing";
    if (targetRowNumber) return "update_existing";
    return "blocked_policy_unconfirmed";
  }

  if (mutationType === "delete") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  if (mutationType === "repair") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  return "blocked_policy_unconfirmed";
}

export function resolveGovernedTargetRowNumber(args = {}) {
  const {
    targetRowNumber = null,
    duplicateCandidates = []
  } = args;

  if (Number.isInteger(targetRowNumber) && targetRowNumber >= 2) {
    return targetRowNumber;
  }

  if (duplicateCandidates.length === 1) {
    return duplicateCandidates[0].rowNumber;
  }

  return null;
}

export function summarizeDuplicateCandidates(duplicateCandidates = []) {
  return duplicateCandidates.slice(0, 5).map(item => ({
    rowNumber: item.rowNumber,
    score: item.score
  }));
}

export function isExecutionLogUnifiedAppendExempt(args = {}, deps = {}) {
  const executionLogUnifiedSheetName = String(
    deps.executionLogUnifiedSheetName || ""
  ).trim();

  return (
    String(args.sheetName || "").trim() === executionLogUnifiedSheetName &&
    String(args.mutationType || "append").trim() === "append"
  );
}

export function buildGovernedMutationExemptionContext(args = {}, deps = {}) {
  if (isExecutionLogUnifiedAppendExempt(args, deps)) {
    return {
      sink_exemption_applied: true,
      sink_exemption_class: "execution_log_unified_append",
      duplicate_check_bypassed: true,
      append_duplicate_block_bypassed: true
    };
  }

  return {
    sink_exemption_applied: false,
    sink_exemption_class: "",
    duplicate_check_bypassed: false,
    append_duplicate_block_bypassed: false
  };
}

export async function enforceGovernedMutationPreflight(args = {}, deps = {}) {
  const {
    spreadsheetId,
    sheetName,
    rowObject = {},
    mutationType = "append",
    scanRangeA1 = "A:Z",
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  const {
    loadLiveGovernedChangeControlPolicies,
    governedPolicyEnabled,
    readRelevantExistingRowWindow,
    findSemanticDuplicateRows,
    highRiskGovernedSheets
  } = deps;

  if (typeof loadLiveGovernedChangeControlPolicies !== "function") {
    throw new Error("enforceGovernedMutationPreflight requires deps.loadLiveGovernedChangeControlPolicies");
  }
  if (typeof governedPolicyEnabled !== "function") {
    throw new Error("enforceGovernedMutationPreflight requires deps.governedPolicyEnabled");
  }
  if (typeof readRelevantExistingRowWindow !== "function") {
    throw new Error("enforceGovernedMutationPreflight requires deps.readRelevantExistingRowWindow");
  }
  if (typeof findSemanticDuplicateRows !== "function") {
    throw new Error("enforceGovernedMutationPreflight requires deps.findSemanticDuplicateRows");
  }

  const policies = await loadLiveGovernedChangeControlPolicies();

  if (
    governedPolicyEnabled(
      policies,
      "Live Policy Read Required Before Any Mutation",
      true
    ) !== true
  ) {
    const err = new Error("Live governed change-control policy confirmation failed.");
    err.code = "governed_policy_confirmation_failed";
    err.status = 500;
    throw err;
  }

  const appliesToAllSheets = governedPolicyEnabled(
    policies,
    "Applies To All Authoritative System Sheets",
    true
  );

  if (!appliesToAllSheets) {
    return {
      ok: true,
      classification: "append_new",
      duplicateCandidates: [],
      consultedPolicyKeys: policies.map(p => p.policy_key),
      consultedExistingRows: [],
      enforcementBypassed: true,
      sinkExemptionApplied: false,
      sinkExemptionClass: ""
    };
  }

  const existingWindow = await readRelevantExistingRowWindow(
    spreadsheetId,
    sheetName,
    scanRangeA1
  );

  const exemptionContext = buildGovernedMutationExemptionContext(
    { sheetName, mutationType },
    deps
  );

  const duplicateCandidates = governedPolicyEnabled(
    policies,
    "Semantic Duplicate Check Required Before Append",
    true
  )
    && !exemptionContext.duplicate_check_bypassed
    ? findSemanticDuplicateRows(existingWindow.header, existingWindow.rows, rowObject)
    : [];

  const isHighRiskSheet =
    highRiskGovernedSheets instanceof Set &&
    highRiskGovernedSheets.has(String(sheetName || "").trim());

  const resolvedTargetRowNumber = resolveGovernedTargetRowNumber({
    targetRowNumber,
    duplicateCandidates
  });

  const classification = classifyGovernedMutationIntent({
    mutationType,
    duplicateCandidates,
    targetRowNumber: resolvedTargetRowNumber,
    renameOnly,
    mergeCandidate
  });

  if (
    mutationType === "append" &&
    duplicateCandidates.length &&
    !exemptionContext.append_duplicate_block_bypassed &&
    governedPolicyEnabled(
      policies,
      "Append Forbidden When Update Or Rename Suffices",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} append blocked because semantically equivalent live rows already exist.`
    );
    err.code = "governed_duplicate_append_blocked";
    err.status = 409;
    err.mutation_classification = "blocked_duplicate";
    err.duplicate_candidates = summarizeDuplicateCandidates(duplicateCandidates);
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  if (
    mutationType !== "append" &&
    !resolvedTargetRowNumber &&
    governedPolicyEnabled(
      policies,
      "Pre-Mutation Change Classification Required",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} ${mutationType} blocked because no governed target row could be resolved.`
    );
    err.code = "governed_target_row_unresolved";
    err.status = 409;
    err.mutation_classification = "blocked_policy_unconfirmed";
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  return {
    ok: true,
    classification,
    mutationType,
    targetRowNumber: resolvedTargetRowNumber,
    duplicateCandidates: summarizeDuplicateCandidates(duplicateCandidates),
    consultedPolicyKeys: policies.map(p => p.policy_key),
    consultedExistingRows: summarizeDuplicateCandidates(duplicateCandidates).map(item => item.rowNumber),
    highRiskSheet: isHighRiskSheet,
    sinkExemptionApplied: exemptionContext.sink_exemption_applied,
    sinkExemptionClass: exemptionContext.sink_exemption_class
  };
}
