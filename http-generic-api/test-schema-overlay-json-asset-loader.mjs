import assert from "node:assert/strict";
import { loadSchemaOverlayJsonAssetById } from "./schemaOverlayJsonAssetLoader.js";

const sheetData = {
  "Schema Overlay Assets": [
    [
      "asset_id",
      "method",
      "path",
      "operation_id",
      "asset_json",
      "status"
    ],
    [
      "overlay-asset-001",
      "POST",
      "/wp/v2/posts",
      "createPost",
      JSON.stringify({
        method: "POST",
        path: "/wp/v2/posts",
        operation: {
          operationId: "createPost",
          summary: "Create a WordPress post",
          parameters: []
        },
        requestBody: {
          type: "object",
          properties: { title: { type: "string" } }
        },
        response: {
          type: "object",
          properties: { id: { type: "integer" } }
        }
      }),
      "active"
    ],
    [
      "overlay-asset-002",
      "PUT",
      "/wp/v2/posts/{id}",
      "updatePost",
      JSON.stringify({
        method: "PUT",
        path: "/wp/v2/posts/{id}",
        operation: {
          operationId: "updatePost",
          parameters: [{ name: "id", in: "path", required: true }]
        },
        requestBody: {}
      }),
      "active"
    ],
    [
      "overlay-asset-retired",
      "DELETE",
      "/wp/v2/posts/{id}",
      "deletePost",
      JSON.stringify({ method: "DELETE" }),
      "retired"
    ]
  ]
};

function makeDeps() {
  return {
    REGISTRY_SPREADSHEET_ID: "registry-sheet-id",
    async getGoogleClientsForSpreadsheet() {
      return {
        sheets: {
          spreadsheets: {
            values: {
              async get({ range }) {
                const match = range.match(/^'(.+)'!/);
                const sheetName = match ? match[1].replace(/''/g, "'") : "";
                return { data: { values: sheetData[sheetName] || [] } };
              }
            }
          }
        }
      };
    }
  };
}

// 1 — loads a valid asset by ID
{
  const result = await loadSchemaOverlayJsonAssetById("overlay-asset-001", makeDeps());

  assert.ok(result, "result is non-null");
  assert.equal(result.asset_id, "overlay-asset-001");
  assert.equal(result.method, "POST");
  assert.equal(result.path, "/wp/v2/posts");
  assert.equal(result.operation_id, "createPost");
  assert.ok(result.asset_json, "asset_json is present");
  assert.equal(result.asset_json.operation.operationId, "createPost");
}

// 2 — loads a second asset
{
  const result = await loadSchemaOverlayJsonAssetById("overlay-asset-002", makeDeps());

  assert.ok(result, "result is non-null");
  assert.equal(result.asset_id, "overlay-asset-002");
  assert.equal(result.method, "PUT");
}

// 3 — retired asset is skipped → returns null
{
  const result = await loadSchemaOverlayJsonAssetById("overlay-asset-retired", makeDeps());
  assert.equal(result, null, "retired asset returns null");
}

// 4 — unknown asset ID returns null
{
  const result = await loadSchemaOverlayJsonAssetById("no-such-asset", makeDeps());
  assert.equal(result, null, "unknown asset returns null");
}

// 5 — empty asset ID returns null
{
  const result = await loadSchemaOverlayJsonAssetById("", makeDeps());
  assert.equal(result, null, "empty asset ID returns null");
}

// 6 — missing REGISTRY_SPREADSHEET_ID returns null
{
  const result = await loadSchemaOverlayJsonAssetById("overlay-asset-001", {
    ...makeDeps(),
    REGISTRY_SPREADSHEET_ID: ""
  });
  assert.equal(result, null, "missing spreadsheet ID returns null");
}

// 7 — missing getGoogleClientsForSpreadsheet returns null
{
  const result = await loadSchemaOverlayJsonAssetById("overlay-asset-001", {
    REGISTRY_SPREADSHEET_ID: "registry-sheet-id"
  });
  assert.equal(result, null, "missing sheets dep returns null");
}

console.log("schema overlay JSON asset loader tests passed");
