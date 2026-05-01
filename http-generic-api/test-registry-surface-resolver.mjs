import assert from 'node:assert/strict';
import { resolveRegistrySurface } from './resolvers/registrySurfaceResolver.js';

const surfaceCatalogRows = [
  {
    surface_id: 'surface.business_activity_type_registry',
    surface_name: 'Business Activity Type Registry',
    surface_type: 'sheet_tab',
    workbook_name: 'Growth Intelligence OS - Registry',
    sheet_tab: 'Business Activity Type Registry',
    is_authoritative: 'true',
    status: 'active',
    notes: ''
  },
  {
    surface_id: 'surface.business_type_hvac_shared_drive_folder',
    surface_name: 'HVAC Business Type Drive Folder',
    surface_type: 'shared_drive_folder',
    workbook_name: '',
    drive_path: 'Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services',
    is_authoritative: 'true',
    status: 'active',
    notes: ''
  },
  {
    surface_id: 'surface.brand_core_doc',
    surface_name: 'Brand Core Document',
    surface_type: 'google_doc',
    is_authoritative: 'yes',
    status: 'validated',
    notes: ''
  },
  {
    surface_id: 'surface.json_storage_map',
    surface_name: 'JSON Storage Map',
    surface_type: 'json_asset',
    is_authoritative: 'true',
    status: 'active',
    notes: ''
  },
  {
    surface_id: 'surface.legacy_business_type',
    surface_name: 'Legacy Business Type Folder',
    surface_type: 'drive_folder',
    is_authoritative: 'false',
    status: 'superseded',
    notes: 'superseded by shared drive'
  }
];

// sheet_tab resolves to sheet_read adapter
const sheetSurface = resolveRegistrySurface({
  surfaceId: 'surface.business_activity_type_registry',
  surfaceCatalogRows
});
assert.equal(sheetSurface.resolutionStatus, 'resolved');
assert.equal(sheetSurface.surfaceType, 'sheet_tab');
assert.equal(sheetSurface.requiredAdapter, 'sheet_read');
assert.equal(sheetSurface.isAuthoritative, true);
assert.equal(sheetSurface.status, 'active');
assert.equal(sheetSurface.workbookName, 'Growth Intelligence OS - Registry');

// shared_drive_folder resolves to drive_folder_read adapter
const driveSurface = resolveRegistrySurface({
  surfaceId: 'surface.business_type_hvac_shared_drive_folder',
  surfaceCatalogRows
});
assert.equal(driveSurface.requiredAdapter, 'drive_folder_read');
assert.equal(driveSurface.isAuthoritative, true);
assert.equal(driveSurface.status, 'active');

// google_doc resolves to doc_read adapter
const docSurface = resolveRegistrySurface({
  surfaceId: 'surface.brand_core_doc',
  surfaceCatalogRows
});
assert.equal(docSurface.requiredAdapter, 'doc_read');
assert.equal(docSurface.isAuthoritative, true);
assert.equal(docSurface.status, 'active');

// json_asset resolves to json_read adapter
const jsonSurface = resolveRegistrySurface({
  surfaceId: 'surface.json_storage_map',
  surfaceCatalogRows
});
assert.equal(jsonSurface.requiredAdapter, 'json_read');

// superseded surface
const legacySurface = resolveRegistrySurface({
  surfaceId: 'surface.legacy_business_type',
  surfaceCatalogRows
});
assert.equal(legacySurface.status, 'superseded');
assert.equal(legacySurface.isAuthoritative, false);

// not_found returns safe default
const notFound = resolveRegistrySurface({ surfaceId: 'surface.nonexistent', surfaceCatalogRows });
assert.equal(notFound.resolutionStatus, 'not_found');
assert.equal(notFound.isAuthoritative, false);
assert.equal(notFound.requiredAdapter, 'unknown_adapter');

// throws on empty surfaceId
assert.throws(
  () => resolveRegistrySurface({ surfaceId: '', surfaceCatalogRows }),
  /Missing required surfaceId/
);

// throws on missing surfaceCatalogRows
assert.throws(
  () => resolveRegistrySurface({ surfaceId: 'surface.foo', surfaceCatalogRows: null }),
  /surfaceCatalogRows must be an array/
);

console.log('registry surface resolver tests passed');
