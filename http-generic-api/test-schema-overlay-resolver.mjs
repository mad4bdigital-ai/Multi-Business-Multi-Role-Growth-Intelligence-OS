import assert from "node:assert/strict";
import { resolveSchemaOperationTwoLayer } from "./schemaOverlayResolver.js";

const baseEndpoint = {
  endpoint_key: "create_post",
  endpoint_path_or_function: "/wp/v2/posts",
  method: "POST",
  schema_overlay_mode: "endpoint_child_schema",
  schema_overlay_status: "validated",
  child_openai_schema_file_id: "asset-abc123"
};

const childAsset = {
  asset_json: JSON.stringify({
    method: "POST",
    path: "/wp/v2/posts",
    operation: {
      operationId: "createPost",
      summary: "Create a post",
      parameters: []
    },
    requestBody: {
      type: "object",
      properties: {
        title: { type: "string" }
      }
    },
    response: {
      type: "object",
      properties: {
        id: { type: "integer" }
      }
    }
  })
};

// 1 — parent schema has the operation → returned directly, no overlay
{
  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: baseEndpoint,
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => ({
      operation: { operationId: "createPost", parameters: [], requestBody: { required: false } }
    }),
    deps: {}
  });

  assert.ok(result, "result is truthy");
  assert.equal(result.schema_resolution_layer, "parent_action_schema");
  assert.equal(result.schema_overlay_applied, false);
}

// 2 — parent schema missing, valid overlay endpoint, asset loaded → overlay applied
{
  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: baseEndpoint,
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => null,
    deps: {
      loadJsonAssetById: async () => childAsset
    }
  });

  assert.ok(result, "result is truthy");
  assert.equal(result.schema_resolution_layer, "endpoint_child_schema");
  assert.equal(result.schema_overlay_applied, true);
  assert.equal(result.child_schema_asset_id, "asset-abc123");
  assert.ok(result.operation, "operation is present");
  assert.equal(result.operation.operationId, "createPost");
}

// 3 — endpoint not in validated overlay state → returns null
{
  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: {
      ...baseEndpoint,
      schema_overlay_status: "draft"
    },
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => null,
    deps: {}
  });

  assert.equal(result, null, "returns null for non-validated overlay");
}

// 4 — endpoint has overlay parent key that doesn't match → returns null
{
  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: {
      ...baseEndpoint,
      schema_overlay_parent_action_key: "other_action"
    },
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => null,
    deps: {}
  });

  assert.equal(result, null, "returns null when parent action key mismatch");
}

// 5 — overlay endpoint but asset not found → throws with code
{
  await assert.rejects(
    () =>
      resolveSchemaOperationTwoLayer({
        schemaContract: {},
        method: "POST",
        path: "/wp/v2/posts",
        endpoint: baseEndpoint,
        parentActionKey: "wordpress_api",
        resolveSchemaOperation: () => null,
        deps: {
          loadJsonAssetById: async () => null
        }
      }),
    (err) => {
      assert.equal(err.code, "child_schema_overlay_asset_missing");
      assert.equal(err.status, 422);
      return true;
    }
  );
}

// 6 — inline asset via endpoint.child_schema_json (no loadJsonAssetById dep)
{
  const inlineEndpoint = {
    ...baseEndpoint,
    child_schema_json: JSON.stringify({
      method: "POST",
      path: "/wp/v2/posts",
      operation: {
        operationId: "createPostInline",
        parameters: []
      },
      requestBody: {}
    })
  };

  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: inlineEndpoint,
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => null,
    deps: {}
  });

  assert.ok(result, "inline asset resolved");
  assert.equal(result.schema_overlay_applied, true);
  assert.equal(result.operation.operationId, "createPostInline");
}

// 7 — getRegistryJsonAssetById fallback dep is used
{
  const result = await resolveSchemaOperationTwoLayer({
    schemaContract: {},
    method: "POST",
    path: "/wp/v2/posts",
    endpoint: baseEndpoint,
    parentActionKey: "wordpress_api",
    resolveSchemaOperation: () => null,
    deps: {
      getRegistryJsonAssetById: async () => childAsset
    }
  });

  assert.ok(result, "fallback dep works");
  assert.equal(result.schema_overlay_applied, true);
}

console.log("schema overlay resolver tests passed");
