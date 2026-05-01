export { resolveRegistrySurface } from './registrySurfaceResolver.js';
export { resolveBusinessActivity } from './businessActivityResolver.js';
export { resolveKnowledgeProfile } from './knowledgeProfileResolver.js';
export {
  resolveBusinessTypePath,
  buildBrandFolderPath,
  resolveBrandPath,
  validateBusinessTypeCompletionGate,
  validateBrandCompletionGate,
  CANONICAL_BUSINESS_TYPE_ROOT,
  LEGACY_PATH_MARKERS
} from './businessTypeBrandPathResolver.js';
export { resolveBrandCore } from './brandCoreResolver.js';

import { resolveBusinessActivity } from './businessActivityResolver.js';
import { resolveKnowledgeProfile } from './knowledgeProfileResolver.js';
import { resolveBrandPath } from './businessTypeBrandPathResolver.js';
import { resolveBrandCore } from './brandCoreResolver.js';

export function resolveContext({
  business_type_key,
  business_activity_type_key,
  brand_key,
  rows: {
    activityTypeRegistryRows = [],
    profileRows = [],
    brandRegistryRows = [],
    brandCoreRegistryRows = [],
    brandPathRows = [],
    jsonAssetRows = []
  } = {}
} = {}) {
  const context = {
    business_activity: null,
    business_type: null,
    knowledge_profile: null,
    brand: null,
    brand_core: null,
    paths: null,
    validation_state: 'unknown',
    blocked_reason: null
  };

  const activityKey = business_activity_type_key || business_type_key;
  if (activityKey && activityTypeRegistryRows.length > 0) {
    try {
      context.business_activity = resolveBusinessActivity({
        businessActivityTypeKey: activityKey,
        activityTypeRegistryRows
      });
    } catch {
      // business activity is supporting context; failure does not block
    }
  }

  if (business_type_key && profileRows.length > 0) {
    try {
      const kp = resolveKnowledgeProfile({ businessTypeKey: business_type_key, profileRows, jsonAssetRows });
      context.knowledge_profile = kp;
      context.business_type = {
        businessTypeKey: kp.businessTypeKey,
        knowledgeProfileKey: kp.knowledgeProfileKey,
        folderPath: kp.folderPath,
        profileStatus: kp.profileStatus
      };
      context.paths = { businessTypeFolderPath: kp.folderPath };
    } catch (err) {
      context.validation_state = 'blocked';
      context.blocked_reason = err.message;
      return context;
    }
  }

  if (brand_key && context.knowledge_profile) {
    try {
      const brandResolution = resolveBrandPath({
        brandKey: brand_key,
        brandPathRows,
        businessTypeResolution: context.knowledge_profile
      });
      context.brand = brandResolution;
      context.paths.brandFolderPath = brandResolution.brandFolderPath;
    } catch (err) {
      context.validation_state = 'blocked';
      context.blocked_reason = err.message;
      return context;
    }
  }

  if (brand_key && brandRegistryRows.length > 0) {
    try {
      context.brand_core = resolveBrandCore({ brandKey: brand_key, brandRegistryRows, brandCoreRegistryRows });
    } catch {
      // brand core failure is surfaced via brand_core: null, not a hard block
    }
  }

  const businessTypeReady = !!context.knowledge_profile;
  const brandReady = !brand_key || (!!context.brand && context.brand.resolutionStatus !== 'not_found');
  const brandCoreReady =
    !brand_key || !context.brand_core?.brandCoreRequired || context.brand_core?.contentReady;

  if (businessTypeReady && brandReady && brandCoreReady) {
    context.validation_state = 'ready';
  } else if (businessTypeReady && brandReady) {
    context.validation_state = 'validating';
  } else if (!businessTypeReady && business_type_key) {
    context.validation_state = 'blocked';
    context.blocked_reason = context.blocked_reason || 'business_type_resolution_failed';
  } else {
    context.validation_state = 'validating';
  }

  return context;
}
