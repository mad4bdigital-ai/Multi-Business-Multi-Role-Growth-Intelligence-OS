import assert from "node:assert/strict";
import {
  buildGovernedExecutionContext,
  extractBusinessActivityContext,
  extractLogicContext,
  detectLegacyLogicExecutionRequest
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

{
  const ctx = buildGovernedExecutionContext({
    requestPayload: {
      target_key: "allroyalegypt_wp",
      business_activity_type_key: "travel_tourism",
      logic_id: "logic.012.seo_strategy"
    },
    brand,
    endpoint,
    action: { action_key: "wordpress_api" }
  });

  assert.equal(ctx.ok, true);
  assert.equal(ctx.business_activity.business_activity_type_key, "travel_tourism");
  assert.equal(ctx.brand.target_key, "allroyalegypt_wp");
  assert.equal(ctx.logic.logic_id, "logic.012.seo_strategy");
  assert.equal(ctx.gates.business_activity_type_first, true);
  assert.equal(ctx.gates.current_execution_authority_only, true);
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

console.log("governed context resolution tests passed");
