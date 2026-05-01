import assert from 'node:assert/strict';
import { resolveKnowledgeProfile } from './resolvers/knowledgeProfileResolver.js';

const profileRows = [
  {
    business_type: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    authoritative_read_home: 'surface.business_type_knowledge_profiles',
    business_type_specific_read_home: 'Knowlege/Business-Type/HVAC-Air-Conditioning-Services',
    shared_knowledge_read_home: 'Knowlege/Shared',
    compatible_route_keys: 'content_generation',
    compatible_workflows: 'wf_content_authority',
    profile_status: 'profile_registered',
    notes: 'Legacy path'
  },
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

const jsonAssetRows = [
  {
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    asset_id: 'json-asset-id-hvac',
    asset_path: 'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/storage_map.json'
  }
];

// selects canonical path over legacy
const kp = resolveKnowledgeProfile({
  businessTypeKey: 'hvac_air_conditioning_services',
  profileRows,
  jsonAssetRows
});
assert.equal(kp.resolutionStatus, 'resolved');
assert.equal(kp.businessTypeKey, 'hvac_air_conditioning_services');
assert.equal(kp.knowledgeProfileKey, 'hvac_air_conditioning_services_profile');
assert.equal(
  kp.folderPath,
  'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services'
);

// parses pipe-separated workflows and routes
assert.ok(Array.isArray(kp.compatibleWorkflows));
assert.ok(kp.compatibleWorkflows.includes('wf_content_authority'));
assert.ok(kp.compatibleWorkflows.includes('wf_growth_strategy'));
assert.ok(kp.compatibleRouteKeys.includes('seo_strategy'));

// links JSON asset when present
assert.equal(kp.jsonAssetId, 'json-asset-id-hvac');

// works without jsonAssetRows
const kpNoJson = resolveKnowledgeProfile({
  businessTypeKey: 'hvac_air_conditioning_services',
  profileRows
});
assert.equal(kpNoJson.jsonAssetId, '');

// throws when no canonical path found (only legacy rows)
const legacyOnlyRows = [profileRows[0]]; // only legacy row
assert.throws(
  () => resolveKnowledgeProfile({ businessTypeKey: 'hvac_air_conditioning_services', profileRows: legacyOnlyRows }),
  /non-canonical path/
);

// throws when business type not found
assert.throws(
  () => resolveKnowledgeProfile({ businessTypeKey: 'unknown_type', profileRows }),
  /No registered Business Type profile found/
);

console.log('knowledge profile resolver tests passed');
