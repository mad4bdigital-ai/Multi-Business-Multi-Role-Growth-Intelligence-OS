import { isWordpressRuntimeEndpoint } from "./brandLiveMutationPreflight.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function throwContract(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  throw err;
}

export function enforceWordpressPublishContract({ parent_action_key, endpoint, resolvedMethodPath, requestPayload, brand, governedExecutionContext } = {}) {
  if (String(parent_action_key || "").trim() !== "wordpress_api") {
    return { enforced: false, contract_status: "not_applicable", checks: {} };
  }

  const method = String(resolvedMethodPath?.method || "").toUpperCase();
  if (!WRITE_METHODS.has(method) || method === "PATCH" || method === "DELETE") {
    if (method !== "POST" && method !== "PUT") {
      return { enforced: false, contract_status: "not_applicable", checks: {} };
    }
  }
  if (method !== "POST" && method !== "PUT") {
    return { enforced: false, contract_status: "not_applicable", checks: {} };
  }

  const body = requestPayload?.body || {};
  const checks = {};
  let draftFirstRequired = false;

  // CHECK A — Draft-first enforcement
  const requestedStatus = String(body.status || body.post_status || "").toLowerCase();
  if (requestedStatus === "publish" || requestedStatus === "published") {
    if (body.enforce_draft_first !== false) {
      draftFirstRequired = true;
    }
  }

  // CHECK B — CPT schema preflight
  const pathMatch = String(endpoint?.endpoint_path_or_function || "").match(/\/wp\/v2\/([^/]+)/);
  const cpt_slug = String(body.type || body.post_type || (pathMatch ? pathMatch[1] : "") || "").trim();
  checks.cpt_slug = cpt_slug;

  // CHECK C — Multilingual classification (GAP 18)
  const multilingual =
    brand?.multilingual_capable === true ||
    brand?.multilingual_capable === 1 ||
    brand?.multilingual_capable === "1" ||
    brand?.multilingual_capable === "TRUE";

  if (multilingual) {
    const lang = body.lang || body.language || body.language_code || body.wpml_language;
    if (!lang) {
      throwContract(
        "multilingual_classification_required",
        422,
        "Brand has multilingual capability. lang or language_code is required on WordPress content mutations."
      );
    }
  }

  // CHECK D — Tour CPT validation (GAP 17)
  if (cpt_slug.includes("tour") || cpt_slug.includes("tours")) {
    const hasItinerary = body.itinerary || body.acf?.itinerary || body.meta?.itinerary;
    const hasPricing = body.pricing || body.acf?.pricing || body.meta?.pricing;
    if (!hasItinerary || !hasPricing) {
      throwContract(
        "tour_cpt_contract_violation",
        422,
        "Tour CPT publish requires itinerary and pricing fields."
      );
    }
    checks.tour_cpt_validated = true;
  }

  return {
    enforced: true,
    contract_status: "preflight_passed",
    checks: {
      draft_first_required: draftFirstRequired,
      cpt_slug,
      multilingual_classification_checked: multilingual,
      tour_cpt_validated: checks.tour_cpt_validated || false
    }
  };
}
