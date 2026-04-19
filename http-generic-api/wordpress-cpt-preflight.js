import {
  buildWordpressCptSchemaPreflightAssetKey,
  buildWordpressCptSchemaPreflightPayload,
  extractJsonAssetPayloadBody,
  isWordpressCptSchemaPreflightEndpoint
} from "./utils.js";

export function inferWordpressInventoryAssetType(endpointKey = "") {
  const key = String(endpointKey || "").trim();

  if (isWordpressCptSchemaPreflightEndpoint(key)) {
    return "wordpress_cpt_schema_preflight";
  }

  if (key === "wordpress_list_tags") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_categories") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_types") return "wordpress_cpt_inventory";

  return "wordpress_runtime_response";
}

export function buildWordpressJsonAssetContext(args = {}) {
  const endpoint = String(args.endpoint_key || "").trim();
  const isWordpressPreflightAsset =
    String(args.asset_type || "").trim() === "wordpress_cpt_schema_preflight" ||
    isWordpressCptSchemaPreflightEndpoint(endpoint);

  const inferredAssetType =
    isWordpressPreflightAsset
      ? "wordpress_cpt_schema_preflight"
      : inferWordpressInventoryAssetType(endpoint);

  const assetKey =
    args.asset_key || (
      isWordpressPreflightAsset
        ? buildWordpressCptSchemaPreflightAssetKey(args)
        : `${endpoint}__${args.execution_trace_id}`
    );

  const payloadBody = isWordpressPreflightAsset
    ? buildWordpressCptSchemaPreflightPayload(args)
    : extractJsonAssetPayloadBody(args);

  return {
    isWordpressPreflightAsset,
    inferred_asset_type: inferredAssetType,
    asset_key: assetKey,
    payloadBody,
    mapping_status: isWordpressPreflightAsset
      ? "captured_governed_preflight"
      : "captured_unreduced",
    mapping_version: isWordpressPreflightAsset
      ? "wordpress_cpt_schema_preflight_asset_v1"
      : null,
    source_mode: isWordpressPreflightAsset
      ? "brand_driven_runtime_resolution"
      : "server_writeback_artifact",
    source_asset_ref: isWordpressPreflightAsset
      ? String(args.brand_playbook_asset_key || "").trim()
      : "",
    transport_status: isWordpressPreflightAsset
      ? "captured_governed"
      : null,
    validation_status: isWordpressPreflightAsset ? "validated" : "pending"
  };
}
