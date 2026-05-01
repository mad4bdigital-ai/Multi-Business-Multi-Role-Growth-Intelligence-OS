const SURFACE_TYPE_ADAPTER_MAP = [
  ['sheet_tab', 'sheet_read'],
  ['google_sheet', 'sheet_read'],
  ['sheet', 'sheet_read'],
  ['shared_drive_folder', 'drive_folder_read'],
  ['drive_folder', 'drive_folder_read'],
  ['google_doc', 'doc_read'],
  ['google_document', 'doc_read'],
  ['json_asset', 'json_read'],
  ['json_file', 'json_read'],
];

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function deriveSurfaceAdapter(surfaceType) {
  const key = normalizeKey(surfaceType);
  for (const [pattern, adapter] of SURFACE_TYPE_ADAPTER_MAP) {
    if (key.includes(pattern)) return adapter;
  }
  if (key.includes('sheet')) return 'sheet_read';
  if (key.includes('folder') || key.includes('drive')) return 'drive_folder_read';
  if (key.includes('doc')) return 'doc_read';
  if (key.includes('json')) return 'json_read';
  return 'unknown_adapter';
}

function isAuthoritativeValue(value) {
  const s = normalizeKey(value);
  return s === 'true' || s === 'yes' || s === 'authoritative' || s === '1';
}

function resolveStatus(row) {
  const rawStatus = normalizeKey(row.status);
  const notes = normalizeKey(row.notes);
  if (rawStatus === 'superseded' || notes.includes('superseded')) return 'superseded';
  if (rawStatus === 'active' || rawStatus === 'validated' || rawStatus === 'authoritative') return 'active';
  return rawStatus || 'unknown';
}

export function resolveRegistrySurface({ surfaceId, surfaceCatalogRows }) {
  if (!stringValue(surfaceId)) {
    throw new Error('Missing required surfaceId');
  }
  if (!Array.isArray(surfaceCatalogRows)) {
    throw new Error('surfaceCatalogRows must be an array');
  }

  const targetId = normalizeKey(surfaceId);
  const row = surfaceCatalogRows.find((r) => normalizeKey(r.surface_id) === targetId);

  if (!row) {
    return {
      surfaceId,
      resolutionStatus: 'not_found',
      isAuthoritative: false,
      status: 'unknown',
      requiredAdapter: 'unknown_adapter'
    };
  }

  const surfaceType = stringValue(row.surface_type || row.type);
  const status = resolveStatus(row);

  return {
    surfaceId: stringValue(row.surface_id),
    surfaceName: stringValue(row.surface_name || row.name),
    surfaceType,
    surfaceLocation: stringValue(row.workbook_name || row.drive_path || row.location),
    workbookName: stringValue(row.workbook_name),
    sheetTab: stringValue(row.sheet_tab || row.tab_name),
    isAuthoritative: isAuthoritativeValue(row.is_authoritative || row.authoritative),
    status,
    requiredAdapter: deriveSurfaceAdapter(surfaceType),
    notes: stringValue(row.notes),
    resolutionStatus: 'resolved'
  };
}
