import assert from 'node:assert/strict';
import { resolveContext } from './resolvers/index.js';

const profileRows = [
  {
    business_type: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    authoritative_read_home: 'surface.business_type_hvac_shared_drive_folder',
    business_type_specific_read_home:
      'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services',
    shared_knowledge_read_home:
      'Growth Intelligence OS - Knowledge Assets/Business Type Assets/Shared',
    compatible_route_keys: 'content_generation; seo_strategy',
    compatible_workflows: 'wf_content_authority; wf_growth_strategy',
    profile_status: 'profile_registered',
    notes: 'FINAL GOVERNED SHARED DRIVE PATH'
  }
];

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
  }
];

const brandRegistryRows = [
  {
    brand_key: 'arab_cooling',
    normalized_brand_name: 'Arab Cooling',
    business_type_key: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    target_key: 'arab_cooling',
    base_url: 'https://arabcooling.com/',
    brand_core_required: 'true',
    is_readable: 'true',
    is_writable: 'true'
  }
];

const brandCoreRegistryRows = [
  { brand_key: 'arab_cooling', doc_key: 'brand_profile', doc_id: 'doc-id-1', status: 'active' },
  { brand_key: 'arab_cooling', doc_key: 'content_guidelines', doc_id: 'doc-id-2', status: 'active' }
];

const brandPathRows = [
  {
    brand_key: 'arab_cooling',
    normalized_brand_name: 'Arab Cooling',
    business_type_key: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    brand_folder_id: 'brand-folder-id',
    brand_folder_path:
      'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling',
    status: 'active'
  }
];

// full context → ready
const full = resolveContext({
  business_type_key: 'hvac_air_conditioning_services',
  brand_key: 'arab_cooling',
  rows: {
    activityTypeRegistryRows,
    profileRows,
    brandRegistryRows,
    brandCoreRegistryRows,
    brandPathRows
  }
});
assert.equal(full.validation_state, 'ready');
assert.ok(full.business_activity !== null, 'business_activity should be resolved');
assert.equal(full.business_activity.parentActivity, 'home_services');
assert.ok(full.knowledge_profile !== null);
assert.equal(full.knowledge_profile.knowledgeProfileKey, 'hvac_air_conditioning_services_profile');
assert.ok(full.business_type !== null);
assert.ok(full.brand !== null);
assert.equal(full.brand.brandFolderId, 'brand-folder-id');
assert.ok(full.brand_core !== null);
assert.equal(full.brand_core.brandCoreStatus, 'ready');
assert.ok(full.paths !== null);
assert.ok(full.paths.businessTypeFolderPath.includes('HVAC'));
assert.ok(full.paths.brandFolderPath.includes('arab_cooling'));

// business type only → ready without brand
const typeOnly = resolveContext({
  business_type_key: 'hvac_air_conditioning_services',
  rows: { profileRows }
});
assert.equal(typeOnly.validation_state, 'ready');
assert.ok(typeOnly.knowledge_profile !== null);
assert.equal(typeOnly.brand, null);

// brand with no brand core rows → validating (brand_core_required but no docs)
const noCoreRows = resolveContext({
  business_type_key: 'hvac_air_conditioning_services',
  brand_key: 'arab_cooling',
  rows: { profileRows, brandRegistryRows, brandCoreRegistryRows: [], brandPathRows }
});
assert.equal(noCoreRows.validation_state, 'validating');
assert.equal(noCoreRows.brand_core.brandCoreStatus, 'missing');

// unknown business type → blocked
const blocked = resolveContext({
  business_type_key: 'unknown_type',
  rows: { profileRows }
});
assert.equal(blocked.validation_state, 'blocked');
assert.ok(blocked.blocked_reason);
assert.equal(blocked.knowledge_profile, null);

// empty call → validating (no data provided)
const empty = resolveContext({});
assert.equal(empty.validation_state, 'validating');

// business_activity_type_key override
const activityOverride = resolveContext({
  business_type_key: 'hvac_air_conditioning_services',
  business_activity_type_key: 'hvac_air_conditioning_services',
  rows: { activityTypeRegistryRows, profileRows }
});
assert.ok(activityOverride.business_activity !== null);

console.log('resolver context tests passed');
