import assert from 'node:assert/strict';
import { resolveBrandCore } from './resolvers/brandCoreResolver.js';

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
  },
  {
    brand_key: 'minimal_brand',
    normalized_brand_name: 'Minimal Brand',
    business_type_key: 'plumbing_services',
    knowledge_profile_key: 'plumbing_services_profile',
    target_key: 'minimal_brand',
    base_url: 'https://minimalbrand.com/',
    brand_core_required: 'false',
    is_readable: 'true',
    is_writable: 'false'
  }
];

const brandCoreRegistryRows = [
  {
    brand_key: 'arab_cooling',
    doc_key: 'brand_profile',
    doc_id: 'brand-profile-doc-id',
    status: 'active'
  },
  {
    brand_key: 'arab_cooling',
    doc_key: 'content_guidelines',
    doc_id: 'content-guidelines-doc-id',
    status: 'active'
  },
  {
    brand_key: 'arab_cooling',
    doc_key: 'seo_strategy',
    doc_id: 'seo-strategy-doc-id',
    status: 'validating'
  }
];

// full resolution with active and validating docs
const resolved = resolveBrandCore({
  brandKey: 'arab_cooling',
  brandRegistryRows,
  brandCoreRegistryRows
});
assert.equal(resolved.resolutionStatus, 'resolved');
assert.equal(resolved.brandKey, 'arab_cooling');
assert.equal(resolved.brandName, 'Arab Cooling');
assert.equal(resolved.businessTypeKey, 'hvac_air_conditioning_services');
assert.equal(resolved.brandCoreRequired, true);
assert.equal(resolved.isReadable, true);
assert.equal(resolved.isWritable, true);
assert.equal(resolved.coreRowCount, 3);
// not all docs are active → status is validating
assert.equal(resolved.brandCoreStatus, 'validating');
// content not ready until all core docs are active
assert.equal(resolved.contentReady, false);
assert.equal(resolved.strategyReady, false);
// doc map built from rows
assert.equal(resolved.brandCoreDocs['brand_profile'], 'brand-profile-doc-id');
assert.equal(resolved.brandCoreDocs['content_guidelines'], 'content-guidelines-doc-id');

// all docs active → contentReady and strategyReady
const allActiveRows = brandCoreRegistryRows.map((r) => ({ ...r, status: 'active' }));
const readyResult = resolveBrandCore({
  brandKey: 'arab_cooling',
  brandRegistryRows,
  brandCoreRegistryRows: allActiveRows
});
assert.equal(readyResult.brandCoreStatus, 'ready');
assert.equal(readyResult.contentReady, true);
assert.equal(readyResult.strategyReady, true);

// brand with brand_core_required: false → contentReady without docs
const minimal = resolveBrandCore({
  brandKey: 'minimal_brand',
  brandRegistryRows,
  brandCoreRegistryRows: []
});
assert.equal(minimal.brandCoreRequired, false);
assert.equal(minimal.brandCoreStatus, 'not_required');
assert.equal(minimal.contentReady, true);
assert.equal(minimal.isWritable, false);

// missing brand → not_found without throwing
const notFound = resolveBrandCore({
  brandKey: 'unknown_brand',
  brandRegistryRows,
  brandCoreRegistryRows: []
});
assert.equal(notFound.resolutionStatus, 'not_found');
assert.equal(notFound.contentReady, false);

// no core rows and required → missing status
const missingCore = resolveBrandCore({
  brandKey: 'arab_cooling',
  brandRegistryRows,
  brandCoreRegistryRows: []
});
assert.equal(missingCore.brandCoreStatus, 'missing');
assert.equal(missingCore.contentReady, false);

// throws on missing brandKey
assert.throws(
  () => resolveBrandCore({ brandKey: '', brandRegistryRows, brandCoreRegistryRows: [] }),
  /Missing required brandKey/
);

// throws on bad brandRegistryRows
assert.throws(
  () => resolveBrandCore({ brandKey: 'arab_cooling', brandRegistryRows: null }),
  /brandRegistryRows must be an array/
);

console.log('brand core resolver tests passed');
