import * as sqlAdapter from "./sqlAdapter.js";
import {
  getSpreadsheetSheetMap as getSpreadsheetSheetMapCore,
  ensureSheetWithHeader as ensureSheetWithHeaderCore,
  appendRowsIfMissingByKeys as appendRowsIfMissingByKeysCore,
  ensureSiteMigrationRegistrySurfaces as ensureSiteMigrationRegistrySurfacesCore,
  ensureSiteMigrationRouteWorkflowRows as ensureSiteMigrationRouteWorkflowRowsCore,
  ensureAiResolverRouteWorkflowRows as ensureAiResolverRouteWorkflowRowsCore,
  buildAiResolverRegistryReadiness
} from "./routeWorkflowGovernance.js";

import {
  loadSiteRuntimeInventoryRegistry as loadSiteRuntimeInventoryRegistryCore,
  loadSiteSettingsInventoryRegistry as loadSiteSettingsInventoryRegistryCore,
  loadPluginInventoryRegistry as loadPluginInventoryRegistryCore
} from "./siteInventoryRegistry.js";

import {
  loadTaskRoutesRegistry as loadTaskRoutesRegistryCore,
  loadWorkflowRegistry as loadWorkflowRegistryCore
} from "./routeWorkflowRegistryModels.js";

import {
  readGovernedSheetRecords as readGovernedSheetRecordsCore,
  normalizeLooseHostname as normalizeLooseHostnameCore,
  findRegistryRecordByIdentity as findRegistryRecordByIdentityCore,
  resolveBrandRegistryBinding as resolveBrandRegistryBindingCore,
  hostingerSshRuntimeRead as hostingerSshRuntimeReadCore
} from "./governedRecordResolution.js";

import { headerMap, getCell } from "./sheetHelpers.js";
import { assertSheetExistsInSpreadsheet, fetchChunkedTable, fetchRange, getGoogleClients, getGoogleClientsForSpreadsheet } from "./googleSheets.js";
import { asBool, boolFromSheet, rowToObject } from "./runtimeHelpers.js";
import { createHttpError } from "./utils.js";
import { registryError, toValuesApiRange } from "./registry.js";
import { assertHeaderMatchesSurfaceMetadata, getCanonicalSurfaceMetadata, readLiveSheetShape, toA1Start, toSheetCellValue } from "./surfaceMetadata.js";
import { matchesHostingerSshTarget } from "./utils.js";
import { firstPopulated } from "./domainAdapters/wordpressAdapter.js";
import { governedAdditionStateBlocksAuthority, hasDeferredGovernedActivationDependencies, normalizeGovernedAdditionState, assertSingleActiveRowByKey } from "./routeWorkflowGovernance.js";
import { computeHeaderSignature } from "./surfaceMetadata.js";

export function createStateManager(config) {
  const {
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    GOVERNED_ADDITION_STATES,
    REGISTRY_SPREADSHEET_ID,
    PLUGIN_INVENTORY_REGISTRY_SHEET,
    SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
    SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
    REQUIRED_SITE_MIGRATION_TASK_KEYS,
    REQUIRED_SITE_MIGRATION_WORKFLOW_IDS,
    REQUIRED_AI_RESOLVER_INTENT_KEYS,
    GOVERNED_ADDITION_OUTCOMES,
    BRAND_REGISTRY_SHEET,
    HOSTING_ACCOUNT_REGISTRY_RANGE,
    HOSTING_ACCOUNT_REGISTRY_SHEET,
    SITE_MIGRATION_TASK_ROUTE_COLUMNS,
    SITE_MIGRATION_WORKFLOW_COLUMNS,
    SITE_MIGRATION_TASK_ROUTE_ROWS,
    SITE_MIGRATION_WORKFLOW_ROWS
  } = config;

  async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
    return getSpreadsheetSheetMapCore(sheets, spreadsheetId);
  }

  async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns) {
    return ensureSheetWithHeaderCore(sheets, spreadsheetId, sheetName, columns, {
      TASK_ROUTES_CANONICAL_COLUMNS,
      TASK_ROUTES_SHEET,
      WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      WORKFLOW_REGISTRY_SHEET,
      computeHeaderSignature,
      toValuesApiRange
    });
  }

  async function appendRowsIfMissingByKeys(
    sheets,
    spreadsheetId,
    sheetName,
    columns,
    keyColumns,
    rows = []
  ) {
    return appendRowsIfMissingByKeysCore(
      sheets,
      spreadsheetId,
      sheetName,
      columns,
      keyColumns,
      rows,
      {
        TASK_ROUTES_CANONICAL_COLUMNS,
        TASK_ROUTES_SHEET,
        WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
        WORKFLOW_REGISTRY_SHEET,
        GOVERNED_ADDITION_STATES,
        toA1Start,
        toSheetCellValue,
        toValuesApiRange
      }
    );
  }

  async function ensureSiteMigrationRegistrySurfaces() {
    return ensureSiteMigrationRegistrySurfacesCore({
      REGISTRY_SPREADSHEET_ID,
      PLUGIN_INVENTORY_REGISTRY_SHEET,
      SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
      SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
      TASK_ROUTES_CANONICAL_COLUMNS,
      TASK_ROUTES_SHEET,
      WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      WORKFLOW_REGISTRY_SHEET,
      assertHeaderMatchesSurfaceMetadata,
      assertSheetExistsInSpreadsheet,
      getCanonicalSurfaceMetadata,
      readLiveSheetShape,
      toValuesApiRange,
      siteMigrationTaskRouteColumnsDefined: typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined",
      siteMigrationWorkflowColumnsDefined: typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined",
      siteMigrationTaskRouteRowsDefined: typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined",
      siteMigrationWorkflowRowsDefined: typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
    });
  }

  async function ensureSiteMigrationRouteWorkflowRows() {
    return ensureSiteMigrationRouteWorkflowRowsCore({
      REGISTRY_SPREADSHEET_ID,
      REQUIRED_SITE_MIGRATION_TASK_KEYS,
      REQUIRED_SITE_MIGRATION_WORKFLOW_IDS,
      GOVERNED_ADDITION_OUTCOMES,
      GOVERNED_ADDITION_STATES,
      TASK_ROUTES_CANONICAL_COLUMNS,
      TASK_ROUTES_SHEET,
      WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      WORKFLOW_REGISTRY_SHEET,
      assertHeaderMatchesSurfaceMetadata,
      boolFromSheet,
      getCanonicalSurfaceMetadata,
      getGoogleClients,
      loadTaskRoutesRegistry,
      loadWorkflowRegistry,
      readLiveSheetShape,
      toValuesApiRange,
      siteMigrationTaskRouteColumnsDefined: typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined",
      siteMigrationWorkflowColumnsDefined: typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined",
      siteMigrationTaskRouteRowsDefined: typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined",
      siteMigrationWorkflowRowsDefined: typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
    });
  }

  async function ensureAiResolverRouteWorkflowRows() {
    const dsMode = (process.env.DATA_SOURCE || "sheets").toLowerCase();
    if (dsMode !== "sheets") {
      try {
        const [taskRoutes, workflows] = await Promise.all([
          sqlAdapter.readTable(TASK_ROUTES_SHEET),
          sqlAdapter.readTable(WORKFLOW_REGISTRY_SHEET)
        ]);
        if (taskRoutes.length || workflows.length) {
          return buildAiResolverRegistryReadiness({
            requiredIntentKeys: REQUIRED_AI_RESOLVER_INTENT_KEYS,
            taskRoutes,
            workflows
          });
        }
      } catch (err) {
        console.warn(`[dataSource] AI resolver SQL readiness failed, falling back to Sheets: ${err.message}`);
      }
    }

    return ensureAiResolverRouteWorkflowRowsCore({
      REQUIRED_AI_RESOLVER_INTENT_KEYS,
      getGoogleClients,
      loadTaskRoutesRegistry,
      loadWorkflowRegistry
    });
  }

  async function loadSiteRuntimeInventoryRegistry(s) { return loadSiteRuntimeInventoryRegistryCore(s); }
  async function loadSiteSettingsInventoryRegistry(s) { return loadSiteSettingsInventoryRegistryCore(s); }
  async function loadPluginInventoryRegistry(s) { return loadPluginInventoryRegistryCore(s); }

  async function loadTaskRoutesRegistry(sheets, options = {}) {
    return loadTaskRoutesRegistryCore(sheets, options, {
      REGISTRY_SPREADSHEET_ID,
      TASK_ROUTES_CANONICAL_COLUMNS,
      TASK_ROUTES_SHEET,
      assertHeaderMatchesSurfaceMetadata,
      assertSingleActiveRowByKey,
      fetchChunkedTable,
      fetchRange,
      getCanonicalSurfaceMetadata,
      getCell,
      governedAdditionStateBlocksAuthority,
      hasDeferredGovernedActivationDependencies,
      headerMap,
      normalizeGovernedAdditionState,
      readLiveSheetShape,
      registryError,
      toValuesApiRange
    });
  }

  async function loadWorkflowRegistry(sheets, options = {}) {
    return loadWorkflowRegistryCore(sheets, options, {
      REGISTRY_SPREADSHEET_ID,
      WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      WORKFLOW_REGISTRY_SHEET,
      assertHeaderMatchesSurfaceMetadata,
      assertSingleActiveRowByKey,
      fetchChunkedTable,
      fetchRange,
      getCanonicalSurfaceMetadata,
      getCell,
      governedAdditionStateBlocksAuthority,
      hasDeferredGovernedActivationDependencies,
      headerMap,
      normalizeGovernedAdditionState,
      readLiveSheetShape,
      registryError,
      toValuesApiRange
    });
  }

  async function readGovernedSheetRecords(sheetName, spreadsheetId = REGISTRY_SPREADSHEET_ID) {
    const dsMode = (process.env.DATA_SOURCE || "sheets").toLowerCase();
    if (dsMode !== "sheets") {
      try {
        const rows = await sqlAdapter.readTable(sheetName);
        if (rows.length > 0) {
          const header = rows.length > 0 ? Object.keys(rows[0]) : [];
          return { header, rows, map: headerMap(header, sheetName) };
        }
      } catch (err) {
        console.warn(`[dataSource] SQL read "${sheetName}" failed, falling back to Sheets: ${err.message}`);
      }
    }
    return readGovernedSheetRecordsCore(sheetName, spreadsheetId, {
      REGISTRY_SPREADSHEET_ID,
      assertSheetExistsInSpreadsheet,
      createHttpError,
      getGoogleClientsForSpreadsheet,
      headerMap,
      toValuesApiRange
    });
  }

  function normalizeLooseHostname(value = "") {
    return normalizeLooseHostnameCore(value);
  }

  function findRegistryRecordByIdentity(rows = [], identity = {}) {
    return findRegistryRecordByIdentityCore(rows, identity);
  }

  async function resolveBrandRegistryBinding(identity = {}) {
    return resolveBrandRegistryBindingCore(identity, {
      BRAND_REGISTRY_SHEET,
      REGISTRY_SPREADSHEET_ID,
      createHttpError,
      firstPopulated,
      assertSheetExistsInSpreadsheet,
      getGoogleClientsForSpreadsheet,
      headerMap,
      toValuesApiRange
    });
  }

  async function hostingerSshRuntimeRead({ input = {} }) {
    return hostingerSshRuntimeReadCore(
      { input },
      {
        REGISTRY_SPREADSHEET_ID,
        HOSTING_ACCOUNT_REGISTRY_RANGE,
        HOSTING_ACCOUNT_REGISTRY_SHEET,
        asBool,
        getGoogleClientsForSpreadsheet,
        matchesHostingerSshTarget,
        rowToObject
      }
    );
  }

  return {
    getSpreadsheetSheetMap,
    ensureSheetWithHeader,
    appendRowsIfMissingByKeys,
    ensureSiteMigrationRegistrySurfaces,
    ensureSiteMigrationRouteWorkflowRows,
    ensureAiResolverRouteWorkflowRows,
    loadSiteRuntimeInventoryRegistry,
    loadSiteSettingsInventoryRegistry,
    loadPluginInventoryRegistry,
    loadTaskRoutesRegistry,
    loadWorkflowRegistry,
    readGovernedSheetRecords,
    normalizeLooseHostname,
    findRegistryRecordByIdentity,
    resolveBrandRegistryBinding,
    hostingerSshRuntimeRead
  };
}
