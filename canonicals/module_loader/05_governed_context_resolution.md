# Module Loader — Governed Context Dependencies

Modules that perform HTTP execution must load and pass governed context evidence across runtime boundaries.

## Required context fields

- business_activity context from Business Activity Type Registry declarations
- brand context from Brand Registry / Brand Core
- logic context from Logic Canonical Pointer Registry and Logic Knowledge Profiles
- current route/workflow/action/endpoint evidence
- gates for legacy Logic block, brand-core requirement, business-activity-first rule, and current execution authority

## Non-bypass rule

A module must not treat old Logic rows, business-type assumptions, or brand aliases as execution authority unless current registry resolution validates them.
