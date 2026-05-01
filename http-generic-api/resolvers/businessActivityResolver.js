function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function isActiveStatus(value) {
  const s = normalizeKey(value);
  return s === 'active' || s === 'validated' || s === 'registered';
}

function parsePipeList(value) {
  if (!stringValue(value)) return [];
  return stringValue(value)
    .split(/[;|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveRequiredBrandCoreBehavior(row) {
  const val = normalizeKey(
    row.brand_core_required || row.requires_brand_core || row.brand_core_behavior || ''
  );
  if (val === 'true' || val === 'yes' || val === 'required') return 'required';
  if (val === 'optional') return 'optional';
  return 'not_applicable';
}

export function resolveBusinessActivity({ businessActivityTypeKey, activityTypeRegistryRows }) {
  if (!stringValue(businessActivityTypeKey)) {
    throw new Error('Missing required businessActivityTypeKey');
  }
  if (!Array.isArray(activityTypeRegistryRows)) {
    throw new Error('activityTypeRegistryRows must be an array');
  }

  const targetKey = normalizeKey(businessActivityTypeKey);
  const candidates = activityTypeRegistryRows.filter(
    (row) =>
      normalizeKey(row.business_activity_type_key || row.activity_type_key || row.business_type) ===
      targetKey
  );

  if (candidates.length === 0) {
    throw new Error(`No Business Activity Type found for: ${businessActivityTypeKey}`);
  }

  const active = candidates.find((row) =>
    isActiveStatus(row.status || row.activity_status || row.profile_status)
  );
  const selected = active || candidates[0];

  return {
    businessActivityTypeKey: stringValue(
      selected.business_activity_type_key || selected.activity_type_key || selected.business_type
    ),
    activityTypeName: stringValue(selected.activity_type_name || selected.name),
    parentActivity: stringValue(selected.parent_activity || selected.parent_activity_type_key),
    defaultKnowledgeProfileKey: stringValue(
      selected.default_knowledge_profile_key || selected.knowledge_profile_key
    ),
    compatibleEngines: parsePipeList(selected.compatible_engines || selected.engines),
    requiredBrandCoreBehavior: resolveRequiredBrandCoreBehavior(selected),
    activityStatus: stringValue(selected.status || selected.activity_status || selected.profile_status),
    notes: stringValue(selected.notes)
  };
}
