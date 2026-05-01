# Business Type and Brand Path Loader Dependencies

## Required Loader Inputs
Business Type and Brand path workflows must load:

- activity type registry rows
- business type profile rows
- surface catalog rows
- JSON storage maps
- graph nodes and relationships
- validation states

## Resolver Loading Order
Load in this order:

1. Business Activity Type Registry
2. Business Type Knowledge Profiles
3. JSON Asset Registry storage maps
4. Registry Surfaces Catalog
5. Knowledge Graph Node Registry
6. Relationship Graph Registry
7. Validation & Repair Registry

## Dependency Failure Handling
If the Business Type cannot be resolved, block brand creation.

If the Business Type folder cannot be resolved, do not create an orphaned brand folder.

If the JSON storage map is missing but registry surfaces are available, classify as `validating` and emit a JSON map repair requirement.

If both JSON map and surface rows are missing, classify as `blocked_missing_path_resolver`.

## Completion Readiness
The loader may only mark a Business Type or Brand path ready when folder IDs, registry rows, graph bindings, validation state, and JSON map are all present.
