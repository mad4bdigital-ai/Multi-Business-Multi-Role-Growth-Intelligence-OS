# Business Type and Brand Path Resolution

## Purpose
Business Type and Brand path resolution is a first-class bootstrap dependency.
The runtime must not infer Drive paths from notes, recent conversation context, or legacy folder names.

## Canonical Resolver Surfaces
The following surfaces are authoritative for path resolution:

- `Business Activity Type Registry`
- `Business Type Knowledge Profiles`
- `Registry Surfaces Catalog`
- `Knowledge Graph Node Registry`
- `Relationship Graph Registry`
- `Validation & Repair Registry`
- `JSON Asset Registry`

Machine-readable path maps in `JSON Asset Registry` are preferred over prose notes.

## Business Type Path Rule
Before adding, reading, or mutating a Business Type knowledge layer, the runtime must resolve:

1. `business_type_key`
2. `knowledge_profile_key`
3. canonical Business Type surface ID
4. Shared Drive ID
5. Business Type Assets root folder ID
6. Business Type folder ID
7. editable Google Docs asset IDs, when present

The canonical storage pattern is:

```text
Growth Intelligence OS - Knowledge Assets / Business Type Assets / [business_type_folder_name]
```

Final authoritative storage must not be GitHub, My Drive, markdown placeholders, or `Knowlege/Business-Type` unless a governed rollback explicitly authorizes it.

## Brand Under Business Type Rule
Before adding, reading, or mutating a brand, the runtime must resolve the Business Type first.

The canonical brand storage pattern is:

```text
Growth Intelligence OS - Knowledge Assets / Business Type Assets / [business_type_folder_name] / brands / [brand_key]
```

If the `brands` folder is missing, it must be created under the resolved Business Type folder before the brand folder is created.

## Completion Gate
A new Business Type is not complete until:

- canonical Drive folder exists
- standard folder structure exists
- required editable Google Docs exist
- Business Activity Type Registry row exists
- Business Type Knowledge Profiles row exists
- Registry Surfaces Catalog row exists
- Knowledge Graph node exists
- Relationship Graph relationships exist
- Validation & Repair row marks it validated
- JSON Asset Registry stores a machine-readable storage map

A new Brand under a Business Type is not complete until:

- Business Type resolution succeeds
- brand folder exists under the resolved Business Type
- editable Brand Core docs exist
- Brand Registry and Brand Core Registry rows exist
- graph and validation records exist
- JSON Asset Registry stores a brand storage/linkage map
