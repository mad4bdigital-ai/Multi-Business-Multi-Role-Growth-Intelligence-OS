# Context Resolver Layer Direct Patch

## Resolver-First Enforcement
Before any write, content generation, or strategy operation, call a resolver.

Do not read sheet rows inline to determine:
- which knowledge profile to use
- which Drive folder to target
- whether a brand is ready for content writing
- which surface is authoritative

Call the appropriate resolver instead.

## Resolver Precedence
1. `resolveContext` for full context (business type + brand + brand core)
2. `resolveKnowledgeProfile` for business type context without brand
3. `resolveRegistrySurface` to validate a surface before reading or writing it
4. `resolveBusinessActivity` to confirm activity type before selecting engines or profiles
5. `resolveBrandCore` to confirm brand readiness before writing brand-targeted content

## Blocked Context Handling
If `resolveContext` returns `validation_state: blocked`:
- Do not proceed with the operation
- Surface `blocked_reason` to the operator log
- Do not attempt to recover by reading rows directly

If `resolveContext` returns `validation_state: validating`:
- Proceed only for read operations
- Block write operations until `validation_state` is `ready`

## Resolver Output Is the Source of Truth
Do not override resolver output with inline row lookups.
Do not merge resolver output with separately read rows unless the resolver explicitly does not cover the needed field.
