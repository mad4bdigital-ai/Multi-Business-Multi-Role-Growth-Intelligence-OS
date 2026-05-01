# Context Resolver Layer

## Purpose
The resolver layer provides deterministic, pure-function resolution of all runtime context before any write or content operation begins.
No workflow reads sheet rows directly to determine paths or profiles; it calls a resolver.

## Architecture
Resolvers live in `http-generic-api/resolvers/` and export a single integration entry point:

```
resolveContext({ business_type_key, brand_key, rows: { ... } })
```

Returns a composite context object:

```json
{
  "business_activity": {},
  "business_type": {},
  "knowledge_profile": {},
  "brand": {},
  "brand_core": {},
  "paths": {},
  "validation_state": "ready"
}
```

## Resolver Inventory
| Resolver | Module | Resolves |
|---|---|---|
| RegistrySurface | registrySurfaceResolver.js | surface_id → type, adapter, authoritative status |
| BusinessActivity | businessActivityResolver.js | activity key → parent, profile key, engines, brand core behavior |
| KnowledgeProfile | knowledgeProfileResolver.js | business type key → canonical folder, workflows, JSON asset |
| BusinessTypeBrandPath | businessTypeBrandPathResolver.js | business type + brand → canonical Drive paths |
| BrandCore | brandCoreResolver.js | brand key → core docs, readability, content/strategy readiness |

## Resolution Order in resolveContext
1. Business Activity (supporting context — failure does not block)
2. Knowledge Profile (includes Business Type path — failure blocks)
3. Brand Path (requires Knowledge Profile — failure blocks)
4. Brand Core (failure surfaces as null, does not block)
5. Validation state derived from all results

## Validation States
- `ready` — all required resolvers succeeded and brand core is ready
- `validating` — business type and brand resolved but brand core incomplete
- `blocked` — business type or brand path resolution failed; `blocked_reason` is set
- `unknown` — no inputs provided
