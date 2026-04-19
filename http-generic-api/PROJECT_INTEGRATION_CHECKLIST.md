# Project Integration Checklist
**Governance document — updated after each Sprint**  
Last updated: 2026-04-19

---

## Closure Criteria (Project is complete when ALL items are ✓)

### Module Integrity
- [ ] All phases A–P exist as independent modules in `wordpress/`
- [x] phaseA–phaseK: modules exist and pass `node --check`
- [ ] phaseL–phaseP: modules exist and pass `node --check`
- [ ] K.9 `buildWordpressPhaseKFinalOperatorHandoffBundle` added
- [ ] execution.js truncated function repaired
- [ ] governed.js export issue repaired
- [ ] registry.js truncated function repaired

### Export Integrity
- [x] phaseH: 33 exports
- [x] phaseI: 36 exports
- [x] phaseJ: 36 exports
- [x] phaseK: 35 exports (missing K.9)
- [ ] phaseL: TBD
- [ ] phaseM: TBD
- [ ] phaseN: TBD
- [ ] phaseO: TBD
- [ ] phaseP: TBD
- [ ] wordpress/index.js barrel re-export created

### Runtime Wiring
- [x] phaseH wired in runWordpressConnectorMigration (H.1–H.9)
- [x] phaseI wired in runWordpressConnectorMigration (I.1–I.9)
- [x] phaseJ wired in runWordpressConnectorMigration (J.1–J.9)
- [x] phaseK wired in runWordpressConnectorMigration (K.1–K.8)
- [ ] phaseK K.9 wired
- [ ] phaseL–P wired
- [ ] server.js imports from wordpress/ modules (not monolith)
- [ ] Cross-import validation passed

### Deduplication
- [ ] No duplicate phase functions between server.js and wordpress/*.js
- [ ] Dedup report: remaining_duplicates = 0

### Evidence & Handoff
- [x] phaseH: dry_run_execution_artifact + final_operator_handoff_bundle in writeback
- [x] phaseI: all I evidence fields in all 3 writeback blocks
- [x] phaseJ: all J evidence fields in all 3 writeback blocks
- [x] phaseK: all K evidence fields in all 3 writeback blocks
- [ ] phaseK K.9 handoff evidence added
- [ ] phaseL–P: evidence schema defined and wired

### Phase Contract Compliance
- [x] Each phase (H–K) has: resolvePlan, assertPlan, buildGate, runInventory, buildNormalizedInventory, buildReadinessGate, buildSafeCandidates, buildReconciliationPayloadPlanner, resolveExecutionPlan, buildExecutionGuard, buildMutationCandidateSelector, buildMutationPayloadComposer, buildDryRunExecutionSimulator, buildFinalOperatorHandoffBundle
- [ ] Same contract verified for L–P

### Project-Wide Validation
- [ ] All .js files pass `node --check`
- [ ] All cross-imports resolve (no undefined references)
- [ ] runtime wiring coverage scan passed
- [ ] duplicate symbol scan passed

### Archive
- [ ] Sprint 1 snapshot ZIP created
- [ ] Sprint 2+ snapshots created after each phase
- [ ] Release checklist completed

---

## Current Blockers

| Blocker | Priority | Owner |
|---------|----------|-------|
| K.9 diff not available | High | Need to request K.9 patch |
| server.js monolith not replaced | Medium | Sprint 3+ |
| execution.js / governed.js / registry.js broken | Medium | Sprint 2 |
| wordpress/index.js not created | Medium | Sprint 2 |
| phaseL not built | Low | Sprint 2 |
