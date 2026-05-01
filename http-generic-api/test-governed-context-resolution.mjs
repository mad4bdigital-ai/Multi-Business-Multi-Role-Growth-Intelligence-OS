import assert from "node:assert/strict";
import {
  buildGovernedExecutionContext,
  extractBusinessActivityContext,
  extractLogicContext,
  detectLegacyLogicExecutionRequest,
  extractPathResolutionContext,
  buildPathResolutionContext
} from "./governedContextResolution.js";

const endpoint = {
  parent_action_key: "wordpress_api",
  endpoint_key: "wordpress_get_tours_and_activities",
  provider_domain: "target_resolved",
  provider_family: "wordpress_cms",
  category_group: "CMS / Content Operations",
  method: "GET",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}",
  brand_resolution_source: "Brand Registry",
  endpoint_role: "primary",
  execution_mode: "http_delegated"
};

const brand = {
  brand_name: "AllRoyalEgypt Brand",
  normalized_brand_name: "allroyalegypt",
  target_key: "allroyalegypt_wp",
  brand_domain: "allroyalegypt.com"
};

const pathResolverRows = {
  businessActivityRows: [
    {
      business_activity_type_key: "travel_tourism",
      default_knowledge_profile_key: "tourism_core_profile",
      supported_route_keys: "content_generation; seo_strategy",
      supported_workflows: "wf_travel_content",
      brand_core_required: "TRUE",
      status: "active"
    }
  ],
  profileRows: [
    {
      business_type: "travel_tourism",
      knowledge_profile_key: "tourism_core_profile",
      authoritative_read_home: "surface.business_type_travel_shared_drive_folder",
      business_type_specific_read_home:
        "Growth Intelligence OS - Knowledge Assets/Business Type Assets/travel",
      shared_knowledge_read_home:
        "Growth Intelligence OS - Knowledge Assets/Business Type Assets/travel/01-business-type-shared",
      compatible_route_keys: "content_generation; seo_strategy",
      compatible_workflows: "wf_travel_content",
      profile_status: "profile_registered",
      notes: "FINAL GOVERNED SHARED DRIVE PATH"
    }
  ],
  brandRows: [
    {
      brand_key: "allroyalegypt_wp",
      normalized_brand_name: "AllRoyalEgypt Brand",
      business_type_key: "travel_tourism",
      knowledge_profile_key: "tourism_core_profile",
      brand_folder_id: "brand-folder-id",
      target_key: "allroyalegypt_wp",
      base_url: "https://allroyalegypt.com/",
      status: "active"
    }
  ],
  brandPathRows: [
    {
      brand_key: "allroyalegypt_wp",
      normalized_brand_name: "AllRoyalEgypt Brand",
      business_type_key: "travel_tourism",
      knowledge_profile_key: "tourism_core_profile",
      brand_folder_id: "brand-folder-id",
      brand_folder_path:
        "Growth Intelligence OS - Knowledge Assets/Business Type Assets/travel/brands/allroyalegypt_wp",
      brand_core_docs_json: '{"profile":"doc-id"}',
      target_key: "allroyalegypt_wp",
      base_url: "https://allroyalegypt.com/",
      status: "active"
    }
  ],
  brandCoreRows: [
    {
      brand_key: "allroyalegypt_wp",
      asset_key: "profile",
      doc_id: "doc-id",
      status: "active"
    }
  ],
  targetRows: [
    {
      target_key: "allroyalegypt_wp",
      brand_key: "allroyalegypt_wp",
      base_url: "https://allroyalegypt.com/",
      provider: "wordpress",
      auth_status: "ready",
      validation_state: "ready",
      status: "active"
    }
  ],
  validationRows: [
    {
      validation_id: "VAL-TRAVEL-BRAND",
      entity_key: "allroyalegypt_wp",
      surface_id: "surface.business_type_travel_shared_drive_folder",
      validation_status: "validated",
      readiness_state: "ready",
      status: "active",
      last_validated_at: "2026-05-01T00:00:00Z"
    }
  ]
};

{
  const ctx = buildGovernedExecutionContext({
    requestPayload: {
      target_key: "allroyalegypt_wp",
      business_activity_type_key: "travel_tourism",
      business_type_key: "travel_tourism",
      brand_key: "allroyalegypt_wp",
      logic_id: "logic.012.seo_strategy"
    },
    brand,
    endpoint,
    action: { action_key: "wordpress_api" },
    pathResolverRows
  });

  assert.equal(ctx.ok, true);
  assert.equal(ctx.business_activity.business_activity_type_key, "travel_tourism");
  assert.equal(ctx.brand.target_key, "allroyalegypt_wp");
  assert.equal(ctx.logic.logic_id, "logic.012.seo_strategy");
  assert.equal(ctx.gates.business_activity_type_first, true);
  assert.equal(ctx.gates.current_execution_authority_only, true);
  assert.equal(ctx.path_resolution.resolution_status, "ready");
  assert.equal(ctx.path_resolution.businessType.businessTypeKey, "travel_tourism");
  assert.equal(ctx.path_resolution.brand.brandKey, "allroyalegypt_wp");
  assert.equal(ctx.path_resolution.brandCore.docs.profile, "doc-id");
}

{
  const declared = extractPathResolutionContext({
    context: {
      path_resolution: {
        business_type_key: "travel_tourism",
        brand_key: "allroyalegypt_wp"
      }
    }
  });
  assert.equal(declared.requested, true);
  assert.equal(declared.business_type_key, "travel_tourism");
  assert.equal(declared.brand_key, "allroyalegypt_wp");
}

{
  const pathResolution = buildPathResolutionContext({
    requestPayload: {
      business_type_key: "travel_tourism",
      brand_key: "allroyalegypt_wp"
    }
  });
  assert.equal(pathResolution.resolution_status, "not_attempted_missing_resolver_rows");
}

{
  const activity = extractBusinessActivityContext({
    context: {
      business_activity: {
        business_activity_type_key: "travel_tourism"
      }
    }
  });
  assert.equal(activity.requested, true);
  assert.equal(activity.business_activity_type_key, "travel_tourism");
}

{
  const logic = extractLogicContext({
    logic_functional_role: "content_strategy"
  });
  assert.equal(logic.requested, true);
  assert.equal(logic.functional_role, "content_strategy");
}

{
  assert.equal(
    detectLegacyLogicExecutionRequest({
      logic_id: "GPT-LOGIC-004"
    }),
    true
  );
}

{
  assert.throws(
    () =>
      buildGovernedExecutionContext({
        requestPayload: {
          target_key: "other_brand",
          logic_id: "logic.004.content_strategy"
        },
        brand,
        endpoint,
        action: { action_key: "wordpress_api" }
      }),
    /target_key/
  );
}

{
  assert.throws(
    () =>
      buildGovernedExecutionContext({
        requestPayload: {
          target_key: "allroyalegypt_wp",
          logic_id: "GPT-LOGIC-004"
        },
        brand,
        endpoint,
        action: { action_key: "wordpress_api" }
      }),
    /Legacy Logic/
  );
}

{
  const ctx = buildGovernedExecutionContext({
    requestPayload: {
      target_key: "allroyalegypt_wp",
      logic_id: "GPT-LOGIC-004",
      legacy_logic_lineage_lookup: true
    },
    brand,
    endpoint,
    action: { action_key: "wordpress_api" }
  });
  assert.equal(ctx.logic.resolution_status, "declared");
  assert.equal(ctx.gates.legacy_logic_direct_execution_blocked, true);
}

{
  assert.throws(
    () =>
      buildGovernedExecutionContext({
        requestPayload: {
          target_key: "allroyalegypt_wp"
        },
        brand: null,
        endpoint,
        action: { action_key: "wordpress_api" }
      }),
    /Brand Registry/
  );
}

{
  assert.throws(
    () =>
      buildGovernedExecutionContext({
        requestPayload: {
          target_key: "allroyalegypt_wp",
          mutation_intent: "create_brand_folder",
          business_type_key: "travel_tourism",
          brand_key: "allroyalegypt_wp"
        },
        brand,
        endpoint,
        action: { action_key: "wordpress_api" }
      }),
    /resolver rows/
  );
}

console.log("governed context resolution tests passed");
