import assert from "node:assert/strict";
import {
  REGISTRY_WORKBOOK_ID,
  GOOGLE_SHEETS_PARENT_ACTION_KEY,
  isRegistrySurfaceTargetKey,
  isGoogleSheetsRegistryRequest,
  inferRegistryWritebackScope,
  resolveRegistrySurfaceTarget,
  assertRegistrySurfaceTargetAllowed
} from "./registrySurfaceResolution.js";

// --- isRegistrySurfaceTargetKey ---

assert.equal(isRegistrySurfaceTargetKey("surface.endpoint_registry_sheet"), true);
assert.equal(isRegistrySurfaceTargetKey("surface.validation_and_repair_registry_sheet"), true);
assert.equal(isRegistrySurfaceTargetKey("allroyalegypt_wp"), false);
assert.equal(isRegistrySurfaceTargetKey(""), false);
assert.equal(isRegistrySurfaceTargetKey(undefined), false);

// --- isGoogleSheetsRegistryRequest ---

{
  const mutation = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "updateSheetValues",
    requestPayload: {
      target_key: "surface.validation_and_repair_registry_sheet",
      path_params: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(mutation), true, "mutation on registry workbook");
}

{
  const read = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "getSheetValues",
    requestPayload: {
      target_key: "surface.endpoint_registry_sheet",
      path_params: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(read), true, "read from registry workbook");
}

{
  const wrongAction = {
    parentActionKey: "wordpress_api",
    endpointKey: "updateSheetValues",
    requestPayload: {
      target_key: "surface.endpoint_registry_sheet",
      path_params: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(wrongAction), false, "wrong parent action");
}

{
  const wrongSpreadsheet = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "updateSheetValues",
    requestPayload: {
      target_key: "surface.endpoint_registry_sheet",
      path_params: { spreadsheetId: "OTHER_SPREADSHEET_ID" }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(wrongSpreadsheet), false, "wrong spreadsheet id");
}

{
  const brandTarget = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "updateSheetValues",
    requestPayload: {
      target_key: "allroyalegypt_wp",
      path_params: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(brandTarget), false, "brand target_key not registry surface");
}

{
  const bodySpreadsheetId = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "batchUpdateSpreadsheet",
    requestPayload: {
      target_key: "surface.workflow_registry_sheet",
      body: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(bodySpreadsheetId), true, "spreadsheetId from body");
}

{
  const unknownEndpoint = {
    parentActionKey: GOOGLE_SHEETS_PARENT_ACTION_KEY,
    endpointKey: "someOtherEndpoint",
    requestPayload: {
      target_key: "surface.endpoint_registry_sheet",
      path_params: { spreadsheetId: REGISTRY_WORKBOOK_ID }
    }
  };
  assert.equal(isGoogleSheetsRegistryRequest(unknownEndpoint), false, "unknown endpoint key");
}

// --- inferRegistryWritebackScope ---

assert.equal(inferRegistryWritebackScope("surface.validation_and_repair_registry_sheet"), "validation_registry");
assert.equal(inferRegistryWritebackScope("surface.endpoint_registry_sheet"), "endpoint_registry");
assert.equal(inferRegistryWritebackScope("surface.actions_registry_sheet"), "actions_registry");
assert.equal(inferRegistryWritebackScope("surface.registry_surfaces_catalog_sheet"), "registry_surfaces");
assert.equal(inferRegistryWritebackScope("surface.execution_bindings_sheet"), "execution_bindings");
assert.equal(inferRegistryWritebackScope("surface.workflow_registry_sheet"), "workflow_registry");
assert.equal(inferRegistryWritebackScope("surface.task_routes_sheet"), "task_routes");
assert.equal(inferRegistryWritebackScope("surface.execution_policy_registry_sheet"), "execution_policy_registry");
assert.equal(inferRegistryWritebackScope("surface.repair_mapping_registry_sheet"), "repair_mapping_registry");
assert.equal(inferRegistryWritebackScope("surface.unknown_sheet"), "registry_surface");

// --- resolveRegistrySurfaceTarget ---

{
  const result = resolveRegistrySurfaceTarget({
    targetKey: "surface.validation_and_repair_registry_sheet",
    endpointKey: "updateSheetValues"
  });
  assert.equal(result.resolution_mode, "registry_surface");
  assert.equal(result.target_key, "surface.validation_and_repair_registry_sheet");
  assert.equal(result.base_url, "https://sheets.googleapis.com");
  assert.equal(result.registry_surface_auth_mode, "bearer_token");
  assert.equal(result.brand_scope_required, false);
  assert.equal(result.brand_target_override_allowed, false);
  assert.equal(result.write_allowed, "TRUE");
  assert.equal(result.username, "");
  assert.equal(result.application_password, "");
  assert.equal(result.default_headers_json, null);
  assert.equal(result.writeback_scope, "validation_registry");
  // auth_type must be empty so inferAuthMode defers to action.oauth_config_file_id
  assert.equal(result.auth_type, "");
}

{
  assert.throws(
    () => resolveRegistrySurfaceTarget({ targetKey: "allroyalegypt_wp", endpointKey: "updateSheetValues" }),
    err => err.code === "registry_surface_target_required"
  );
}

// --- assertRegistrySurfaceTargetAllowed ---

{
  const valid = resolveRegistrySurfaceTarget({
    targetKey: "surface.endpoint_registry_sheet",
    endpointKey: "getSheetValues"
  });
  assert.doesNotThrow(() => assertRegistrySurfaceTargetAllowed(valid));
}

{
  const badAuthMode = { resolution_mode: "registry_surface", registry_surface_auth_mode: "basic_auth", target_key: "surface.x", username: "", application_password: "" };
  assert.throws(
    () => assertRegistrySurfaceTargetAllowed(badAuthMode),
    err => err.code === "registry_surface_requires_bearer_token"
  );
}

{
  const wpTarget = { resolution_mode: "registry_surface", registry_surface_auth_mode: "bearer_token", target_key: "allroyalegypt_wp", username: "", application_password: "" };
  assert.throws(
    () => assertRegistrySurfaceTargetAllowed(wpTarget),
    err => err.code === "registry_surface_cannot_use_wordpress_target"
  );
}

{
  const credentialLeak = { resolution_mode: "registry_surface", registry_surface_auth_mode: "bearer_token", target_key: "surface.x", username: "admin", application_password: "secret" };
  assert.throws(
    () => assertRegistrySurfaceTargetAllowed(credentialLeak),
    err => err.code === "registry_surface_brand_credentials_leaked"
  );
}

{
  // Non-registry-surface brand passes through guard unchanged
  const brandObject = { resolution_mode: undefined, target_key: "allroyalegypt_wp" };
  assert.doesNotThrow(() => assertRegistrySurfaceTargetAllowed(brandObject));
}

{
  // Null brand passes guard (guard is a no-op for null)
  assert.doesNotThrow(() => assertRegistrySurfaceTargetAllowed(null));
}

console.log("registry surface resolution tests passed");
