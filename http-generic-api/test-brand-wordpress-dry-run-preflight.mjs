import assert from "node:assert/strict";
import {
  enforceBrandLiveMutationPreflight,
  isExplicitDryRunPreflight
} from "./brandLiveMutationPreflight.js";

const endpoint = {
  parent_action_key: "wordpress_api",
  route_target: "wordpress_api",
  endpoint_key: "wordpress_update_tours_and_activities",
  endpoint_path_or_function: "/wp/v2/tours-and-activities/{id}",
  method: "POST"
};

const baseInput = {
  parent_action_key: "wordpress_api",
  endpoint,
  resolvedMethodPath: {
    method: "POST",
    path: "/wp/v2/tours-and-activities/{id}"
  },
  brand: {
    brand_name: "AllRoyalEgypt Brand",
    target_key: "allroyalegypt_wp"
  }
};

function assertGate(code, fn) {
  try {
    fn();
  } catch (err) {
    assert.equal(err.code, code);
    assert.equal(err.status, 403);
    return err;
  }
  assert.fail(`Expected gate ${code}`);
}

assert.equal(
  isExplicitDryRunPreflight({
    dry_run: true,
    preflight_only: true,
    mutation_approval: {
      dry_run: true,
      preflight_only: true
    }
  }),
  true
);

assert.equal(
  isExplicitDryRunPreflight({
    dry_run: true,
    preflight_only: false,
    mutation_approval: {
      dry_run: true,
      preflight_only: true
    }
  }),
  false
);

assertGate("brand_mutation_operator_approval_required", () =>
  enforceBrandLiveMutationPreflight({
    ...baseInput,
    requestPayload: {
      body: {
        package_levels: [2286, 2288]
      },
      taxonomy_mapping_validated: true
    }
  })
);

assertGate("approved_post_without_dry_run_blocked", () =>
  enforceBrandLiveMutationPreflight({
    ...baseInput,
    requestPayload: {
      operator_approved: true,
      taxonomy_mapping_validated: true,
      body: {
        package_levels: [2286, 2288]
      }
    }
  })
);

const dryRun = enforceBrandLiveMutationPreflight({
  ...baseInput,
  requestPayload: {
    operator_approved: true,
    dry_run: true,
    preflight_only: true,
    taxonomy_mapping_validated: true,
    mutation_approval: {
      approved: true,
      dry_run: true,
      preflight_only: true
    },
    body: {
      package_levels: [2286, 2288]
    }
  }
});

assert.equal(dryRun.enforced, true);
assert.equal(dryRun.preflight_status, "dry_run_preflight_only");
assert.equal(dryRun.no_outbound_request, true);
assert.equal(dryRun.execution_blocked, true);

const live = enforceBrandLiveMutationPreflight({
  ...baseInput,
  requestPayload: {
    operator_approved: true,
    taxonomy_mapping_validated: true,
    dry_run_preflight_completed: true,
    live_execution_approved: true,
    body: {
      package_levels: [2286, 2288]
    }
  }
});

assert.equal(live.preflight_status, "passed");

// body-nested approval fields (real HTTP client sends controls inside body)
assert.equal(
  isExplicitDryRunPreflight({
    body: {
      dry_run: true,
      preflight_only: true,
      mutation_approval: { dry_run: true, preflight_only: true }
    }
  }),
  true,
  "body-nested dry_run + preflight_only detected"
);

assertGate("brand_mutation_operator_approval_required", () =>
  enforceBrandLiveMutationPreflight({
    ...baseInput,
    requestPayload: {
      body: { package_levels: [2286, 2288] }
    }
  })
);

const dryRunBodyNested = enforceBrandLiveMutationPreflight({
  ...baseInput,
  requestPayload: {
    body: {
      operator_approved: true,
      dry_run: true,
      preflight_only: true,
      mutation_approval: { approved: true, dry_run: true, preflight_only: true },
      package_levels: [2286, 2288]
    }
  }
});
assert.equal(dryRunBodyNested.preflight_status, "dry_run_preflight_only");
assert.equal(dryRunBodyNested.no_outbound_request, true);

const liveBodyNested = enforceBrandLiveMutationPreflight({
  ...baseInput,
  requestPayload: {
    body: {
      operator_approved: true,
      dry_run_preflight_completed: true,
      live_execution_approved: true,
      package_levels: [2286, 2288]
    }
  }
});
assert.equal(liveBodyNested.preflight_status, "passed");

console.log("brand WordPress dry-run preflight tests passed");
