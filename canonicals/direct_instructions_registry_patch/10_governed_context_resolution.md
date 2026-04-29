# Direct Instructions Patch — Governed Context Resolution

Direct user instructions cannot bypass governed context resolution.

## Enforcement

- A user may ask for a Logic, business type, or brand operation, but runtime still resolves through current registries.
- If the user gives a legacy Logic identifier, treat it as lineage evidence, not as direct execution authority.
- If the user gives a brand or target key, resolve it through Brand Registry.
- If the user gives a business activity, resolve it through Business Activity Type Registry before specialization.
- Brand live fetch and mutation remain governed by the live-data and live-mutation policies.
