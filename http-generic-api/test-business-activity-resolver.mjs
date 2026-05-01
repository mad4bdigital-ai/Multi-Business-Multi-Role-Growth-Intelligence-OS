import assert from 'node:assert/strict';
import { resolveBusinessActivity } from './resolvers/businessActivityResolver.js';

const activityTypeRegistryRows = [
  {
    business_activity_type_key: 'hvac_air_conditioning_services',
    activity_type_name: 'HVAC Air Conditioning Services',
    parent_activity: 'home_services',
    default_knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    compatible_engines: 'content_engine; seo_engine',
    brand_core_required: 'true',
    status: 'active',
    notes: ''
  },
  {
    business_activity_type_key: 'plumbing_services',
    activity_type_name: 'Plumbing Services',
    parent_activity: 'home_services',
    default_knowledge_profile_key: 'plumbing_services_profile',
    compatible_engines: 'content_engine',
    brand_core_required: 'required',
    status: 'active',
    notes: ''
  },
  {
    business_activity_type_key: 'legacy_type',
    activity_type_name: 'Legacy Type',
    parent_activity: '',
    default_knowledge_profile_key: 'legacy_profile',
    compatible_engines: '',
    brand_core_required: 'optional',
    status: 'superseded',
    notes: ''
  }
];

// resolves active row with pipe-listed engines
const hvac = resolveBusinessActivity({
  businessActivityTypeKey: 'hvac_air_conditioning_services',
  activityTypeRegistryRows
});
assert.equal(hvac.businessActivityTypeKey, 'hvac_air_conditioning_services');
assert.equal(hvac.activityTypeName, 'HVAC Air Conditioning Services');
assert.equal(hvac.parentActivity, 'home_services');
assert.equal(hvac.defaultKnowledgeProfileKey, 'hvac_air_conditioning_services_profile');
assert.deepEqual(hvac.compatibleEngines, ['content_engine', 'seo_engine']);
assert.equal(hvac.requiredBrandCoreBehavior, 'required');
assert.equal(hvac.activityStatus, 'active');

// resolves 'required' string as required behavior
const plumbing = resolveBusinessActivity({
  businessActivityTypeKey: 'plumbing_services',
  activityTypeRegistryRows
});
assert.equal(plumbing.requiredBrandCoreBehavior, 'required');
assert.deepEqual(plumbing.compatibleEngines, ['content_engine']);

// resolves superseded row (no active row present) — falls back to only available
const legacy = resolveBusinessActivity({
  businessActivityTypeKey: 'legacy_type',
  activityTypeRegistryRows
});
assert.equal(legacy.requiredBrandCoreBehavior, 'optional');

// case-insensitive key lookup
const caseTest = resolveBusinessActivity({
  businessActivityTypeKey: 'HVAC_Air_Conditioning_Services',
  activityTypeRegistryRows
});
assert.equal(caseTest.businessActivityTypeKey, 'hvac_air_conditioning_services');

// throws when no matching row
assert.throws(
  () => resolveBusinessActivity({ businessActivityTypeKey: 'unknown_type', activityTypeRegistryRows }),
  /No Business Activity Type found/
);

// throws on missing key
assert.throws(
  () => resolveBusinessActivity({ businessActivityTypeKey: '', activityTypeRegistryRows }),
  /Missing required businessActivityTypeKey/
);

// throws on bad rows
assert.throws(
  () => resolveBusinessActivity({ businessActivityTypeKey: 'hvac_air_conditioning_services', activityTypeRegistryRows: null }),
  /activityTypeRegistryRows must be an array/
);

console.log('business activity resolver tests passed');
