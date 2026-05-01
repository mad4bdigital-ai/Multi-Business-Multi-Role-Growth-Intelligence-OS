import { loadSchemaOverlayJsonAssetById } from "./schemaOverlayJsonAssetLoader.js";

function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function jsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function methodKey(method = "") {
  return lower(method);
}

function isValidatedOverlayEndpoint(endpoint = {}) {
  return (
    lower(endpoint.schema_overlay_mode) === "endpoint_child_schema" &&
    lower(endpoint.schema_overlay_status) === "validated" &&
    normalize(endpoint.child_openai_schema_file_id)
  );
}

function buildOverlayOperationFromAsset(asset = {}, endpoint = {}) {
  const parsed = parseJson(asset.asset_json || asset.json || asset.contract || asset.content, asset);
  const operation = jsonObject(parsed.operation);
  const requestBody = jsonObject(parsed.requestBody || parsed.request_body);
  const response = jsonObject(parsed.response || parsed.responses);

  const resolvedMethod = normalize(parsed.method || endpoint.method);
  const resolvedPath = normalize(parsed.path || endpoint.endpoint_path_or_function);
  const operationId = normalize(operation.operationId || parsed.operationId || endpoint.endpoint_operation || endpoint.endpoint_key);

  if (!resolvedMethod || !resolvedPath || !operationId) {
    return null;
  }

  const operationContract = {
    operationId,
    summary: operation.summary || parsed.summary || endpoint.endpoint_title || "",
    description: operation.description || parsed.description || endpoint.notes || "",
    parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
    requestBody:
      Object.keys(requestBody).length > 0
        ? {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                  ...requestBody
                }
              }
            }
          }
        : {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true
                }
              }
            }
          },
    responses:
      Object.keys(response).length > 0
        ? {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: response
                }
              }
            }
          }
        : {
            "200": {
              description: "Successful response"
            }
          },
    "x-schema-overlay-source": "endpoint_child_schema",
    "x-schema-overlay-asset": normalize(endpoint.child_openai_schema_file_id)
  };

  return {
    path: resolvedPath,
    method: methodKey(resolvedMethod),
    operation: operationContract,
    source: "endpoint_child_schema",
    child_schema_asset_id: normalize(endpoint.child_openai_schema_file_id),
    schema_overlay_mode: normalize(endpoint.schema_overlay_mode),
    schema_overlay_status: normalize(endpoint.schema_overlay_status)
  };
}

async function loadChildSchemaAsset(endpoint = {}, deps = {}) {
  const assetId = normalize(endpoint.child_openai_schema_file_id);
  if (!assetId) return null;

  if (typeof deps.loadJsonAssetById === "function") {
    return deps.loadJsonAssetById(assetId);
  }

  if (typeof deps.getRegistryJsonAssetById === "function") {
    return deps.getRegistryJsonAssetById(assetId);
  }

  const registryAsset = await loadSchemaOverlayJsonAssetById(assetId, deps);
  if (registryAsset) {
    return registryAsset;
  }

  const inlineAsset = parseJson(endpoint.child_schema_json || endpoint.schema_overlay_json, null);
  if (inlineAsset) return inlineAsset;

  return null;
}

export async function resolveSchemaOperationTwoLayer({
  schemaContract,
  method,
  path,
  endpoint = {},
  parentActionKey = "",
  resolveSchemaOperation,
  deps = {}
}) {
  const parentOperation =
    typeof resolveSchemaOperation === "function"
      ? resolveSchemaOperation(schemaContract, method, path)
      : null;

  if (parentOperation) {
    return {
      ...parentOperation,
      schema_resolution_layer: "parent_action_schema",
      schema_overlay_applied: false
    };
  }

  if (!isValidatedOverlayEndpoint(endpoint)) {
    return null;
  }

  const overlayParent = normalize(endpoint.schema_overlay_parent_action_key);
  if (overlayParent && overlayParent !== normalize(parentActionKey)) {
    return null;
  }

  const asset = await loadChildSchemaAsset(endpoint, deps);
  if (!asset) {
    const err = new Error(
      `Endpoint child schema overlay asset not found: ${endpoint.child_openai_schema_file_id}`
    );
    err.code = "child_schema_overlay_asset_missing";
    err.status = 422;
    throw err;
  }

  const overlayOperation = buildOverlayOperationFromAsset(asset, endpoint);
  if (!overlayOperation) {
    const err = new Error(
      `Endpoint child schema overlay could not be built from asset: ${endpoint.child_openai_schema_file_id}`
    );
    err.code = "child_schema_overlay_build_failed";
    err.status = 422;
    throw err;
  }

  return {
    ...overlayOperation,
    schema_resolution_layer: "endpoint_child_schema",
    schema_overlay_applied: true
  };
}
