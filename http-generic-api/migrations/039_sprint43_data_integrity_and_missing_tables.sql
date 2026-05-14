-- Sprint 43: Data Integrity & Missing Tables
-- Fixes: registry_surfaces_catalog, validation_repair, brand_paths,
--        business_type_profiles, logic_packs, task_routes workflow_key alignment

-- ── 1. Registry Surfaces Catalog (was in schema.sql but never migrated) ─────────
CREATE TABLE IF NOT EXISTS `registry_surfaces_catalog` (
  `id`                                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `surface_id`                            VARCHAR(255),
  `surface_name`                          VARCHAR(255),
  `worksheet_name`                        VARCHAR(255),
  `worksheet_gid`                         VARCHAR(100),
  `active_status`                         VARCHAR(20),
  `authority_status`                      VARCHAR(100),
  `required_for_execution`               VARCHAR(20),
  `schema_ref`                            VARCHAR(255),
  `schema_version`                        VARCHAR(50),
  `header_signature`                      TEXT,
  `expected_column_count`                 INT,
  `binding_mode`                          VARCHAR(100),
  `sheet_role`                            VARCHAR(100),
  `audit_mode`                            VARCHAR(100),
  `legacy_surface_containment_required`   VARCHAR(20),
  `repair_candidate_types`                TEXT,
  `repair_priority`                       VARCHAR(100),
  `created_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_surface_id` (`surface_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Validation & Repair Registry ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `validation_repair` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `validation_id`       VARCHAR(255),
  `entity_key`          VARCHAR(255),
  `surface_id`          VARCHAR(255),
  `validation_target`   VARCHAR(255),
  `target_surface_id`   VARCHAR(255),
  `validation_type`     VARCHAR(100),
  `validation_status`   VARCHAR(100),
  `repair_action`       VARCHAR(255),
  `repair_status`       VARCHAR(100),
  `priority`            VARCHAR(50),
  `notes`               TEXT,
  `created_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entity_key` (`entity_key`),
  KEY `idx_surface_id` (`surface_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Seed registry_surfaces_catalog with core runtime surfaces ──────────────────
INSERT IGNORE INTO `registry_surfaces_catalog`
  (surface_id, surface_name, worksheet_name, active_status, authority_status,
   required_for_execution, schema_ref, schema_version, binding_mode, sheet_role, audit_mode)
VALUES
  ('surface.brand_registry_sheet','Brand Registry','Brand Registry','active','authoritative','TRUE','row_audit_schema:Brand Registry','v1','gid_based','authority_surface','exact_header_match'),
  ('surface.hosting_account_registry_sheet','Hosting Account Registry','Hosting Account Registry','active','authoritative','TRUE','row_audit_schema:Hosting Account Registry','v1','gid_based','authority_surface','exact_header_match'),
  ('surface.task_routes_sheet','Task Routes','Task Routes','active','authoritative','TRUE','row_audit_schema:Task Routes','v1','gid_based','authority_surface','exact_header_match'),
  ('surface.workflow_registry_sheet','Workflow Registry','Workflow Registry','active','authoritative','TRUE','row_audit_schema:Workflow Registry','v1','gid_based','authority_surface','exact_header_match'),
  ('surface.execution_policy_sheet','Execution Policy Registry','Execution Policy Registry','active','authoritative','TRUE','row_audit_schema:Execution Policy Registry','v1','gid_based','authority_surface','exact_header_match'),
  ('surface.site_runtime_inventory_registry_sheet','Site Runtime Inventory Registry','Site Runtime Inventory Registry','active','authoritative','FALSE','row_audit_schema:Site Runtime Inventory Registry','v1','gid_based','inventory_surface','exact_header_match'),
  ('surface.site_settings_inventory_registry_sheet','Site Settings Inventory Registry','Site Settings Inventory Registry','active','authoritative','FALSE','row_audit_schema:Site Settings Inventory Registry','v1','gid_based','inventory_surface','exact_header_match'),
  ('surface.plugin_inventory_registry_sheet','Plugin Inventory Registry','Plugin Inventory Registry','active','authoritative','FALSE','row_audit_schema:Plugin Inventory Registry','v1','gid_based','inventory_surface','exact_header_match'),
  ('surface.business_activity_type_registry','Business Activity Type Registry','Business Activity Type Registry','active','authoritative','FALSE','row_audit_schema:Business Activity Type Registry','v1','gid_based','reference_surface','exact_header_match'),
  ('surface.json_asset_registry','JSON Asset Registry','JSON Asset Registry','active','operational','FALSE','row_audit_schema:JSON Asset Registry','v1','gid_based','sink_surface','header_match');

-- ── 4. Fix brand_paths — correct allroyalegypt brand_key and add 4 missing brands ─
UPDATE `brand_paths` SET brand_key = 'allroyalegypt_wp' WHERE brand_key = 'allroyalegypt brand';

INSERT IGNORE INTO `brand_paths`
  (brand_key, normalized_brand_name, business_type_key, target_key, base_url, status, active)
VALUES
  ('egypttourgates_wp','egypttourgates','destination_or_travel_business','egypttourgates_wp',NULL,'active','TRUE'),
  ('donatours_wp','donatours','destination_or_travel_business','donatours_wp','https://donatours.com/wp-json','active','TRUE'),
  ('dreamdesert_wp','dreamdesert','destination_or_travel_business','dreamdesert_wp','https://dreamdeserttours.com/wp-json','active','TRUE'),
  ('almallah_wp','almallah','destination_or_travel_business','almallah_wp','https://tourism.almallahgroup-mg.com/wp-json','active','TRUE');

-- Also set base_url for arab_cooling (currently null)
UPDATE `brand_paths` SET base_url = 'https://arabcooling.com' WHERE brand_key = 'arab_cooling' AND (base_url IS NULL OR base_url = '');

-- ── 5. Seed business_type_profiles for all 23 missing business_type_keys ──────────
INSERT IGNORE INTO `business_type_profiles`
  (business_type_key, knowledge_profile_key, supported_engine_categories,
   authoritative_read_home, profile_status, active)
VALUES
  ('destination_or_travel_business','destination_travel_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('retail_product_category','retail_product_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('expert_service_firm','expert_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('b2b_product_supplier','b2b_product_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('fitness_or_recreation_business','fitness_recreation_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('food_and_dining_business','food_dining_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('software_service','software_service_knowledge_profile','seo|content|growth|product','google_drive','active','TRUE'),
  ('education_service_provider','education_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('retail_or_home_service_business','retail_home_service_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('gift_or_event_retail_business','gift_event_retail_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('media_or_entertainment_business','media_entertainment_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('financial_service_firm','financial_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('vehicle_or_auto_service_business','vehicle_auto_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('employment_or_career_service','employment_career_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('seasonal_retail_program','seasonal_retail_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('property_service_business','property_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('business_services','business_services_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('connectivity_service_provider','connectivity_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('ticketing_or_event_access_business','ticketing_event_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('retail_or_personal_care_business','retail_personal_care_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('stay_or_guest_service','stay_guest_service_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE'),
  ('consumer_service_business','consumer_service_knowledge_profile','seo|content|growth','google_drive','active','TRUE'),
  ('home_garden','home_garden_knowledge_profile','seo|content|growth|brand','google_drive','active','TRUE');

-- ── 6. Seed default logic_packs from logic_definitions ────────────────────────────
INSERT IGNORE INTO `logic_packs`
  (pack_id, pack_key, display_name, pack_type, service_mode, status)
VALUES
  ('00000000-0000-4000-a000-000000000101','execution_tools_self_serve','Execution Tools — Self Serve','operational','self_serve','active'),
  ('00000000-0000-4000-a000-000000000102','execution_tools_assisted','Execution Tools — Assisted','operational','assisted','active'),
  ('00000000-0000-4000-a000-000000000103','execution_tools_managed','Execution Tools — Managed','operational','managed','active'),
  ('00000000-0000-4000-a000-000000000201','supervisory_review_self_serve','Review & Governance — Self Serve','review','self_serve','active'),
  ('00000000-0000-4000-a000-000000000202','supervisory_review_assisted','Review & Governance — Assisted','review','assisted','active'),
  ('00000000-0000-4000-a000-000000000203','supervisory_review_managed','Review & Governance — Managed','review','managed','active'),
  ('00000000-0000-4000-a000-000000000301','seo_content_pack','SEO & Content Operations','sop','self_serve','active'),
  ('00000000-0000-4000-a000-000000000302','growth_strategy_pack','Growth Strategy Operations','sop','assisted','active'),
  ('00000000-0000-4000-a000-000000000303','brand_management_pack','Brand Management Operations','sop','managed','active'),
  ('00000000-0000-4000-a000-000000000401','admin_system_pack','Admin & System Operations','audit','managed','active');

-- ── 7. Fix task_routes.workflow_key — align with workflows.workflow_key ────────────
UPDATE `task_routes` SET workflow_key = 'wordpress_brand_aware_page_creation_workflow'
  WHERE workflow_key = 'wf_wordpress_brand_aware_page_creation';
UPDATE `task_routes` SET workflow_key = 'wordpress_runtime_inventory_refresh_workflow'
  WHERE workflow_key = 'wf_wordpress_runtime_inventory_refresh';
UPDATE `task_routes` SET workflow_key = 'wordpress_site_migration_workflow'
  WHERE workflow_key = 'wf_wordpress_site_migration';
UPDATE `task_routes` SET workflow_key = 'wordpress_site_migration_repair_workflow'
  WHERE workflow_key = 'wf_wordpress_site_migration_repair';
UPDATE `task_routes` SET workflow_key = 'wordpress_translation_import_workflow'
  WHERE workflow_key = 'wf_wpml_wordpress_translation_import';
