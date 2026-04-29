# Prompt Router — Governed Context Resolution

The router must not route brand, business activity, or Logic work from raw text alone.

## Routing constraints

- Business activity context must be resolved before business-type knowledge and engine compatibility.
- Brand-targeted work must resolve Brand Registry and Brand Core requirements before brand-specific output or operations.
- Functional Logic must resolve through current canonical pointers, not legacy external identifiers.
- Legacy Logic references may be used for lineage lookup only.

## Handoff behavior

If context is incomplete, route to a preflight/readiness path instead of execution. If a request attempts direct execution with a legacy Logic identifier, block and request current Logic pointer resolution.
