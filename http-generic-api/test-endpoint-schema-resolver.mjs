import assert from "node:assert/strict";

import {
  buildOpenApiContractFromEndpointContract,
  readChildSchemaAssetContract,
  readEndpointSchemaOverlayNotesContract,
  resolveEndpointLocalSchemaContract
} from "./endpointSchemaResolver.js";

const endpoint = {
  endpoint_id: "ACT-WP-CPT-EP-001",
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_update_tours_and_activities",
  method: "POST",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}",
  child_openai_schema_file_id: "schema.asset.wordpress_update_tours_and_activities.dry_run_preflight.v1"
};

const overlayContract = {
  schema_version: "2026-05-01.v1",
  operationId: "wordpress_update_tours_and_activities",
  method: "POST",
  path: "/wp/v2/tours-and-activities/{id}",
  requestEnvelopeControls: {
    operator_approved: { type: "boolean" },
    dry_run: { type: "boolean" }
  },
  bodySchema: {
    type: "object",
    additionalProperties: true,
    properties: {
      package_levels: { type: "array", items: { type: "integer" } }
    }
  },
  response: {
    type: "object",
    properties: {
      ok: { type: "boolean" }
    }
  },
  governance: {
    mutation_class: "brand_live_update_existing",
    preflight_required: true
  }
};

{
  const contract = buildOpenApiContractFromEndpointContract(overlayContract, endpoint, {
    source: "unit_test"
  });

  assert.ok(contract, "contract is built");
  assert.equal(contract.source, "unit_test");
  assert.equal(contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post.operationId, "wordpress_update_tours_and_activities");
  assert.equal(
    contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post.requestBody.content["application/json"].schema.properties.package_levels.items.type,
    "integer"
  );
  assert.equal(
    contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post["x-internal-request-envelope-controls"].dry_run.type,
    "boolean"
  );
}

{
  const endpointWithSchemaJson = {
    ...endpoint,
    schema_json: JSON.stringify({
      operationId: "from_schema_json",
      method: "POST",
      path: "/wp/v2/tours-and-activities/{id}",
      bodySchema: { type: "object" }
    }),
    schema_overlay_notes: JSON.stringify({
      ...overlayContract,
      operationId: "from_overlay_notes"
    })
  };

  const contract = resolveEndpointLocalSchemaContract(endpointWithSchemaJson, {
    jsonAssets: [
      {
        asset_key: endpoint.child_openai_schema_file_id,
        json_payload: JSON.stringify({ ...overlayContract, operationId: "from_child_asset" })
      }
    ]
  });

  assert.equal(contract.source, "endpoint.schema_json");
  assert.equal(contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post.operationId, "from_schema_json");
}

{
  const endpointWithOverlayNotes = {
    ...endpoint,
    schema_json: "",
    schema_overlay_notes: JSON.stringify({
      ...overlayContract,
      operationId: "from_overlay_notes"
    })
  };

  const contract = readEndpointSchemaOverlayNotesContract(endpointWithOverlayNotes);
  assert.ok(contract, "overlay notes contract is read");
  assert.equal(contract.source, "schema_overlay_notes");
  assert.equal(contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post.operationId, "from_overlay_notes");
}

{
  const jsonAssets = [
    {
      asset_id: "other",
      asset_key: "other",
      json_payload: JSON.stringify({ operationId: "wrong", method: "POST", path: "/wrong" })
    },
    {
      asset_id: "asset-row-id",
      asset_key: endpoint.child_openai_schema_file_id,
      json_payload: JSON.stringify({
        ...overlayContract,
        operationId: "from_child_asset"
      })
    }
  ];

  const contract = readChildSchemaAssetContract(endpoint, jsonAssets);
  assert.ok(contract, "child asset contract is read");
  assert.equal(contract.source, "child_schema_asset");
  assert.equal(contract.parsed.paths["/wp/v2/tours-and-activities/{id}"].post.operationId, "from_child_asset");
}

{
  const emptyContract = resolveEndpointLocalSchemaContract({
    endpoint_id: "no_schema",
    endpoint_key: "no_schema",
    method: "GET",
    endpoint_path_or_function: "/health"
  });

  assert.equal(emptyContract, null, "resolver falls back to parent schema when no local schema exists");
}

console.log("endpoint schema resolver tests passed");
