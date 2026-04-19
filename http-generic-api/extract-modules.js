#!/usr/bin/env node
/**
 * extract-modules.js
 *
 * Splits server.js into domain modules.
 * Run once:  node extract-modules.js
 * Safe to re-run — writes only if the target file does not already exist.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const SRC = "./server.js";
const content = readFileSync(SRC, "utf8");
const lines = content.split("\n");

// ─── 1. Parse top-level function boundaries ───────────────────────────────────

function findTopLevelFunctions(lines) {
  const fns = [];
  let depth = 0;
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip constructs that contain braces but shouldn't affect depth:
    // line comments, regex char classes [^}], strings, template literals, ${...}
    const stripped = raw
      .replace(/\/\/.*$/, "")
      .replace(/\[[^\]]*\]/g, "[]")
      .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')
      .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''")
      .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, "``")
      .replace(/\$\{[^}]*\}/g, "");

    if (depth === 0) {
      const m = raw.match(/^(async\s+)?function\s+(\w+)\s*\(/);
      if (m) cur = { name: m[2], start: i, async: !!m[1] };
    }

    for (const ch of stripped) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    if (cur && depth === 0) {
      cur.end = i;
      fns.push({ ...cur });
      cur = null;
    }
  }
  return fns;
}

// ─── 2. Assign functions to modules ──────────────────────────────────────────

function assignModule(name) {
  if (/^(nowIso|sleep|chunkArray|toPositiveInt|jsonParseSafe|boolFromSheet|asBool|rowToObject|toUpper|normalizeMethod|normalizePath|normalizeProviderDomain|safeNormalize|normalizeEndpoint|isVariablePlaceholder|sanitizeCaller|buildUrl|appendQuery|columnLetter|createExecutionTraceId|createHttpError|normalizeStringList|buildRecordFromHeader|buildSheetRowFrom|normalizeStringList|toSheetCellValue|toA1Start|normalizeLooseHostname)/.test(name)) return "utils.js";

  if (/^(fetchGitHub|githubGit)/.test(name)) return "github.js";
  if (/^(hostingerSsh|matchesHostinger)/.test(name)) return "hostinger.js";

  if (/^(getGoogleClients|fetchRange|readLiveSheetShape|getSpreadsheetSheetMap|ensureSheetWithHeader)/.test(name)) return "googleSheets.js";

  if (/^(buildGovernedWrite|appendSheetRowGoverned|updateSheetRowGoverned|deleteSheetRowGoverned|performGovernedSheet|verifyAppendReadback|verifyJsonAsset|computeHeaderSignature|detectUnsafeColumns|buildFullWidthGoverned|buildColumnSliceRow|appendExecutionLog|writeExecutionLog|writeJsonAsset|assertExecutionLog|assertHeaderMatch|assertExpectedColumns|assertCanonical|blockLegacyRoute|assertNoLegacy|assertSingleActive|normalizeGoverned|hasDeferredGoverned|buildGovernedAddition|assertNoDirectActivation|headerMap|getCell|loadLiveGoverned|governedPolicy|readRelevantExisting|normalizeSemanticValue|findSemanticDuplicate|classifyGoverned|resolveGoverned|enforceGoverned)/.test(name)) return "governed.js";

  if (/^(loadBrandRegistry|loadHostingAccount|loadActionsRegistry|loadEndpointRegistry|loadExecutionPolicies|readExecutionPolicy|buildExecutionPolicy|findExecutionPolicy|writeExecutionPolicy|updateExecutionPolicy|deleteExecutionPolicy|readTaskRoutes|buildTaskRoute|findTaskRoute|writeTaskRoute|updateTaskRoute|deleteTaskRoute|readWorkflowRegistry|buildWorkflowRegistry|findWorkflowRegistry|writeWorkflowRegistry|updateWorkflowRegistry|deleteWorkflowRegistry|readRegistrySurfaces|buildRegistrySurface|findRegistrySurface|writeRegistrySurface|updateRegistrySurface|deleteRegistrySurface|readValidationRepair|buildValidationRepair|findValidationRepair|writeValidationRepair|updateValidationRepair|deleteValidationRepair|readActionsRegistry|buildActionsRegistry|findActionsRegistry|writeActionsRegistry|updateActionsRegistry|deleteActionsRegistry|fetchFromGoogleSheets|getRegistry|reloadRegistry|registryError|policyValue|policyList|toValuesApiRange|getRegistrySurface|getCanonicalSurface|buildExpectedHeader|normalizeExpectedColumn|assertGovernedSink)/.test(name)) return "registry.js";

  if (/^(getDefaultGoogleScopes|normalizeGoogleScope|getScopesFromOAuth|validateGoogleOAuth|resolveDelegatedGoogle|mintGoogleAccessToken|requirePolicyTrue|requirePolicySet|getRequiredHttp|buildMissingRequired|resilienceApplies|shouldRetryProvider|buildProviderRetry|buildResolvedAuth|injectAuth|inferAuthMode|normalizeAuthContract|findHostingAccount|resolveAccountKey|resolveSecretFrom|isGoogleApiHost|getAdditionalStatic|enforceSupportedAuth)/.test(name)) return "auth.js";

  if (/^(fetchSchemaContract|fetchOAuthConfigContract|resolveSchemaOperation|validateByJsonSchema|validateParameters|validateRequestBody|classifySchemaDrift|applyPathParams|pathTemplateToRegex|ensureMethodAndPath|executeUpstreamAttempt|resolveBrand|resolveAction|resolveEndpoint|isDelegatedTransport|getEndpointExecution|requireRuntimeCallable|requireEndpointExecution|requireExecutionMode|requireNativeFamily|requireTransportIf|requireNoFallback|getPlaceholder|resolveRuntimeProvider|resolveProviderDomain|isOAuthConfigured|ensureWritePermissions|retryMutation|parseRetryStage|stripRoutingOnly|finalizeTransport|mapExecutionStatus|classifyExecutionResult|buildOutputSummary|isOversizedBody|buildArtifactFileName|toExecutionLogUnifiedRow|createJsonAssetId|toJsonAssetRegistryRow|inferWordpressInventoryAsset|normalizeAssetType|isDerivedJson|isBrandCore|classifyAssetHome|assertJsonAsset|extractJsonAsset|isSchemaMetaOnly|findExistingJsonAsset|normalizeExecutionError|compactError|classifySmokeTest|buildSmokeTestSummary|runWritebackSmokeTest|evaluateWritebackSmoke|assertExecutionLogRowIsSpill|persistOversized|performUniversalServer|logValidationRun|logPartialHarvest|logRetry|normalizeExecution|normalizeTopLevel|validatePayload|validateTopLevel|validateAssetHome|isHttpGenericTransport|isDelegatedHttp|isWordPressAction|promoteDelegated|isHostingerAction|isSiteTarget|isHostingAccount|assertHostingerTarget)/.test(name)) return "execution.js";

  if (/^buildWordpressPhaseA|^resolveWordpressPhaseA|^assertWordpressPhaseA|^evaluateWordpressPhaseA|^buildWordpressGenerated|^classifyWordpressPhaseA|^buildWordpressSelect|^resolveWordpressSelect|^filterWordpressSelect|^publishWordpress|^verifyWordpressPublish|^executeWordpressSelect|^rollback|^verifyRollback|^executeWordpressSelectivePublish|^buildWordpressPhaseACutover|^classifyWordpressPhaseAFinal|^buildWordpressPhaseAFinal|^normalizeWordpressPhaseA|^classifyWordpressPhaseAScope|^assertWordpressPhaseAScope|^buildWordpressPhaseAExecution|^shouldSkipWordpressPhaseA|^trimBatch|^buildWordpressPhaseACheckpoint|^buildWordpressPhaseAPerType|^classifyWordpressPhaseAOutcome|^summarizeWordpressPhaseAFail|^buildWordpressPhaseAOperator|^evaluateWordpressPhaseAPromotion|^isWordpressPublishable|^resolveWordpressPhaseABatch|^resolveWordpressPhaseARetry|^resolveWordpressPhaseAResume|^runWordpressConnectorMigration/.test(name)) return "wordpress/phaseA.js";

  if (/^buildWordpressPhaseB|^resolveWordpressPhaseB|^assertWordpressPhaseB|^isWordpressPhaseBBuilder|^inferWordpressBuilder|^buildWordpressBuilder|^normalizeWordpressBuilder|^classifyWordpressBuilder|^buildWordpressPhaseBDependency|^buildWordpressPhaseBFamily|^buildWordpressPhaseBMigration|^extractWordpressBuilder|^summarizeWordpressBuilder|^buildWordpressBuilderNode|^buildWordpressBuilderRef|^buildWordpressBuilderDep|^summarizeWordpressBuilderDep|^evaluateWordpressPhaseB|^buildWordpressPhaseBReadiness|^buildWordpressPhaseBPlanning|^computeWordpressBuilder|^buildWordpressPhaseBSequence|^extractWordpressBuilderCompat|^evaluateWordpressBuilderCompat|^buildWordpressPhaseBMapping|^buildWordpressBuilderFamily|^buildWordpressPhaseBFieldMapping|^resolveWordpressBuilderField|^buildWordpressPhaseBDryRun|^buildWordpressPhaseBExecution|^buildWordpressPhaseBMutation|^buildWordpressBuilderMutation|^simulateWordpressBuild|^buildWordpressPhaseBFinal/.test(name)) return "wordpress/phaseB.js";

  if (/^buildWordpressPhaseC|^resolveWordpressPhaseC|^assertWordpressPhaseC|^normalizeWordpressSetting|^classifyWordpressSetting|^collectWordpress|^buildWordpressPhaseCInventory|^buildWordpressPhaseCNormalized|^buildWordpressPhaseCDiff|^buildWordpressPhaseCReconciliation|^buildWordpressPhaseCSafe|^buildWordpressPhaseCReadiness|^buildWordpressSettingReconciliation|^buildWordpressPhaseCMutation|^buildWordpressSettingMutation|^simulateWordpressSetting/.test(name)) return "wordpress/phaseC.js";

  if (/^buildWordpressPhaseD|^resolveWordpressPhaseD|^assertWordpressPhaseD|^normalizeWordpressFormType|^isWordpressPhaseDForm|^inferWordpressForm|^classifyWordpressForm|^runWordpressForms|^buildWordpressPhaseDInventory|^buildWordpressPhaseDNormalized|^buildWordpressPhaseDReadiness|^buildWordpressPhaseDSafe|^buildWordpressFormSafe|^buildWordpressPhaseDMigration|^buildWordpressPhaseDExecution|^buildWordpressPhaseDMutation|^buildWordpressFormMutation|^simulateWordpressForm|^buildWordpressPhaseBNormalized|^runSshWpCliMigration|^buildWordpressPhaseDFinal/.test(name)) return "wordpress/phaseD.js";

  if (/^buildWordpressPhaseE|^resolveWordpressPhaseE|^assertWordpressPhaseE|^extractWordpressInline|^classifyWordpressMedia|^runWordpressMedia|^buildWordpressPhaseEInventory|^normalizeWordpressMedia|^buildWordpressPhaseENormalized|^buildWordpressPhaseEReadiness|^buildWordpressPhaseESafe|^buildWordpressMediaSafe|^buildWordpressPhaseEMigration|^buildWordpressPhaseEExecution|^buildWordpressPhaseEMutation|^buildWordpressMediaMutation|^simulateWordpressMedia|^buildWordpressPhaseEFinal/.test(name)) return "wordpress/phaseE.js";

  if (/^buildWordpressPhaseF|^resolveWordpressPhaseF|^assertWordpressPhaseF|^normalizeWordpressUser|^buildWordpressRole|^buildWordpressAuth|^runWordpressUsers|^buildWordpressPhaseFInventory|^normalizeWordpressAuth|^classifyWordpressUser|^classifyWordpressRole|^classifyWordpressAuthSurface|^buildWordpressPhaseFNormalized|^buildWordpressPhaseFReadiness|^buildWordpressPhaseFSafe|^buildWordpressUser|^buildWordpressRoleRec|^buildWordpressAuthSurface|^buildWordpressPhaseFReconciliation|^buildWordpressPhaseFExecution|^buildWordpressPhaseFMutation|^simulateWordpressUsers|^buildWordpressPhaseFDryRun|^buildWordpressPhaseFFinal/.test(name)) return "wordpress/phaseF.js";

  if (/^buildWordpressPhaseG|^resolveWordpressPhaseG|^assertWordpressPhaseG|^inferWordpressSeo|^buildWordpressSeo|^buildWordpressRedirect|^buildWordpressTaxonomy|^buildWordpressPostType|^runWordpressSeo|^buildWordpressPhaseGInventory|^normalizeWordpressSeo|^classifyWordpressRedirect|^classifyWordpressMetadata|^buildWordpressPhaseGNormalized|^buildWordpressPhaseGReadiness|^buildWordpressPhaseGSafe|^buildWordpressRedirectRec|^buildWordpressMetadataRec|^buildWordpressPhaseGReconciliation|^buildWordpressPhaseGExecution|^buildWordpressPhaseGMutation|^buildWordpressRedirectMutation|^buildWordpressMetadataMutation|^simulateWordpressSeo|^buildWordpressPhaseGDryRun|^buildWordpressPhaseGFinal/.test(name)) return "wordpress/phaseG.js";

  if (/^buildWordpressPhaseH|^resolveWordpressPhaseH|^assertWordpressPhaseH|^inferWordpressAnalytics|^buildWordpressTracking|^buildWordpressConsent|^runWordpressAnalytics|^buildWordpressPhaseHInventory|^normalizeWordpressTracking|^classifyWordpressTracking|^classifyWordpressConsent|^buildWordpressPhaseHNormalized|^buildWordpressPhaseHReadiness|^buildWordpressPhaseHSafe|^buildWordpressTrackingRec|^buildWordpressConsentRec|^buildWordpressPhaseHReconciliation|^buildWordpressPhaseHExecution|^buildWordpressPhaseHMutation|^buildWordpressTrackingMutation|^buildWordpressConsentMutation|^simulateWordpressTracking|^simulateWordpressConsent|^buildWordpressPhaseHDryRun/.test(name)) return "wordpress/phaseH.js";

  if (/^buildWordpressPhaseI/.test(name)) return "wordpress/phaseI.js";

  if (/^(isTransientWordpress|buildWordpressRetry|runWithWordpress|isWordpressHierarchical|extractWordpressSource|ensureWordpressPhaseA|rememberWordpress|buildDeferredWordpress|resolveDeferredWordpress|applyDeferredWordpress|verifyDeferredWordpress|runWordpressConnector|runHybridWordpress|validateSiteMigrationRoute|executeSiteMigration|normalizeWordpressRest|buildWordpressRest|getWordpressSiteAuth|wordpressRichText|mapWordpressSource|normalizeWordpressCollection|getWordpressCollection|extractWordpressCollection|pickWordpressCollection|resolveWordpressCollection|probeWordpressCollection|executeWordpressRest|listWordpressEntries|findWordpressDest|updateWordpressDest|getWordpressItem|recordWordpress|classifyWordpressExecution|buildGovernedResolution|assertWordpressGoverned|firstPopulated|normalizeSiteMigration|validateSiteMigration|resolveBrandRegistryBinding|resolveHostingAccount|resolveMigrationTransport|buildWordpressMutation|buildRegistryDelta|verifyRegistryDelta|buildSiteMigrationArtifacts|resolveWordpressRuntime|resolveWordpressSettings|resolveWordpressPlugin|resolveWordpressSiteAwareness|listIntersection|listDifference|classifyWordpressCapability|classifyWordpressMigration)/.test(name)) return "wordpress/shared.js";

  if (/^(ensureSiteMigrationRegistry|ensureSiteMigrationRoute|loadSiteRuntimeInventory|loadSiteSettingsInventory|loadPluginInventory|loadTaskRoutesRegistry|loadWorkflowRegistry|appendRowsIfMissing|findRegistryRecord)/.test(name)) return "registry.js";

  if (/^(normalizeJobId|normalizeJobStatus|normalizeWebhookUrl|normalizeMaxAttempts|nextRetryDelayMs|buildJobId|resolveRequestedBy|makeIdempotency|buildExecutionPayload|validateAsyncJob|nowIso|createExecutionTraceId)/.test(name)) return "utils.js";

  if (/^(toJobSummary|buildWebhookPayload|sendJobWebhook|shouldRetryJob|executeSameService|dispatchEndpoint|executeJobThrough|enqueueJob|scheduleJobRetry|executeSingleQueued|createSiteMigration|executeQueuedJobByType|getJob|updateJob|resolveJob)/.test(name)) return "jobRunner.js";

  if (/^(requireEnv|requireGithubToken|assertNonEmpty|parseBounded|decodeBase64)/.test(name)) return "utils.js";

  if (/^(governedAdditionState|hasDeferredGoverned|buildGovernedAdditionReview|assertNoDirectActivation|normalizeGovernedAddition)/.test(name)) return "governed.js";

  return null; // stays in server.js
}

// ─── 3. Extract functions ─────────────────────────────────────────────────────

const fns = findTopLevelFunctions(lines);
console.log(`Found ${fns.length} top-level functions`);

const modules = {};
const stayInServer = [];

for (const fn of fns) {
  const mod = assignModule(fn.name);
  if (mod) {
    if (!modules[mod]) modules[mod] = [];
    modules[mod].push(fn);
  } else {
    stayInServer.push(fn.name);
  }
}

console.log("\nModule assignments:");
for (const [mod, fns] of Object.entries(modules)) {
  console.log(`  ${mod}: ${fns.length} functions`);
}
console.log(`  server.js (stays): ${stayInServer.length} functions`);

// ─── 4. Build module files ────────────────────────────────────────────────────

const HEADER = `// Auto-extracted from server.js — do not edit manually, use domain logic here.\n`;

const CONFIG_IMPORT = `import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID, BRAND_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET, ENDPOINT_REGISTRY_SHEET, EXECUTION_POLICY_SHEET,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  TASK_ROUTES_SHEET, WORKFLOW_REGISTRY_SHEET, REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET, EXECUTION_LOG_UNIFIED_SHEET,
  JSON_ASSET_REGISTRY_SHEET, BRAND_CORE_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SPREADSHEET_ID, JSON_ASSET_REGISTRY_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID, RAW_BODY_MAX_BYTES, MAX_TIMEOUT_SECONDS,
  SERVICE_VERSION, GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH,
  DEFAULT_JOB_MAX_ATTEMPTS, JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS
} from "../config.js";\n`;

const CONFIG_IMPORT_ROOT = CONFIG_IMPORT.replace(/from "\.\.\/config\.js"/, 'from "./config.js"');

// Minimal per-module extra imports (manually curated)
const MODULE_IMPORTS = {
  "utils.js": `import crypto from "node:crypto";\n`,
  "github.js": `import { GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH } from "./config.js";\n`,
  "hostinger.js": ``,
  "googleSheets.js": `import { google } from "googleapis";\n`,
  "governed.js": `import { google } from "googleapis";\n`,
  "registry.js": `import { google } from "googleapis";\n${CONFIG_IMPORT_ROOT}`,
  "auth.js": `import { google } from "googleapis";\n${CONFIG_IMPORT_ROOT}`,
  "execution.js": `import crypto from "node:crypto";\nimport YAML from "yaml";\nimport { promises as fs } from "fs";\nimport { google } from "googleapis";\n${CONFIG_IMPORT_ROOT}`,
  "jobRunner.js": `import crypto from "node:crypto";\nimport { jobQueue } from "./queue.js";\n`,
  "wordpress/shared.js": `import { google } from "googleapis";\n${CONFIG_IMPORT.replace(/from "\.\.\/config\.js"/, 'from "../config.js"')}`,
  "wordpress/phaseA.js": ``,
  "wordpress/phaseB.js": ``,
  "wordpress/phaseC.js": ``,
  "wordpress/phaseD.js": ``,
  "wordpress/phaseE.js": ``,
  "wordpress/phaseF.js": ``,
  "wordpress/phaseG.js": ``,
  "wordpress/phaseH.js": ``,
  "wordpress/phaseI.js": ``,
};

for (const [mod, fnList] of Object.entries(modules)) {
  const filePath = `./${mod}`;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(filePath)) {
    console.log(`  SKIP (exists): ${filePath}`);
    continue;
  }

  const extraImports = MODULE_IMPORTS[mod] || "";
  const bodies = fnList.map(fn => {
    const fnLines = lines.slice(fn.start, fn.end + 1);
    return "export " + fnLines.join("\n");
  });

  const fileContent = HEADER + extraImports + "\n" + bodies.join("\n\n") + "\n";
  writeFileSync(filePath, fileContent);
  console.log(`  WROTE: ${filePath} (${fnList.length} functions, ${fileContent.length} bytes)`);
}

console.log("\nDone. Run: node --check on each output file to verify syntax.");
