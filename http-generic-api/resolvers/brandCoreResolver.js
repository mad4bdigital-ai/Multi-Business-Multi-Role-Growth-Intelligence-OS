function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function isTrueish(value) {
  const s = normalizeKey(value);
  return s === 'true' || s === 'yes' || s === '1';
}

function isFalseish(value) {
  const s = normalizeKey(value);
  return s === 'false' || s === 'no' || s === '0';
}

function isActiveStatus(value) {
  const s = normalizeKey(value);
  return s === 'active' || s === 'validated' || s === 'ready';
}

function resolveBrandCoreStatus(coreRows, brandCoreRequired) {
  if (!brandCoreRequired) return 'not_required';
  if (coreRows.length === 0) return 'missing';
  const allActive = coreRows.every((row) =>
    isActiveStatus(row.status || row.core_status || row.validation_status)
  );
  return allActive ? 'ready' : 'validating';
}

function buildBrandCoreDocs(coreRows) {
  return coreRows.reduce((acc, row) => {
    const docKey = stringValue(row.doc_key || row.core_doc_key || row.asset_key || row.asset_type || row.doc_type);
    const docId = stringValue(row.doc_id || row.file_id || row.google_doc_id);
    if (docKey && docId) acc[docKey] = docId;
    return acc;
  }, {});
}

export function resolveBrandCore({ brandKey, brandRegistryRows, brandCoreRegistryRows = [] }) {
  if (!stringValue(brandKey)) {
    throw new Error('Missing required brandKey');
  }
  if (!Array.isArray(brandRegistryRows)) {
    throw new Error('brandRegistryRows must be an array');
  }

  const targetKey = normalizeKey(brandKey);
  const brandRow = brandRegistryRows.find(
    (row) =>
      normalizeKey(row.brand_key) === targetKey || normalizeKey(row.target_key) === targetKey
  );

  if (!brandRow) {
    return {
      brandKey,
      resolutionStatus: 'not_found',
      brandCoreRequired: false,
      contentReady: false,
      strategyReady: false
    };
  }

  const coreRows = brandCoreRegistryRows.filter(
    (row) =>
      normalizeKey(row.brand_key) === targetKey || normalizeKey(row.target_key) === targetKey
  );

  const brandCoreRequiredRaw = brandRow.brand_core_required ?? brandRow.requires_brand_core ?? 'true';
  const brandCoreRequired = !isFalseish(brandCoreRequiredRaw);
  const isReadable = !isFalseish(brandRow.is_readable ?? brandRow.readable ?? 'true');
  const isWritable = isTrueish(brandRow.is_writable ?? brandRow.writable ?? 'false');

  const brandCoreStatus = resolveBrandCoreStatus(coreRows, brandCoreRequired);
  const brandCoreDocs = buildBrandCoreDocs(coreRows);

  const contentReady = brandCoreStatus === 'ready' || !brandCoreRequired;
  const strategyReady = brandCoreStatus === 'ready' && isReadable;

  return {
    brandKey: stringValue(brandRow.brand_key || brandRow.target_key),
    brandName: stringValue(brandRow.brand_name || brandRow.normalized_brand_name),
    businessTypeKey: stringValue(brandRow.business_type_key),
    knowledgeProfileKey: stringValue(brandRow.knowledge_profile_key),
    targetKey: stringValue(brandRow.target_key),
    baseUrl: stringValue(brandRow.base_url || brandRow.site_url),
    brandCoreRequired,
    brandCoreStatus,
    brandCoreDocs,
    coreRowCount: coreRows.length,
    isReadable,
    isWritable,
    contentReady,
    strategyReady,
    resolutionStatus: 'resolved'
  };
}
