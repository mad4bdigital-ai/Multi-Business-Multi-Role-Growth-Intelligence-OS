# Governed Context Resolution — Logic / Business Activity / Brand

## Required runtime order

Every HTTP client execution that may touch a brand, business activity, or functional Logic must resolve context in this order:

1. Business Activity Type Registry
2. Brand Registry and Brand Core surfaces
3. Logic Canonical Pointer Registry
4. Logic Knowledge Profiles
5. Task Routes
6. Workflow Registry
7. Actions Registry and API Actions Endpoint Registry

## Business activity rule

If a request declares `business_activity_type_key`, `business_activity_type`, `activity_type_key`, or equivalent structured context, the runtime treats it as governed context. Business activity resolution must precede business-type knowledge, brand specialization, workflow selection, and engine compatibility interpretation.

## Brand rule

Brand-targeted execution must resolve through Brand Registry before execution. Target-resolved endpoints, WordPress endpoints, and endpoints with `brand_resolution_source` require resolved brand context. Brand Core remains required for brand outputs and live brand operations.

## Logic rule

Functional Logic resolution is pointer-first. Legacy external Logic identifiers are lineage evidence only and must not become runtime authority. Requests using legacy Logic identifiers must be blocked unless explicitly marked as lineage lookup only.

## Runtime outcome

The HTTP client backend must emit a governed context snapshot containing business activity, brand, Logic, action/endpoint, resolution order, and gates. This snapshot is evidence; it does not bypass existing endpoint, workflow, mutation, approval, or readback gates.
