# Business Type and Brand Path Routing

## Routed Intents
Route these requests to governed path resolution:

- add a new business type
- create business type knowledge
- add a brand under a business type
- create brand core under a business type
- validate business type paths
- validate brand paths
- migrate legacy business type or brand folders

## Routing Constraints
Business Type addition routes must resolve the canonical Business Type Assets root before creating folders.

Brand addition routes must resolve the Business Type before creating a brand folder.

The router must not route brand-folder creation to a generic Drive write when `business_type_key` is unresolved.

## Degraded States
Use:

- `blocked_missing_business_type_resolution`
- `blocked_missing_business_type_folder`
- `blocked_orphan_brand_folder_risk`
- `validating_missing_json_storage_map`
- `validating_missing_graph_bindings`

## Successful State
Use `ready` only when Drive, profile, graph, validation, and JSON map evidence are present.
