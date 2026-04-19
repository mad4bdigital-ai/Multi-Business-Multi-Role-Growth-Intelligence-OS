// Removes duplicate wordpress function definitions from server.js
// and adds a single import from ./wordpress/index.js
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const serverPath = resolve("server.js");
const raw = readFileSync(serverPath, "utf8");
const lines = raw.split("\n");

// All 335 function names that are now in wordpress/ modules
const toRemove = new Set([
  "applyDeferredWordpressFeaturedMediaLinks","applyDeferredWordpressParentLinks",
  "applyDeferredWordpressTaxonomyLinks","assertWordpressGovernedResolutionConfidence",
  "assertWordpressPhaseAScope","assertWordpressPhaseBPlan","assertWordpressPhaseCPlan",
  "assertWordpressPhaseDPlan","assertWordpressPhaseEPlan","assertWordpressPhaseFPlan",
  "assertWordpressPhaseGPlan","assertWordpressPhaseHPlan","buildDeferredWordpressReferencePlan",
  "buildGovernedResolutionRecord","buildRegistryDeltaWritebackPlan","buildSiteMigrationArtifacts",
  "buildWordpressAuthSurfaceMutationPayloadFromCandidate","buildWordpressAuthSurfaceReconciliationPayloadRow",
  "buildWordpressAuthSurfaceRows","buildWordpressBuilderAuditRow","buildWordpressBuilderDependencyEdges",
  "buildWordpressBuilderDryRunPayloadRow","buildWordpressBuilderFamilyMappingTemplate",
  "buildWordpressBuilderFamilyMetaPreservationPlan","buildWordpressBuilderMutationPayloadFromResolvedRow",
  "buildWordpressBuilderNodeKey","buildWordpressBuilderPhaseBGate","buildWordpressBuilderReferenceIndex",
  "buildWordpressConsentMutationPayloadFromCandidate","buildWordpressConsentReconciliationPayloadRow",
  "buildWordpressConsentRows","buildWordpressFormMutationPayloadFromCandidate",
  "buildWordpressFormSafeMigrationPayloadRow","buildWordpressGeneratedCandidateEvidence",
  "buildWordpressMediaMutationPayloadFromCandidate","buildWordpressMediaSafeMigrationPayloadRow",
  "buildWordpressMetadataMutationPayloadFromCandidate","buildWordpressMetadataReconciliationPayloadRow",
  "buildWordpressMutationPlan","buildWordpressPhaseACheckpoint","buildWordpressPhaseACutoverJournal",
  "buildWordpressPhaseAExecutionOrder","buildWordpressPhaseAFinalOperatorHandoffBundle",
  "buildWordpressPhaseAOperatorArtifact","buildWordpressPhaseAPerTypeSummary",
  "buildWordpressPhaseBDependencySummary","buildWordpressPhaseBDryRunArtifact",
  "buildWordpressPhaseBDryRunExecutionArtifact","buildWordpressPhaseBDryRunExecutionSimulator",
  "buildWordpressPhaseBDryRunMigrationPayloadPlanner","buildWordpressPhaseBExecutionGuard",
  "buildWordpressPhaseBExecutionGuardArtifact","buildWordpressPhaseBFamilySummary",
  "buildWordpressPhaseBFieldMappingArtifact","buildWordpressPhaseBFieldMappingResolver",
  "buildWordpressPhaseBFinalOperatorHandoffBundle","buildWordpressPhaseBMappingPlanArtifact",
  "buildWordpressPhaseBMappingPlanSkeleton","buildWordpressPhaseBMappingPrerequisiteArtifact",
  "buildWordpressPhaseBMappingPrerequisiteGate","buildWordpressPhaseBMigrationBuckets",
  "buildWordpressPhaseBMigrationPlanningCandidates","buildWordpressPhaseBMutationCandidateArtifact",
  "buildWordpressPhaseBMutationCandidateSelector","buildWordpressPhaseBMutationPayloadArtifact",
  "buildWordpressPhaseBMutationPayloadComposer","buildWordpressPhaseBNormalizedAudit",
  "buildWordpressPhaseBPlanningArtifact","buildWordpressPhaseBReadinessArtifact",
  "buildWordpressPhaseBSequenceArtifact","buildWordpressPhaseBSequencePlanner",
  "buildWordpressPhaseCDiffArtifact","buildWordpressPhaseCDryRunExecutionArtifact",
  "buildWordpressPhaseCDryRunExecutionSimulator","buildWordpressPhaseCExecutionGuard",
  "buildWordpressPhaseCExecutionGuardArtifact","buildWordpressPhaseCFinalOperatorHandoffBundle",
  "buildWordpressPhaseCGate","buildWordpressPhaseCInventoryArtifact",
  "buildWordpressPhaseCMutationCandidateArtifact","buildWordpressPhaseCMutationCandidateSelector",
  "buildWordpressPhaseCMutationPayloadArtifact","buildWordpressPhaseCMutationPayloadComposer",
  "buildWordpressPhaseCNormalizedDiff","buildWordpressPhaseCReadinessArtifact",
  "buildWordpressPhaseCReconciliationPayloadArtifact","buildWordpressPhaseCReconciliationPayloadPlanner",
  "buildWordpressPhaseCReconciliationReadiness","buildWordpressPhaseCSafeApplyCandidates",
  "buildWordpressPhaseDDryRunExecutionArtifact","buildWordpressPhaseDDryRunExecutionSimulator",
  "buildWordpressPhaseDExecutionGuard","buildWordpressPhaseDExecutionGuardArtifact",
  "buildWordpressPhaseDFinalOperatorHandoffBundle","buildWordpressPhaseDGate",
  "buildWordpressPhaseDInventoryArtifact","buildWordpressPhaseDMigrationPayloadArtifact",
  "buildWordpressPhaseDMigrationPayloadPlanner","buildWordpressPhaseDMutationCandidateArtifact",
  "buildWordpressPhaseDMutationCandidateSelector","buildWordpressPhaseDMutationPayloadArtifact",
  "buildWordpressPhaseDMutationPayloadComposer","buildWordpressPhaseDNormalizedInventory",
  "buildWordpressPhaseDNormalizedInventoryArtifact","buildWordpressPhaseDReadinessArtifact",
  "buildWordpressPhaseDReadinessGate","buildWordpressPhaseDSafeCandidates",
  "buildWordpressPhaseEDryRunExecutionArtifact","buildWordpressPhaseEDryRunExecutionSimulator",
  "buildWordpressPhaseEExecutionGuard","buildWordpressPhaseEExecutionGuardArtifact",
  "buildWordpressPhaseEFinalOperatorHandoffBundle","buildWordpressPhaseEGate",
  "buildWordpressPhaseEInventoryArtifact","buildWordpressPhaseEMigrationPayloadArtifact",
  "buildWordpressPhaseEMigrationPayloadPlanner","buildWordpressPhaseEMutationCandidateArtifact",
  "buildWordpressPhaseEMutationCandidateSelector","buildWordpressPhaseEMutationPayloadArtifact",
  "buildWordpressPhaseEMutationPayloadComposer","buildWordpressPhaseENormalizedInventory",
  "buildWordpressPhaseENormalizedInventoryArtifact","buildWordpressPhaseEReadinessArtifact",
  "buildWordpressPhaseEReadinessGate","buildWordpressPhaseESafeCandidates",
  "buildWordpressPhaseFDryRunExecutionArtifact","buildWordpressPhaseFDryRunExecutionSimulator",
  "buildWordpressPhaseFExecutionGuard","buildWordpressPhaseFExecutionGuardArtifact",
  "buildWordpressPhaseFFinalOperatorHandoffBundle","buildWordpressPhaseFGate",
  "buildWordpressPhaseFInventoryArtifact","buildWordpressPhaseFMutationCandidateArtifact",
  "buildWordpressPhaseFMutationCandidateSelector","buildWordpressPhaseFMutationPayloadArtifact",
  "buildWordpressPhaseFMutationPayloadComposer","buildWordpressPhaseFNormalizedInventory",
  "buildWordpressPhaseFNormalizedInventoryArtifact","buildWordpressPhaseFReadinessArtifact",
  "buildWordpressPhaseFReadinessGate","buildWordpressPhaseFReconciliationPayloadArtifact",
  "buildWordpressPhaseFReconciliationPayloadPlanner","buildWordpressPhaseFSafeCandidates",
  "buildWordpressPhaseGDryRunExecutionArtifact","buildWordpressPhaseGDryRunExecutionSimulator",
  "buildWordpressPhaseGExecutionGuard","buildWordpressPhaseGExecutionGuardArtifact",
  "buildWordpressPhaseGFinalOperatorHandoffBundle","buildWordpressPhaseGGate",
  "buildWordpressPhaseGInventoryArtifact","buildWordpressPhaseGMutationCandidateArtifact",
  "buildWordpressPhaseGMutationCandidateSelector","buildWordpressPhaseGMutationPayloadArtifact",
  "buildWordpressPhaseGMutationPayloadComposer","buildWordpressPhaseGNormalizedInventory",
  "buildWordpressPhaseGNormalizedInventoryArtifact","buildWordpressPhaseGReadinessArtifact",
  "buildWordpressPhaseGReadinessGate","buildWordpressPhaseGReconciliationPayloadArtifact",
  "buildWordpressPhaseGReconciliationPayloadPlanner","buildWordpressPhaseGSafeCandidates",
  "buildWordpressPhaseHExecutionGuard","buildWordpressPhaseHExecutionGuardArtifact",
  "buildWordpressPhaseHGate","buildWordpressPhaseHInventoryArtifact",
  "buildWordpressPhaseHMutationCandidateArtifact","buildWordpressPhaseHMutationCandidateSelector",
  "buildWordpressPhaseHMutationPayloadArtifact","buildWordpressPhaseHMutationPayloadComposer",
  "buildWordpressPhaseHNormalizedInventory","buildWordpressPhaseHNormalizedInventoryArtifact",
  "buildWordpressPhaseHReadinessArtifact","buildWordpressPhaseHReadinessGate",
  "buildWordpressPhaseHReconciliationPayloadArtifact","buildWordpressPhaseHReconciliationPayloadPlanner",
  "buildWordpressPhaseHSafeCandidates","buildWordpressPhaseIReadinessArtifact",
  "buildWordpressPhaseIReadinessGate","buildWordpressPhaseISafeCandidates",
  "buildWordpressPostTypeSeoRows","buildWordpressRedirectMutationPayloadFromCandidate",
  "buildWordpressRedirectReconciliationPayloadRow","buildWordpressRedirectRows",
  "buildWordpressRestUrl","buildWordpressRetryDelayMs","buildWordpressRoleInventoryRows",
  "buildWordpressRoleMutationPayloadFromCandidate","buildWordpressRoleReconciliationPayloadRow",
  "buildWordpressSelectivePublishCandidates","buildWordpressSelectivePublishRollbackPlan",
  "buildWordpressSeoMetadataRows","buildWordpressSettingMutationPayloadFromCandidate",
  "buildWordpressSettingReconciliationPayloadRow","buildWordpressTaxonomySeoRows",
  "buildWordpressTrackingMutationPayloadFromCandidate","buildWordpressTrackingReconciliationPayloadRow",
  "buildWordpressTrackingRows","buildWordpressUserMutationPayloadFromCandidate",
  "buildWordpressUserReconciliationPayloadRow","classifyWordpressAuthSurfaceRisk",
  "classifyWordpressBuilderAssetFamily","classifyWordpressBuilderDependencyRisk",
  "classifyWordpressBuilderMigrationBucket","classifyWordpressCapabilityState",
  "classifyWordpressConsentRisk","classifyWordpressExecutionStage",
  "classifyWordpressFormInventoryRow","classifyWordpressFormMigrationStrategy",
  "classifyWordpressMediaInventoryRow","classifyWordpressMediaMigrationStrategy",
  "classifyWordpressMetadataRisk","classifyWordpressMigrationImpact",
  "classifyWordpressPhaseAFinalCutoverRecommendation","classifyWordpressPhaseAOutcome",
  "classifyWordpressPhaseAScope","classifyWordpressRedirectRisk",
  "classifyWordpressRolePrivilegeRisk","classifyWordpressSettingReconciliationBucket",
  "classifyWordpressSettingReconciliationRow","classifyWordpressTrackingRisk",
  "classifyWordpressUserPrivilegeRisk","collectWordpressSiteSettingsInventory",
  "computeWordpressBuilderSequenceWeight","ensureWordpressPhaseAState",
  "evaluateWordpressBuilderCompatibilityForRow","evaluateWordpressPhaseAPromotionReadiness",
  "evaluateWordpressPhaseAStartReadiness","evaluateWordpressPhaseBGraphStability",
  "executeSiteMigrationJob","executeWordpressRestJsonRequest",
  "executeWordpressSelectivePublish","executeWordpressSelectivePublishRollback",
  "extractWordpressBuilderCompatibilitySignals","extractWordpressBuilderCrossReferences",
  "extractWordpressCollectionSlugsFromRuntime","extractWordpressInlineMediaRefs",
  "extractWordpressSourceReferenceMap","filterWordpressSelectivePublishCandidates",
  "filterWordpressSelectivePublishRollbackCandidates","findWordpressDestinationEntryBySlug",
  "firstPopulated","getWordpressCollectionResolverCache","getWordpressItemById",
  "getWordpressSiteAuth","inferWordpressAnalyticsPluginSignals","inferWordpressBuilderDependencies",
  "inferWordpressFormIntegrationSignals","inferWordpressSeoPluginSignals",
  "isTransientWordpressRetryableError","isWordpressHierarchicalType",
  "isWordpressPhaseBBuilderType","isWordpressPhaseDFormType","isWordpressPublishablePhaseAType",
  "listDifference","listIntersection","listWordpressEntriesByType",
  "mapWordpressSourceEntryToMutationPayload","normalizeSiteMigrationPayload",
  "normalizeWordpressAuthValue","normalizeWordpressBuilderDependencyFlags",
  "normalizeWordpressBuilderType","normalizeWordpressCollectionSlug",
  "normalizeWordpressFormType","normalizeWordpressMediaMimeClass",
  "normalizeWordpressPhaseAType","normalizeWordpressRestRoot",
  "normalizeWordpressSeoTextValue","normalizeWordpressSettingValueForDiff",
  "normalizeWordpressSettingsInventoryRecord","normalizeWordpressTrackingTextValue",
  "normalizeWordpressUserInventoryRow","pickWordpressCollectionSlugFromTypeRecord",
  "probeWordpressCollectionSlug","publishWordpressDestinationEntryById",
  "recordWordpressMutationWritebackEvidence","rememberWordpressDestinationReference",
  "resolveDeferredWordpressParentId","resolveDeferredWordpressTaxonomyIds",
  "resolveHostingAccountBinding","resolveMigrationTransport",
  "resolveWordpressBuilderFieldMappingRow","resolveWordpressCollectionSlug",
  "resolveWordpressCollectionSlugFromTypesEndpoint","resolveWordpressPhaseABatchPolicy",
  "resolveWordpressPhaseAResumePolicy","resolveWordpressPhaseARetryPolicy",
  "resolveWordpressPhaseBExecutionPlan","resolveWordpressPhaseBPlan",
  "resolveWordpressPhaseCExecutionPlan","resolveWordpressPhaseCPlan",
  "resolveWordpressPhaseDExecutionPlan","resolveWordpressPhaseDPlan",
  "resolveWordpressPhaseEExecutionPlan","resolveWordpressPhaseEPlan",
  "resolveWordpressPhaseFExecutionPlan","resolveWordpressPhaseFPlan",
  "resolveWordpressPhaseGExecutionPlan","resolveWordpressPhaseGPlan",
  "resolveWordpressPhaseHExecutionPlan","resolveWordpressPhaseHPlan",
  "resolveWordpressPluginInventory","resolveWordpressRuntimeInventory",
  "resolveWordpressSelectivePublishPlan","resolveWordpressSelectivePublishRollbackPlan",
  "resolveWordpressSettingsInventory","resolveWordpressSiteAwarenessContext",
  "rollbackWordpressPublishedEntryById","runHybridWordpressMigration",
  "runSshWpCliMigration","runWithWordpressSelectiveRetry",
  "runWordpressAnalyticsTrackingInventory","runWordpressConnectorMigration",
  "runWordpressFormsIntegrationsInventory","runWordpressMediaInventory",
  "runWordpressSeoInventory","runWordpressUsersRolesAuthInventory",
  "shouldSkipWordpressPhaseAPostType","simulateWordpressBuilderDryRunResult",
  "simulateWordpressFormDryRunResult","simulateWordpressMediaDryRunResult",
  "simulateWordpressSeoDryRunRow","simulateWordpressSettingDryRunResult",
  "simulateWordpressUsersRolesAuthDryRunRow","summarizeWordpressBuilderCrossReferences",
  "summarizeWordpressBuilderDependencyGraph","summarizeWordpressPhaseAFailures",
  "trimBatchForResume","updateWordpressDestinationEntryById",
  "validateSiteMigrationPayload","validateSiteMigrationRouteWorkflowReadiness",
  "verifyDeferredWordpressParentRepairs","verifyDeferredWordpressTaxonomyRepairs",
  "verifyRegistryDeltaReadback","verifyWordpressPublishedEntry","wordpressRichTextToString"
]);

function stripStrings(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, "``")
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''")
    .replace(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, "/!/");
}

// Find and remove each function block
let removed = 0;
const removeRanges = []; // [{start, end}] line indices (0-based)

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^(async function|function) ([A-Za-z_$][A-Za-z0-9_$]*)\s*[\s(<]/);
  if (!m) continue;
  const name = m[2];
  if (!toRemove.has(name)) continue;

  // Find the opening brace — may be on same line or next
  let braceDepth = 0;
  let bodyStarted = false;
  let parenDepth = 0;
  let paramsClosed = false;
  let endLine = i;

  for (let j = i; j < lines.length; j++) {
    const s = stripStrings(lines[j]);
    for (const ch of s) {
      if (!paramsClosed) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") { parenDepth--; if (parenDepth <= 0) paramsClosed = true; }
      } else {
        if (ch === "{") { braceDepth++; bodyStarted = true; }
        else if (ch === "}") braceDepth--;
      }
    }
    if (bodyStarted && braceDepth <= 0) { endLine = j; break; }
  }

  // Include one blank line after the closing brace if present
  if (endLine + 1 < lines.length && lines[endLine + 1].trim() === "") {
    endLine++;
  }

  removeRanges.push({ start: i, end: endLine });
  removed++;
  i = endLine; // skip to after this function
}

console.log(`Found ${removed} functions to remove`);

// Sort ranges in reverse order to safely splice
removeRanges.sort((a, b) => b.start - a.start);

const resultLines = [...lines];
for (const { start, end } of removeRanges) {
  resultLines.splice(start, end - start + 1);
}

// Add import at top (after the last existing import block)
const importLine = `import {\n${[...toRemove].sort().map(f => `  ${f}`).join(",\n")}\n} from "./wordpress/index.js";\n`;

// Find last import line index
let lastImportIdx = 0;
for (let i = 0; i < resultLines.length; i++) {
  if (resultLines[i].startsWith("import ")) lastImportIdx = i;
}
// Find end of that import block
let insertAt = lastImportIdx;
while (insertAt < resultLines.length && !resultLines[insertAt].includes("} from ")) insertAt++;
insertAt++; // after the closing line

resultLines.splice(insertAt, 0, "", importLine);

const output = resultLines.join("\n");
writeFileSync(serverPath, output, "utf8");
console.log(`Done. server.js rewritten. Lines: ${lines.length} → ${resultLines.length}`);
