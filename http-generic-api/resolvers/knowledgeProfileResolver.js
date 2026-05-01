import { resolveBusinessTypePath } from './businessTypeBrandPathResolver.js';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function parsePipeList(value) {
  if (!stringValue(value)) return [];
  return stringValue(value)
    .split(/[;|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findJsonAssetRow(jsonAssetRows, businessTypeKey, knowledgeProfileKey) {
  const btKey = normalizeKey(businessTypeKey);
  const kpKey = normalizeKey(knowledgeProfileKey);
  return (
    jsonAssetRows.find(
      (row) =>
        normalizeKey(row.knowledge_profile_key || row.profile_key) === kpKey ||
        normalizeKey(row.business_type_key || row.business_type) === btKey
    ) || null
  );
}

export function resolveKnowledgeProfile({ businessTypeKey, profileRows, jsonAssetRows = [] }) {
  const businessTypeResolution = resolveBusinessTypePath({ businessTypeKey, profileRows });

  const jsonAssetRow = findJsonAssetRow(
    jsonAssetRows,
    businessTypeResolution.businessTypeKey,
    businessTypeResolution.knowledgeProfileKey
  );

  return {
    businessTypeKey: businessTypeResolution.businessTypeKey,
    knowledgeProfileKey: businessTypeResolution.knowledgeProfileKey,
    folderPath: businessTypeResolution.folderPath,
    authoritativeReadHome: businessTypeResolution.authoritativeReadHome,
    sharedKnowledgeReadHome: businessTypeResolution.sharedKnowledgeReadHome,
    compatibleWorkflows: parsePipeList(businessTypeResolution.compatibleWorkflows),
    compatibleRouteKeys: parsePipeList(businessTypeResolution.compatibleRouteKeys),
    profileStatus: businessTypeResolution.profileStatus,
    jsonAssetId: stringValue(jsonAssetRow?.asset_id || jsonAssetRow?.json_asset_id),
    jsonAssetPath: stringValue(jsonAssetRow?.asset_path || jsonAssetRow?.path),
    resolutionStatus: 'resolved'
  };
}
