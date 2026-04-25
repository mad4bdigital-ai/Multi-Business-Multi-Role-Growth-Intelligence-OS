import { Router } from "express";

export function buildExecuteRoutes(deps) {
  const {
    requireBackendApiKey,
    requireEnv,
    nowIso,
    createExecutionTraceId,
    debugLog,
    // payload normalization
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
    // registry
    getRegistry,
    reloadRegistry,
    // policy
    getRequiredHttpExecutionPolicyKeys,
    requirePolicySet,
    policyValue,
    policyList,
    // execution context resolution
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
    // dispatch
    dispatchEndpointKeyExecution,
    inferLocalDispatchHttpStatus,
    executeSameServiceNativeEndpoint,
    // provider / auth
    resolveProviderDomain,
    normalizeAuthContract,
    resolveAccountKey,
    isGoogleApiHost,
    enforceSupportedAuthMode,
    mintGoogleAccessTokenForEndpoint,
    ensureWritePermissions,
    // schema
    fetchSchemaContract,
    resolveSchemaOperation,
    injectAuthForSchemaValidation,
    getAdditionalStaticAuthHeaders,
    validateParameters,
    validateRequestBody,
    logValidationRunWriteback,
    // auth / headers
    injectAuthIntoHeaders,
    sanitizeCallerHeaders,
    jsonParseSafe,
    buildUrl,
    appendQuery,
    // resilience
    resilienceAppliesToParentAction,
    retryMutationEnabled,
    buildProviderRetryMutations,
    shouldRetryProviderResponse,
    // transport
    executeUpstreamAttempt,
    finalizeTransportBody,
    // response validation
    classifySchemaDrift,
    validateByJsonSchema,
    // writeback
    performUniversalServerWriteback,
    // constants
    MAX_TIMEOUT_SECONDS
  } = deps;

  const router = Router();

  router.post("/http-execute", requireBackendApiKey, async (req, res) => {
    let requestPayload = null;
    let action = null;
    let endpoint = null;
    let brand = null;
    let sameServiceNativeTarget = false;
    let resolvedMethodPath = null;
    const sync_execution_started_at = nowIso();
    let execution_trace_id =
      String(req.body?.execution_trace_id || "").trim() || createExecutionTraceId();

    try {
      requireEnv("REGISTRY_SPREADSHEET_ID");

      const originalPayload = req.body || {};
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
        return res.status(400).json({
          ok: false,
          error: {
            code: "normalized_asset_home_validation_failed",
            message: "Normalized asset home validation failed.",
            details: normalizedAssetHomeValidation.errors
          }
        });
      }
      assertHostingerTargetTier(normalizedPromoted);

      const payloadIntegrity = validatePayloadIntegrity(
        normalizeTopLevelRoutingFields(originalPayloadPromoted),
        normalizeTopLevelRoutingFields(normalizedPromoted)
      );
      if (!payloadIntegrity.ok) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "payload_integrity_violation",
            message: "Normalized payload does not preserve required top-level routing fields.",
            details: {
              mismatches: payloadIntegrity.mismatches
            }
          },
          execution_guardrail: true
        });
      }

      // FORCE canonical payload for all downstream logic
      requestPayload = normalizedPromoted;
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
        return res.status(400).json({
          ok: false,
          error: {
            code: "invalid_request",
            message: "parent_action_key and endpoint_key are required."
          }
        });
      }

      const forceRefresh = requestPayload.force_refresh === true || String(requestPayload.force_refresh || "").toLowerCase() === "true";
      if (forceRefresh) {
        debugLog("REGISTRY_FORCE_REFRESH:", true);
      }
      const { drive, brandRows, hostingAccounts, actionRows, endpointRows, policies } = forceRefresh
        ? await reloadRegistry()
        : await getRegistry();

      const requiredHttpExecutionPolicyKeys =
        getRequiredHttpExecutionPolicyKeys(policies);

      const requiredHttpExecutionPolicyCheck =
        requirePolicySet(
          policies,
          "HTTP Execution Governance",
          requiredHttpExecutionPolicyKeys
        );

      if (!requiredHttpExecutionPolicyCheck.ok) {
        return res.status(403).json({
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
        });
      }

      const topLevelRoutingValidation = validateTopLevelRoutingFields(
        requestPayload,
        policies,
        { policyValue }
      );
      if (!topLevelRoutingValidation.ok) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "top_level_routing_schema_violation",
            message: "Top-level routing fields failed validation.",
            details: {
              errors: topLevelRoutingValidation.errors
            }
          },
          execution_guardrail: true
        });
      }
      const assetHomeValidation = validateAssetHomePayloadRules(
        requestPayload,
        { normalizeAssetType, classifyAssetHome }
      );

      if (!assetHomeValidation.ok) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "asset_home_validation_failed",
            message: "Asset home validation failed.",
            details: assetHomeValidation.errors
          }
        });
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

      ({
        action,
        endpoint,
        brand,
        sameServiceNativeTarget,
        resolvedMethodPath
      } = resolveHttpExecutionContext(
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
      ));

      const dispatchedEndpointResult = await dispatchEndpointKeyExecution({
        endpoint_key,
        requestPayload
      });

      if (dispatchedEndpointResult) {
        const localDispatchStatusCode =
          inferLocalDispatchHttpStatus(dispatchedEndpointResult);

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key: parent_action_key,
          endpoint_key: endpoint_key,
          route_id: String(endpoint?.endpoint_id || "").trim(),
          target_module: String(endpoint?.module_binding || "").trim(),
          target_workflow: String(action?.action_key || "").trim(),
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: dispatchedEndpointResult.ok ? "succeeded" : "failed",
          responseBody: dispatchedEndpointResult,
          error_code: dispatchedEndpointResult?.error?.code || "",
          error_message_short: dispatchedEndpointResult?.error?.message || "",
          http_status: localDispatchStatusCode,
          brand_name: String(brand?.brand_name || requestPayload.brand || "").trim(),
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res
          .status(localDispatchStatusCode)
          .json(dispatchedEndpointResult);
      }

      if (sameServiceNativeTarget) {
        const nativeOutcome = await executeSameServiceNativeEndpoint({
          method: resolvedMethodPath.method,
          path: resolvedMethodPath.path,
          body: requestPayload.body,
          timeoutSeconds: requestPayload.timeout_seconds,
          expectJson: requestPayload.expect_json
        });

        return res.status(nativeOutcome.statusCode).json(nativeOutcome.payload);
      }

      debugLog("REQUEST_PAYLOAD_TARGET_KEY:", requestPayload.target_key || "");
      debugLog("REQUEST_PAYLOAD_BRAND:", requestPayload.brand || "");
      debugLog("REQUEST_PAYLOAD_BRAND_DOMAIN:", requestPayload.brand_domain || "");
      const {
        providerDomain: resolvedProviderDomain,
        resolvedProviderDomainMode,
        placeholderResolutionSource
      } = resolveProviderDomain({
        requestedProviderDomain: provider_domain,
        endpoint,
        brand,
        parentActionKey: parent_action_key,
        policies,
        requestBody: requestPayload
      });
      debugLog("RESOLVED_PROVIDER_DOMAIN:", resolvedProviderDomain);
      debugLog("RESOLVED_PROVIDER_DOMAIN_MODE:", resolvedProviderDomainMode);
      debugLog("PLACEHOLDER_RESOLUTION_SOURCE:", placeholderResolutionSource);

      const requestBody = requestPayload;
      const resolvedTargetKey = String(
        requestPayload.target_key || brand?.target_key || ""
      ).trim();

      const authContract = normalizeAuthContract({
        action,
        brand,
        hostingAccounts,
        targetKey: requestBody.target_key || resolvedTargetKey || ""
      });
      if (String(action.action_key || "").trim() === "hostinger_api") {
        debugLog("HOSTINGER_BRAND_TARGET_KEY:", brand?.target_key || "");
        debugLog(
          "HOSTINGER_EFFECTIVE_ACCOUNT_KEY:",
          resolveAccountKey({
            brand,
            targetKey: requestBody.target_key || resolvedTargetKey || "",
            hostingAccounts
          })
        );
        debugLog("HOSTINGER_REQUEST_TARGET_KEY:", requestBody.target_key || resolvedTargetKey || "");
      }
      debugLog("INFERRED_AUTH_MODE:", authContract.mode);
      enforceSupportedAuthMode(policies, authContract.mode);

      if (authContract.mode === "oauth_gpt_action") {
        const handling = policyValue(
          policies,
          "HTTP Execution Governance",
          "OAuth GPT Action Transport Handling",
          "NATIVE_ONLY"
        );

        const allowDelegatedGoogleOAuth = String(
          policyValue(
            policies,
            "HTTP Google Auth",
            "Allow Delegated Google OAuth",
            "TRUE"
          )
        ).trim().toUpperCase() === "TRUE";

        const delegatedGoogleEndpoint =
          isDelegatedTransportTarget(endpoint) &&
          isGoogleApiHost(resolvedProviderDomain);

        if (!allowDelegatedGoogleOAuth || !delegatedGoogleEndpoint) {
          const err = new Error(
            `Resolved auth mode ${authContract.mode} must use governed native connector path (${handling}).`
          );
          err.code = "native_connector_required";
          err.status = 403;
          throw err;
        }

        try {
          authContract.mode = "bearer_token";
          authContract.header_name = "Authorization";
          authContract.secret = await mintGoogleAccessTokenForEndpoint({
            drive,
            policies,
            action,
            endpoint
          });
        } catch (err) {
          debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
            action_key: action.action_key,
            endpoint_key: endpoint.endpoint_key,
            provider_domain: resolvedProviderDomain,
            message: err?.message || String(err)
          });
          const authErr = new Error("Delegated Google OAuth token mint failed.");
          authErr.code = "auth_resolution_failed";
          authErr.status = err?.status || 500;
          throw authErr;
        }
      } else if (
        authContract.mode === "none" &&
        isDelegatedTransportTarget(endpoint) &&
        isGoogleApiHost(resolvedProviderDomain)
      ) {
        try {
          authContract.mode = "bearer_token";
          authContract.header_name = "Authorization";
          authContract.secret = await mintGoogleAccessTokenForEndpoint({
            drive,
            policies,
            action,
            endpoint
          });
        } catch (err) {
          debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
            action_key: action.action_key,
            endpoint_key: endpoint.endpoint_key,
            provider_domain: resolvedProviderDomain,
            message: err?.message || String(err)
          });
          const authErr = new Error("Delegated Google OAuth token mint failed.");
          authErr.code = "auth_resolution_failed";
          authErr.status = err?.status || 500;
          throw authErr;
        }
      }

      ensureWritePermissions(brand, resolvedMethodPath.method);

      const schemaContract = await fetchSchemaContract(drive, action.openai_schema_file_id);
      const schemaOperationInfo = resolveSchemaOperation(schemaContract, resolvedMethodPath.method, resolvedMethodPath.path);
      if (!schemaOperationInfo) {
        const err = new Error(`Method/path not found in authoritative schema for ${parent_action_key}.`);
        err.code = "schema_path_method_mismatch";
        err.status = 422;
        throw err;
      }

      debugLog("NORMALIZED_QUERY:", query);
      const schemaValidationInput = injectAuthForSchemaValidation(
        query,
        callerHeaders,
        authContract
      );

      const queryWithAuth = schemaValidationInput.query;
      const headersWithAuthForValidation = {
        ...schemaValidationInput.headers,
        ...getAdditionalStaticAuthHeaders(action, authContract)
      };

      const schemaValidationErrors = [
        ...validateParameters(schemaOperationInfo.operation, {
          query: queryWithAuth,
          headers: headersWithAuthForValidation,
          path_params: pathParams
        }),
        ...validateRequestBody(schemaOperationInfo.operation, body)
      ];
      const route_id = String(endpoint?.endpoint_id || "").trim();
      const target_module = String(endpoint?.module_binding || "").trim();
      const target_workflow = String(action?.action_key || "").trim();
      const brand_name = String(brand?.brand_name || requestPayload.brand || "").trim();

      const callerAuthTrust = policyValue(policies, "HTTP Execution Governance", "Caller Authorization Header Trust", "FALSE");
      if (
        String(callerAuthTrust).toUpperCase() === "FALSE" &&
        (requestPayload.headers?.Authorization || requestPayload.headers?.authorization)
      ) {
        const err = new Error("Caller-supplied Authorization is not trusted by policy.");
        err.code = "forbidden_header";
        err.status = 403;
        throw err;
      }

      if (schemaValidationErrors.length) {
        const responsePayload = {
          ok: false,
          error: {
            code: "request_schema_mismatch",
            message: "Request failed schema alignment.",
            details: {
              request_schema_alignment_status: "degraded",
              errors: schemaValidationErrors,
              openai_schema_file_id: action.openai_schema_file_id,
              schema_name: schemaContract.name
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: responsePayload,
          error_code: "request_schema_mismatch",
          error_message_short: "Request failed schema alignment.",
          http_status: 422,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(422).json(responsePayload);
      }

      await logValidationRunWriteback({
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        validationStatus: "succeeded",
        validationPayload: {
          request_schema_alignment_status: "validated",
          openai_schema_file_id: action.openai_schema_file_id,
          schema_name: schemaContract.name
        },
        error_code: undefined,
        error_message_short: undefined,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      const finalQuery = queryWithAuth;
      let finalHeaders = {
        Accept: "application/json",
        ...(brand ? jsonParseSafe(brand.default_headers_json, {}) : {}),
        ...callerHeaders
      };
      finalHeaders = injectAuthIntoHeaders(finalHeaders, authContract);
      finalHeaders = {
        ...finalHeaders,
        ...getAdditionalStaticAuthHeaders(action, authContract)
      };

      if (body !== undefined && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
        finalHeaders["Content-Type"] = "application/json";
      }

      const baseUrl = buildUrl(resolvedProviderDomain, resolvedMethodPath.path);
      const requestUrl = appendQuery(baseUrl, finalQuery);

      debugLog("OUTBOUND_URL:", requestUrl);
      debugLog("AUTH_MODE:", authContract.mode);
      debugLog("HAS_AUTH_HEADER:", !!(finalHeaders["Authorization"] || finalHeaders["authorization"]));
      debugLog("AUTH_HEADER_NAME:", authContract.header_name || "");
      debugLog("HAS_CUSTOM_API_HEADER:", authContract.header_name ? !!finalHeaders[authContract.header_name] : false);

      const timeoutSeconds = Math.min(Number(requestPayload.timeout_seconds || 300), MAX_TIMEOUT_SECONDS);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

      const resilienceApplies = resilienceAppliesToParentAction(policies, parent_action_key);
      const providerRetryEnabled = retryMutationEnabled(policies);

      const maxAdditionalAttempts = Number(
        policyValue(
          policies,
          "HTTP Execution Resilience",
          "Provider Retry Max Additional Attempts",
          "0"
        )
      ) || 0;

      const retryMutations = buildProviderRetryMutations(
        policies,
        action?.action_key || parent_action_key
      );

      const transportBody = finalizeTransportBody(body);

      const upstreamRequest = {
        method: resolvedMethodPath.method,
        headers: finalHeaders,
        body: transportBody === undefined ? undefined : JSON.stringify(transportBody),
        signal: controller.signal,
        redirect: "follow"
      };

      let finalAttemptQuery = { ...finalQuery };
      let upstream;
      let data;
      let responseHeaders = {};
      let contentType = "";
      let responseText = "";
      let effectiveRequestUrl = requestUrl;

      const attempts = [{}, ...retryMutations].slice(
        0,
        1 + Math.max(0, maxAdditionalAttempts)
      );

      for (let i = 0; i < attempts.length; i++) {
        const mutation = attempts[i] || {};
        const attemptQuery = { ...finalQuery, ...mutation };
        const attemptUrl = appendQuery(baseUrl, attemptQuery);

        debugLog("RESILIENCE_APPLIES:", resilienceApplies);
        debugLog("PROVIDER_RETRY_ENABLED:", providerRetryEnabled);
        debugLog("PROVIDER_RETRY_ATTEMPT_INDEX:", i);
        debugLog("PROVIDER_RETRY_MUTATION:", mutation);
        debugLog("OUTBOUND_URL_ATTEMPT:", attemptUrl);

        const attemptResult = await executeUpstreamAttempt({
          requestUrl: attemptUrl,
          requestInit: upstreamRequest
        });

        upstream = attemptResult.upstream;
        data = attemptResult.data;
        responseHeaders = attemptResult.responseHeaders;
        contentType = attemptResult.contentType;
        responseText = attemptResult.responseText;
        effectiveRequestUrl = attemptUrl;
        finalAttemptQuery = attemptQuery;

        const canRetry =
          resilienceApplies &&
          providerRetryEnabled &&
          i < attempts.length - 1 &&
          shouldRetryProviderResponse(policies, upstream.status, responseText);

        if (!canRetry) {
          break;
        }
      }

      clearTimeout(timer);

      let responseSchemaAlignmentStatus = "not_declared";

      const responseSchemaEnforcementEnabled = String(
        policyValue(
          policies,
          "HTTP Response Schema Enforcement",
          "Response Schema Enforcement Enabled",
          "FALSE"
        )
      ).trim().toUpperCase() === "TRUE";

      const enforcedContentTypes = policyList(
        policies,
        "HTTP Response Schema Enforcement",
        "Response Content Type Enforcement"
      ).map(v => v.toLowerCase());

      const currentContentType = String(contentType || "").toLowerCase();

      const responseContent =
        schemaOperationInfo.operation?.responses?.[String(upstream.status)]?.content ||
        schemaOperationInfo.operation?.responses?.default?.content ||
        {};

      const responseJsonSchema =
        responseContent["application/json"]?.schema ||
        responseContent["application/problem+json"]?.schema ||
        null;

      const contentTypeEligible = enforcedContentTypes.length
        ? enforcedContentTypes.some(ct => currentContentType.includes(ct))
        : currentContentType.includes("application/json");

      if (responseSchemaEnforcementEnabled && contentTypeEligible) {
        if (!responseJsonSchema) {
          responseSchemaAlignmentStatus = "degraded";

          const responsePayload = {
            ok: false,
            error: {
              code: "response_schema_missing",
              message: "Response schema could not be resolved for schema-bound endpoint.",
              details: {
                schema_drift_detected: true,
                schema_drift_type: "structure_mismatch",
                schema_drift_scope: "response",
                schema_learning_candidate_emitted: true,
                upstream_status: upstream.status,
                openai_schema_file_id: action.openai_schema_file_id
              }
            }
          };

          await performUniversalServerWriteback({
            mode: "sync",
            job_id: undefined,
            target_key: requestPayload.target_key,
            parent_action_key,
            endpoint_key,
            route_id,
            target_module,
            target_workflow,
            source_layer: "http_client_backend",
            entry_type: "sync_execution",
            execution_class: "sync",
            attempt_count: 1,
            status_source: "failed",
            responseBody: responsePayload,
            error_code: "response_schema_missing",
            error_message_short: "Response schema could not be resolved for schema-bound endpoint.",
            http_status: 422,
            brand_name,
            execution_trace_id,
            started_at: sync_execution_started_at
          });

          return res.status(422).json(responsePayload);
        }

        responseSchemaAlignmentStatus = "validated";
        const responseErrors = validateByJsonSchema(responseJsonSchema, data, "response");
        if (responseErrors.length) {
          const drift = classifySchemaDrift(responseJsonSchema, data, "response") || {
            schema_drift_detected: true,
            schema_drift_type: "type_mismatch",
            schema_drift_scope: "response"
          };

          responseSchemaAlignmentStatus = "degraded";
          const responsePayload = {
            ok: false,
            error: {
              code: "response_schema_mismatch",
              message: "Response failed strict schema validation.",
              details: {
                errors: responseErrors,
                ...drift,
                schema_learning_candidate_emitted: true,
                upstream_status: upstream.status,
                openai_schema_file_id: action.openai_schema_file_id
              }
            }
          };

          await performUniversalServerWriteback({
            mode: "sync",
            job_id: undefined,
            target_key: requestPayload.target_key,
            parent_action_key,
            endpoint_key,
            route_id,
            target_module,
            target_workflow,
            source_layer: "http_client_backend",
            entry_type: "sync_execution",
            execution_class: "sync",
            attempt_count: 1,
            status_source: "failed",
            responseBody: responsePayload,
            error_code: "response_schema_mismatch",
            error_message_short: "Response failed strict schema validation.",
            http_status: 422,
            brand_name,
            execution_trace_id,
            started_at: sync_execution_started_at
          });

          return res.status(422).json(responsePayload);
        }
      }

      const compactWordPressCreate = parent_action_key === "wordpress_api" && endpoint_key === "wordpress_create_post";
      if (compactWordPressCreate) {
        const success = upstream.status === 201 && data && typeof data === "object" && data.id;
        if (success) {
          const responsePayload = {
            ok: true,
            upstream_status: upstream.status,
            provider_domain: resolvedProviderDomain,
            parent_action_key,
            endpoint_key,
            method: resolvedMethodPath.method,
            path: resolvedMethodPath.path,
            openai_schema_file_id: action.openai_schema_file_id,
            schema_name: schemaContract.name,
            resolved_auth_mode: authContract.mode,
            runtime_capability_class: action.runtime_capability_class || "",
            runtime_callable: boolFromSheet(action.runtime_callable),
            primary_executor: action.primary_executor || "",
            endpoint_role: endpoint.endpoint_role || "",
            execution_mode: endpoint.execution_mode || "",
            transport_required: boolFromSheet(endpoint.transport_required),
            request_schema_alignment_status: "validated",
            response_schema_alignment_status: responseSchemaAlignmentStatus,
            transport_request_contract_status: "validated",
            resolved_provider_domain_mode: resolvedProviderDomainMode,
            placeholder_resolution_source: placeholderResolutionSource,
            resilience_applied: resilienceApplies,
            final_query: finalAttemptQuery,
            request_url: effectiveRequestUrl,
            post_id: data.id,
            status: data.status,
            link: data.link || ""
          };

          await performUniversalServerWriteback({
            mode: "sync",
            job_id: undefined,
            target_key: requestPayload.target_key,
            parent_action_key,
            endpoint_key,
            route_id,
            target_module,
            target_workflow,
            source_layer: "http_client_backend",
            entry_type: "sync_execution",
            execution_class: "sync",
            attempt_count: 1,
            status_source: "succeeded",
            responseBody: data,
            error_code: data?.error?.code,
            error_message_short: data?.error?.message,
            http_status: upstream.status,
            brand_name,
            execution_trace_id,
            started_at: sync_execution_started_at
          });

          return res.status(200).json(responsePayload);
        }

        const responsePayload = {
          ok: false,
          upstream_status: upstream.status,
          provider_domain: resolvedProviderDomain,
          parent_action_key,
          endpoint_key,
          method: resolvedMethodPath.method,
          path: resolvedMethodPath.path,
          openai_schema_file_id: action.openai_schema_file_id,
          schema_name: schemaContract.name,
          resolved_auth_mode: authContract.mode,
          runtime_capability_class: action.runtime_capability_class || "",
          runtime_callable: boolFromSheet(action.runtime_callable),
          primary_executor: action.primary_executor || "",
          endpoint_role: endpoint.endpoint_role || "",
          execution_mode: endpoint.execution_mode || "",
          transport_required: boolFromSheet(endpoint.transport_required),
          request_schema_alignment_status: "validated",
          response_schema_alignment_status: responseSchemaAlignmentStatus,
          transport_request_contract_status: "validated",
          resolved_provider_domain_mode: resolvedProviderDomainMode,
          placeholder_resolution_source: placeholderResolutionSource,
          resilience_applied: resilienceApplies,
          final_query: finalAttemptQuery,
          request_url: effectiveRequestUrl,
          error: {
            code: "wordpress_request_failed",
            message: "WordPress did not confirm post creation.",
            details: {
              upstream_status: upstream.status,
              data
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: data,
          error_code: "wordpress_request_failed",
          error_message_short: "WordPress did not confirm post creation.",
          http_status: upstream.status,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(200).json(responsePayload);
      }

      const responsePayload = {
        ok: upstream.ok,
        status: upstream.status,
        provider_domain: resolvedProviderDomain,
        parent_action_key,
        endpoint_key,
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name,
        resolved_auth_mode: authContract.mode,
        runtime_capability_class: action.runtime_capability_class || "",
        runtime_callable: boolFromSheet(action.runtime_callable),
        primary_executor: action.primary_executor || "",
        endpoint_role: endpoint.endpoint_role || "",
        execution_mode: endpoint.execution_mode || "",
        transport_required: boolFromSheet(endpoint.transport_required),
        request_schema_alignment_status: "validated",
        response_schema_alignment_status: responseSchemaAlignmentStatus,
        transport_request_contract_status: "validated",
        resolved_provider_domain_mode: resolvedProviderDomainMode,
        placeholder_resolution_source: placeholderResolutionSource,
        resilience_applied: resilienceApplies,
        final_query: finalAttemptQuery,
        request_url: effectiveRequestUrl,
        response_headers: responseHeaders,
        data
      };

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: upstream.ok ? "succeeded" : "failed",
        responseBody: data,
        error_code: data?.error?.code,
        error_message_short: data?.error?.message,
        http_status: upstream.status,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res.status(upstream.ok ? 200 : upstream.status).json(responsePayload);
    } catch (err) {
      const errorPayload = {
        code: err?.code || "internal_error",
        message: err?.message || "Unexpected error.",
        status: err?.status || 500,
        details: err?.details || null
      };

      console.error(
        "HTTP_EXECUTE_ERROR:",
        JSON.stringify({
          error: errorPayload,
          request: {
            provider_domain: requestPayload?.provider_domain || req.body?.provider_domain || "",
            parent_action_key: requestPayload?.parent_action_key || req.body?.parent_action_key || "",
            endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
            method: requestPayload?.method || req.body?.method || "",
            path: requestPayload?.path || req.body?.path || ""
          },
          action: action
            ? {
                action_key: action.action_key,
                runtime_capability_class: action.runtime_capability_class,
                runtime_callable: action.runtime_callable,
                primary_executor: action.primary_executor
              }
            : null,
          endpoint: endpoint ? getEndpointExecutionSnapshot(endpoint) : null,
          brand: brand
            ? {
                brand_name: brand.brand_name,
                target_key: brand.target_key,
                base_url: brand.base_url
              }
            : null
        })
      );

      try {
        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload?.target_key || "",
          parent_action_key:
            requestPayload?.parent_action_key || req.body?.parent_action_key || "",
          endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
          route_id: String(endpoint?.endpoint_id || "").trim(),
          target_module: String(endpoint?.module_binding || "").trim(),
          target_workflow: String(action?.action_key || "").trim(),
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: errorPayload,
          error_code: errorPayload.code,
          error_message_short: errorPayload.message,
          http_status: errorPayload.status,
          brand_name: String(brand?.brand_name || requestPayload?.brand || req.body?.brand || "").trim(),
          execution_trace_id,
          started_at: sync_execution_started_at
        });
      } catch (writebackErr) {
        console.error("SYNC_WRITEBACK_FAILED:", writebackErr);
      }

      return res.status(errorPayload.status).json({
        ok: false,
        error: errorPayload
      });
    }
  });

  return router;
}
