import {
  normalizeExecutionIntent,
  normalizeMutationIntent,
  normalizeRouteWorkflowState
} from "../normalization.js";

function firstPopulated(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

export function resolveAiIntentMaturation(input = {}, resolverType = "implementation_plan") {
  const request = input && typeof input === "object" ? input : {};
  const previous = request.intent_maturation && typeof request.intent_maturation === "object"
    ? request.intent_maturation
    : {};
  const previousExecutionIntent = previous.execution_intent || {};
  const previousRouteWorkflow = previous.route_workflow_state || {};
  const previousMutationIntent = previous.mutation_intent || {};

  const intentKey = firstPopulated(
    request.intent_key,
    request.routing_context?.intent_key,
    previous.intent_key,
    resolverType === "task_manifest"
      ? "ai_task_manifest_generation"
      : "ai_implementation_plan_generation"
  );

  const executionIntent = normalizeExecutionIntent({
    ...request,
    intent_family: firstPopulated(request.intent_family, previousExecutionIntent.intent_family, "ai_generation"),
    execution_class: firstPopulated(request.execution_class, previousExecutionIntent.execution_class, "ai_resolver"),
    route_selection_mode: firstPopulated(request.route_selection_mode, previousExecutionIntent.route_selection_mode, "first_class_intent"),
    workflow_selection_mode: firstPopulated(request.workflow_selection_mode, previousExecutionIntent.workflow_selection_mode, "registry_authority"),
    addition_intake_required: boolValue(request.addition_intake_required ?? previousExecutionIntent.addition_intake_required, false),
    patch_parity_verification_required: boolValue(request.patch_parity_verification_required ?? previousExecutionIntent.patch_parity_verification_required, false),
    brand_onboarding_required: boolValue(request.brand_onboarding_required ?? previousExecutionIntent.brand_onboarding_required, false),
    transport_mode_requested: firstPopulated(request.transport_mode_requested, previousExecutionIntent.transport_mode_requested, "same_service_native")
  });

  const routeWorkflow = normalizeRouteWorkflowState({
    route_id: firstPopulated(request.route_id, request.routing_context?.route_id, previousRouteWorkflow.route_id),
    workflow_id: firstPopulated(request.workflow_id, request.routing_context?.workflow_id, previousRouteWorkflow.workflow_id),
    route_status: firstPopulated(request.route_status, previousRouteWorkflow.route_status, "intent_resolved"),
    workflow_status: firstPopulated(request.workflow_status, previousRouteWorkflow.workflow_status, "planned"),
    selection_basis: firstPopulated(request.selection_basis, previousRouteWorkflow.selection_basis, "intent_key"),
    validation_required: boolValue(request.validation_required ?? previousRouteWorkflow.validation_required, true)
  });

  const mutationIntent = normalizeMutationIntent({
    mutation_class: firstPopulated(request.mutation_class, request.mutation_intent, previousMutationIntent.mutation_class, "none"),
    target_surface_family: firstPopulated(request.target_surface_family, previousMutationIntent.target_surface_family, "intent_maturation"),
    authority_mode: firstPopulated(request.authority_mode, previousMutationIntent.authority_mode, "registry_governed"),
    candidate_only: boolValue(request.candidate_only ?? previousMutationIntent.candidate_only, true),
    duplicate_check_required: boolValue(request.duplicate_check_required ?? previousMutationIntent.duplicate_check_required, false),
    evidence_required: boolValue(request.evidence_required ?? previousMutationIntent.evidence_required, true)
  });

  return {
    intent_key: intentKey,
    resolver_type: resolverType,
    maturation_status: intentKey ? "matured" : "blocked",
    upstream_resolver_type: previous.resolver_type || "",
    upstream_intent_key: previous.intent_key || "",
    execution_intent: executionIntent,
    route_workflow_state: routeWorkflow,
    mutation_intent: mutationIntent,
    blocked_reason: intentKey ? "" : "missing_intent_key"
  };
}

export function formatIntentMaturationForPrompt(intentMaturation = {}) {
  return [
    "First-class intent maturation context:",
    `- intent_key: ${intentMaturation.intent_key || ""}`,
    `- resolver_type: ${intentMaturation.resolver_type || ""}`,
    `- upstream_resolver_type: ${intentMaturation.upstream_resolver_type || ""}`,
    `- upstream_intent_key: ${intentMaturation.upstream_intent_key || ""}`,
    `- maturation_status: ${intentMaturation.maturation_status || ""}`,
    `- execution_class: ${intentMaturation.execution_intent?.execution_class || ""}`,
    `- route_selection_mode: ${intentMaturation.execution_intent?.route_selection_mode || ""}`,
    `- workflow_selection_mode: ${intentMaturation.execution_intent?.workflow_selection_mode || ""}`,
    `- route_id: ${intentMaturation.route_workflow_state?.route_id || ""}`,
    `- workflow_id: ${intentMaturation.route_workflow_state?.workflow_id || ""}`,
    `- mutation_class: ${intentMaturation.mutation_intent?.mutation_class || ""}`,
    `- authority_mode: ${intentMaturation.mutation_intent?.authority_mode || ""}`
  ].join("\n");
}
