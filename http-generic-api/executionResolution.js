export async function resolveExecutionRequest(reqBody = {}, deps = {}) {
  const {
    requireEnv,
    createExecutionTraceId,
    debugLog,
    promoteDelegatedExecutionPayload,
    normalizeExecutionPayload,
    validateAssetHomePayloadRules,
    normalizeAssetType,
    classifyAssetHome,
    assertHostingerTargetTier,
    validatePayloadIntegrity,
    normalizeTopLevelRoutingFields,
    isDelegatedHttpExecuteWrapper,
    validateTopLevelRoutingFields,
    getRegistry,
    reloadRegistry,
    getRequiredHttpExecutionPolicyKeys,
    requirePolicySet,
    policyValue,
    resolveHttpExecutionContext,
    boolFromSheet,
    resolveAction,
    resolveEndpoint,
    getEndpointExecutionSnapshot,
    resolveBrand,
    requireRuntimeCallableAction,
    requireEndpointExecutionEligibility,
    requireExecutionModeCompatibility,
    requireNativeFamilyBoundary,
    requireTransportIfDelegated,
    requireNoFallbackDirectExecution,
    isDelegatedTransportTarget,
    ensureMethodAndPathMatchEndpoint,
    sanitizeCallerHeaders
  } = deps;

  requireEnv("REGISTRY_SPREADSHEET_ID");

  let execution_trace_id =
    String(reqBody?.execution_trace_id || "").trim() || createExecutionTraceId();

  const originalPayload = reqBody || {};
  const originalPayloadPromoted =
    promoteDelegatedExecutionPayload(originalPayload);

  const normalized = normalizeExecutionPayload(originalPayloadPromoted);
  const normalizedPromoted =
    promoteDelegatedExecutionPayload(normalized);
  const normalizedAssetHomeValidation = validateAssetHomePayloadRules(
    normalizedPromoted,
    { normalizeAssetType, classifyAssetHome }
  );
  if (!normalizedAssetHomeValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "normalized_asset_home_validation_failed",
            message: "Normalized asset home validation failed.",
            details: normalizedAssetHomeValidation.errors
          }
        }
      },
      execution_trace_id
    };
  }
  assertHostingerTargetTier(normalizedPromoted);

  const payloadIntegrity = validatePayloadIntegrity(
    normalizeTopLevelRoutingFields(originalPayloadPromoted),
    normalizeTopLevelRoutingFields(normalizedPromoted)
  );
  if (!payloadIntegrity.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "payload_integrity_violation",
            message: "Normalized payload does not preserve required top-level routing fields.",
            details: {
              mismatches: payloadIntegrity.mismatches
            }
          },
          execution_guardrail: true
        }
      },
      execution_trace_id
    };
  }

  const requestPayload = normalizedPromoted;
  execution_trace_id =
    String(requestPayload.execution_trace_id || execution_trace_id || "").trim() ||
    createExecutionTraceId();
  requestPayload.execution_trace_id = execution_trace_id;

  debugLog("IS_DELEGATED_HTTP_EXECUTE_WRAPPER:", isDelegatedHttpExecuteWrapper(requestPayload));
  debugLog("PROMOTED_ROUTING_FIELDS:", JSON.stringify({
    target_key: requestPayload.target_key || "",
    brand: requestPayload.brand || "",
    brand_domain: requestPayload.brand_domain || ""
  }));
  debugLog("PROMOTED_EXECUTION_TARGET:", JSON.stringify({
    provider_domain: requestPayload.provider_domain || "",
    parent_action_key: requestPayload.parent_action_key || "",
    endpoint_key: requestPayload.endpoint_key || "",
    method: requestPayload.method || "",
    path: requestPayload.path || ""
  }));

  const provider_domain = requestPayload.provider_domain;
  const parent_action_key = requestPayload.parent_action_key;
  const endpoint_key = requestPayload.endpoint_key;

  if (!parent_action_key || !endpoint_key) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "invalid_request",
            message: "parent_action_key and endpoint_key are required."
          }
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const forceRefresh = requestPayload.force_refresh === true || String(requestPayload.force_refresh || "").toLowerCase() === "true";
  if (forceRefresh) {
    debugLog("REGISTRY_FORCE_REFRESH:", true);
  }
  const registry = forceRefresh ? await reloadRegistry() : await getRegistry();
  const { drive, brandRows, hostingAccounts, actionRows, endpointRows, policies } = registry;

  const requiredHttpExecutionPolicyKeys =
    getRequiredHttpExecutionPolicyKeys(policies);

  const requiredHttpExecutionPolicyCheck =
    requirePolicySet(
      policies,
      "HTTP Execution Governance",
      requiredHttpExecutionPolicyKeys
    );

  if (!requiredHttpExecutionPolicyCheck.ok) {
    return {
      ok: false,
      response: {
        status: 403,
        body: {
          ok: false,
          error: {
            code: "missing_required_http_execution_policy",
            message: "Required HTTP Execution Governance policies are not fully enabled.",
            details: {
              policy_group: "HTTP Execution Governance",
              missing_keys: requiredHttpExecutionPolicyCheck.missing,
              handling: String(
                policyValue(
                  policies,
                  "HTTP Execution Governance",
                  "Missing Required Policy Handling",
                  "BLOCK"
                )
              ).trim()
            }
          },
          execution_guardrail: true,
          repair_action: "restore_required_http_execution_governance_rows",
          execution_trace_id
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const topLevelRoutingValidation = validateTopLevelRoutingFields(
    requestPayload,
    policies,
    { policyValue }
  );
  if (!topLevelRoutingValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "top_level_routing_schema_violation",
            message: "Top-level routing fields failed validation.",
            details: {
              errors: topLevelRoutingValidation.errors
            }
          },
          execution_guardrail: true
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  const assetHomeValidation = validateAssetHomePayloadRules(
    requestPayload,
    { normalizeAssetType, classifyAssetHome }
  );

  if (!assetHomeValidation.ok) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          ok: false,
          error: {
            code: "asset_home_validation_failed",
            message: "Asset home validation failed.",
            details: assetHomeValidation.errors
          }
        }
      },
      requestPayload,
      execution_trace_id
    };
  }

  // Normalize getSheetValues range before deriving local vars:
  // - Accept range from query.range OR path_params.range (prefer query)
  // - Decode any existing percent-encoding so applyPathParams encodes exactly once
  //   (prevents %20 becoming %2520 when a caller pre-encodes the range)
  // - Inject the normalized value into path_params; strip it from query
  if (
    String(parent_action_key || "").trim() === "google_sheets_api" &&
    String(endpoint_key || "").trim() === "getSheetValues"
  ) {
    const rqQuery = requestPayload.query && typeof requestPayload.query === "object"
      ? requestPayload.query
      : {};
    const rqPath = requestPayload.path_params || {};
    const queryRange = String(rqQuery.range || "").trim();
    const pathRange = String(rqPath.range || "").trim();
    const rawRange = queryRange || pathRange;

    if (!rawRange) {
      return {
        ok: false,
        response: {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "missing_required_range_param",
              message: "getSheetValues requires range — supply via query.range or path_params.range.",
              details: {
                parent_action_key,
                endpoint_key,
                path_params_received: Object.keys(rqPath),
                query_keys_received: Object.keys(rqQuery)
              }
            }
          }
        },
        requestPayload,
        execution_trace_id
      };
    }

    let normalizedRange = rawRange;
    try {
      normalizedRange = rawRange.includes("%") ? decodeURIComponent(rawRange) : rawRange;
    } catch {
      normalizedRange = rawRange;
    }

    const normalizedQuery = Object.fromEntries(
      Object.entries(rqQuery).filter(([k]) => k !== "range")
    );
    requestPayload.path_params = { ...rqPath, range: normalizedRange };
    requestPayload.query = normalizedQuery;

    debugLog("SHEETS_RANGE_SNAPSHOT:", JSON.stringify({
      requested_spreadsheetId: String(rqPath.spreadsheetId || "").trim(),
      requested_range: normalizedRange,
      range_source: queryRange ? "query" : "path_params",
      force_refresh: !!requestPayload.force_refresh,
      readback_mode: requestPayload.readback?.mode || ""
    }));
  }

  const callerHeaders = sanitizeCallerHeaders(requestPayload.headers || {});
  const query = requestPayload.query && typeof requestPayload.query === "object"
    ? { ...requestPayload.query }
    : {};
  const body = requestPayload.body;
  const pathParams = requestPayload.path_params || {};

  debugLog("NORMALIZED_TOP_LEVEL_ROUTING_FIELDS:", JSON.stringify({
    provider_domain: requestPayload.provider_domain || "",
    parent_action_key: requestPayload.parent_action_key || "",
    endpoint_key: requestPayload.endpoint_key || "",
    method: requestPayload.method || "",
    path: requestPayload.path || "",
    target_key: requestPayload.target_key || "",
    brand: requestPayload.brand || "",
    brand_domain: requestPayload.brand_domain || ""
  }));

  const executionContext = resolveHttpExecutionContext(
    {
      requestPayload,
      parent_action_key,
      endpoint_key,
      actionRows,
      endpointRows,
      brandRows,
      policies,
      allowedTransport: process.env.HTTP_ALLOWED_TRANSPORT
    },
    {
      debugLog,
      boolFromSheet,
      policyValue,
      resolveAction,
      resolveEndpoint,
      getEndpointExecutionSnapshot,
      resolveBrand,
      requireRuntimeCallableAction,
      requireEndpointExecutionEligibility,
      requireExecutionModeCompatibility,
      requireNativeFamilyBoundary,
      requireTransportIfDelegated,
      requireNoFallbackDirectExecution,
      isDelegatedTransportTarget,
      ensureMethodAndPathMatchEndpoint
    }
  );

  // Post-resolution drift guard for getSheetValues
  if (
    String(parent_action_key || "").trim() === "google_sheets_api" &&
    String(endpoint_key || "").trim() === "getSheetValues"
  ) {
    const requestedRange = String(pathParams.range || "").trim();
    const resolvedPath = String(executionContext.resolvedMethodPath?.path || "");
    const encodedRange = encodeURIComponent(requestedRange);

    debugLog("SHEETS_REQUEST_TRACE:", JSON.stringify({
      parent_action_key,
      endpoint_key,
      requested_spreadsheetId: String(pathParams.spreadsheetId || "").trim(),
      requested_range: requestedRange,
      resolved_path: resolvedPath,
      encoded_range_in_path: resolvedPath.includes(encodedRange),
      range_source: "normalized_path_params",
      force_refresh: !!requestPayload.force_refresh,
      readback_mode: requestPayload.readback?.mode || ""
    }));

    if (requestedRange && !resolvedPath.includes(encodedRange)) {
      return {
        ok: false,
        response: {
          status: 400,
          body: {
            ok: false,
            error: {
              code: "sheets_range_resolution_mismatch",
              message: `Sheets range drifted before execution. Requested range not found in resolved path.`,
              details: {
                requested_range: requestedRange,
                resolved_path: resolvedPath,
                requested_spreadsheetId: String(pathParams.spreadsheetId || "").trim(),
                endpoint_key,
                parent_action_key
              }
            }
          }
        },
        requestPayload,
        execution_trace_id
      };
    }
  }

  return {
    ok: true,
    requestPayload,
    execution_trace_id,
    provider_domain,
    parent_action_key,
    endpoint_key,
    drive,
    hostingAccounts,
    policies,
    callerHeaders,
    query,
    body,
    pathParams,
    ...executionContext
  };
}
