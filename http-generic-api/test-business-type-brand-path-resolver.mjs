import assert from 'node:assert/strict';
import {
  buildBrandFolderPath,
  resolveBrandPath,
  resolveBusinessTypePath,
  validateBrandCompletionGate,
  validateBusinessTypeCompletionGate
} from './resolvers/businessTypeBrandPathResolver.js';

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

const businessTypeResolution = resolveBusinessTypePath({
  businessTypeKey: 'hvac_air_conditioning_services',
  profileRows
});

assert.equal(
  businessTypeResolution.folderPath,
  'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services'
);
assert.equal(
  businessTypeResolution.knowledgeProfileKey,
  'hvac_air_conditioning_services_profile'
);

const plannedBrandPath = buildBrandFolderPath({
  businessTypeResolution,
  brandKey: 'Arab Cooling'
});

assert.equal(plannedBrandPath.brandKey, 'arab_cooling');
assert.equal(
  plannedBrandPath.brandFolderPath,
  'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling'
);

const resolvedBrandPath = resolveBrandPath({
  brandKey: 'arab_cooling',
  businessTypeResolution,
  brandPathRows: [
    {
      brand_key: 'arab_cooling',
      normalized_brand_name: 'Arab Cooling',
      business_type_key: 'hvac_air_conditioning_services',
      knowledge_profile_key: 'hvac_air_conditioning_services_profile',
      brand_folder_id: 'brand-folder-id',
      brand_folder_path:
        'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling',
      brand_core_docs_json: '{"profile":"doc-id"}',
      target_key: 'arab_cooling',
      base_url: 'https://arabcooling.com/',
      status: 'active'
    }
  ]
});

assert.equal(resolvedBrandPath.brandFolderId, 'brand-folder-id');
assert.equal(resolvedBrandPath.resolutionStatus, 'active');

assert.equal(
  validateBusinessTypeCompletionGate({
    business_type_key: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    folder_id: 'folder-id',
    folder_path:
      'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services',
    json_asset_id: 'json-asset-id',
    validation_status: 'validated'
  }),
  true
);

assert.equal(
  validateBrandCompletionGate({
    brand_key: 'arab_cooling',
    business_type_key: 'hvac_air_conditioning_services',
    knowledge_profile_key: 'hvac_air_conditioning_services_profile',
    brand_folder_id: 'brand-folder-id',
    brand_folder_path:
      'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling',
    json_asset_id: 'json-asset-id',
    validation_status: 'validated'
  }),
  true
);

assert.throws(
  () =>
    resolveBusinessTypePath({
      businessTypeKey: 'legacy_only',
      profileRows: []
    }),
  /No registered Business Type profile/
);

console.log('business type and brand path resolver tests passed');
