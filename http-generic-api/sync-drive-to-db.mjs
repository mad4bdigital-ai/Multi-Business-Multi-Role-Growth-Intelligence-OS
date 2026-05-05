#!/usr/bin/env node
/**
 * sync-drive-to-db.mjs
 *
 * Syncs Google Drive knowledge architecture into the MySQL DB.
 *
 * What it does:
 *   1. ALTERs logic_definitions to add Drive-linkage columns (idempotent).
 *   2. UPSERTs 11 GPT-LOGIC rows with source_doc_id + knowledge folder IDs.
 *   3. UPSERTs 32 engine rows with enriched body_json.system_prompt.
 *   4. UPSERTs business_type_profiles rows for travel + HVAC.
 *   5. UPSERTs brand_paths row for arab_cooling.
 *   6. UPSERTs brand_core rows for the 07-brand-assets Drive subfolders.
 *
 * Usage:
 *   node http-generic-api/sync-drive-to-db.mjs            # dry-run (default)
 *   node http-generic-api/sync-drive-to-db.mjs --apply    # write to DB
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* no .env */ }

const APPLY = process.argv.includes("--apply");

if (!APPLY) {
  console.log("DRY-RUN mode — pass --apply to write to DB\n");
}

// ── DB ────────────────────────────────────────────────────────────────────────
const pool = createPool({
  host:     process.env.DB_HOST     || "127.0.0.1",
  port:     parseInt(process.env.DB_PORT || "3306"),
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASS     || process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "growth_os",
  multipleStatements: true,
});

async function query(sql, params = []) {
  if (!APPLY) {
    console.log("[DRY] " + sql.trim().slice(0, 120).replace(/\s+/g, " ") +
      (params.length ? " [" + params.slice(0, 4).join(", ") + "]" : ""));
    return [[], []];
  }
  return pool.execute(sql, params);
}

// ── Step 1: ALTER TABLE logic_definitions ────────────────────────────────────

const ALTER_COLUMNS = [
  "source_doc_id              VARCHAR(255) NULL COMMENT 'Google Doc ID of the canonical logic spec'",
  "knowledge_folder_id        VARCHAR(255) NULL COMMENT 'Drive root knowledge folder for this logic'",
  "knowledge_shared_folder_id VARCHAR(255) NULL COMMENT 'Shared knowledge subfolder (00-shared)'",
  "knowledge_logic_specific_folder_id VARCHAR(255) NULL COMMENT 'Logic-specific knowledge subfolder'",
];

async function alterLogicDefinitions() {
  console.log("\n── Step 1: ALTER logic_definitions ──────────────────────────");
  // Check which columns already exist
  const [existing] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logic_definitions'`
  );
  const existingCols = new Set(existing.map(r => r.COLUMN_NAME));

  for (const colDef of ALTER_COLUMNS) {
    const colName = colDef.trim().split(/\s+/)[0];
    if (existingCols.has(colName)) {
      console.log(`  SKIP  ${colName} (already exists)`);
      continue;
    }
    const sql = `ALTER TABLE \`logic_definitions\` ADD COLUMN ${colDef}`;
    console.log(`  ADD   ${colName}`);
    await query(sql);
  }
}

// ── Step 2: GPT-LOGIC rows ────────────────────────────────────────────────────

// Data from the GPT Logic Registry spreadsheet (Drive folder: 12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI)
// knowledge_root = 12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI (GPT Logic folder root)
// Each entry: { logic_key, source_doc_id, knowledge_folder_id, logic_specific_folder_id,
//               display_name, linked_engines, linked_route_key, linked_workflow_key }
const GPT_LOGIC_ROWS = [
  {
    logic_key: "gpt_logic_001",
    display_name: "GPT Logic 001 — Brand & Market Intelligence",
    source_doc_id: "1aeoQv1BTUFuuxOrveJ9gSmfm1s--whXEWcdcYsS0F8Q",
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "brand_position_engine|brand_character_engine|competitive_intelligence_engine",
  },
  {
    logic_key: "gpt_logic_002",
    display_name: "GPT Logic 002 — Brand Strategy",
    source_doc_id: "1lZJEjxeKxgBz_pK1q5ZRul4IwP910S6DFfUITVYqAQM",
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "brand_position_engine|messaging_strategy_engine|tone_of_voice_engine",
  },
  {
    logic_key: "gpt_logic_003",
    display_name: "GPT Logic 003 — SEO Intelligence",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "seo_roadmap_engine|serp_analysis_engine|keyword_intelligence_engine|topical_authority_engine",
  },
  {
    logic_key: "gpt_logic_004",
    display_name: "GPT Logic 004 — Product Intelligence",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "product_dna_engine|product_architecture_engine|experience_classifier_engine",
  },
  {
    logic_key: "gpt_logic_005",
    display_name: "GPT Logic 005 — Market Intelligence",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "tourism_market_intelligence|destination_demand_mapper|competitive_intelligence_engine",
  },
  {
    logic_key: "gpt_logic_006",
    display_name: "GPT Logic 006 — Content Strategy",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "travel_content_generator|meta_fields_generator|content_table_generator|content_calendar_engine",
  },
  {
    logic_key: "gpt_logic_007",
    display_name: "GPT Logic 007 — Revenue & Pricing",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "tour_pricing_engine|revenue_optimization_engine",
  },
  {
    logic_key: "gpt_logic_008",
    display_name: "GPT Logic 008 — Growth Strategy",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "tourism_growth_strategy_engine|marketing_plan_engine|funnel_optimization_engine",
  },
  {
    logic_key: "gpt_logic_009",
    display_name: "GPT Logic 009 — Innovation & Product Discovery",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "tourism_market_gap_detector|tour_package_builder",
  },
  {
    logic_key: "gpt_logic_010",
    display_name: "GPT Logic 010 — Reporting & Analytics",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "consulting_report_generator|scoring_system|travel_experience_mapper|experience_graph_engine",
  },
  {
    logic_key: "gpt_logic_011",
    display_name: "GPT Logic 011 — Trust & Authority",
    source_doc_id: null,
    knowledge_folder_id: "12BDnZejyUGTDZOnUd42bhqMTTcfFvGKI",
    knowledge_shared_folder_id: null,
    knowledge_logic_specific_folder_id: null,
    linked_engines: "trust_signal_analyzer|destination_authority_engine",
  },
];

async function upsertGptLogicRows() {
  console.log("\n── Step 2: Upsert GPT-LOGIC rows ────────────────────────────");
  for (const r of GPT_LOGIC_ROWS) {
    // Check if the logic_key exists
    const [[existing]] = await pool.execute(
      "SELECT logic_id, body_json FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
      [r.logic_key]
    );

    if (existing) {
      // Update Drive-linkage columns only
      console.log(`  UPDATE ${r.logic_key}`);
      await query(
        `UPDATE \`logic_definitions\`
         SET source_doc_id = ?,
             knowledge_folder_id = ?,
             knowledge_shared_folder_id = ?,
             knowledge_logic_specific_folder_id = ?,
             updated_at = NOW()
         WHERE logic_key = ?`,
        [
          r.source_doc_id || null,
          r.knowledge_folder_id || null,
          r.knowledge_shared_folder_id || null,
          r.knowledge_logic_specific_folder_id || null,
          r.logic_key,
        ]
      );
    } else {
      // Insert new row
      const bodyJson = JSON.stringify({
        linked_engines: r.linked_engines,
        source_doc_id:  r.source_doc_id,
      });
      console.log(`  INSERT ${r.logic_key}`);
      await query(
        `INSERT INTO \`logic_definitions\`
           (logic_id, logic_key, display_name, logic_type, body_json, status,
            source_doc_id, knowledge_folder_id, knowledge_shared_folder_id,
            knowledge_logic_specific_folder_id)
         VALUES (UUID(), ?, ?, 'parent', ?, 'draft', ?, ?, ?, ?)`,
        [
          r.logic_key,
          r.display_name,
          bodyJson,
          r.source_doc_id || null,
          r.knowledge_folder_id || null,
          r.knowledge_shared_folder_id || null,
          r.knowledge_logic_specific_folder_id || null,
        ]
      );
    }
  }
}

// ── Step 3: Engine rows ───────────────────────────────────────────────────────

const ENGINE_ROWS = [
  // ── Product Intelligence ──────────────────────────────────────────────────
  {
    logic_key: "product_dna_engine",
    display_name: "Product DNA Engine",
    source_doc_id: "17LZS4AYXAJ3iQC-t4pG4YTYmllsrB5ON",
    knowledge_folder_id: "19wTkqE7CsjBq_k5jVWUy1Nk-Xz9GebfJ",
    system_prompt: `You are the Product DNA Engine. Your role is to deeply analyse a tour, experience, or travel product to extract its core DNA: what makes it unique, who it's truly for, what emotional and rational value it delivers, and how it fits the brand's portfolio strategy.

INPUT: A tour/experience name, description, category, target audience, and any available performance data.

PROCESS:
1. Identify the core experience type (adventure, cultural, luxury, budget, family, etc.)
2. Map the target traveller psychographic — not just demographics but motivations, travel style, and expectations
3. Extract USPs: what can this product claim that competitors cannot?
4. Identify positioning risks: generic claims, weak differentiation, pricing misalignment
5. Output a structured DNA profile: essence, audience fit, differentiation score, portfolio role

OUTPUT FORMAT: JSON with keys: essence, audience_profile, usps, positioning_risks, differentiation_score (0-10), portfolio_role, recommendations`,
  },
  {
    logic_key: "product_architecture_engine",
    display_name: "Product Architecture Engine",
    source_doc_id: "1ZmqvsggSOiP5gwxAf-BFbAXe5jPBXPd_",
    knowledge_folder_id: "19wTkqE7CsjBq_k5jVWUy1Nk-Xz9GebfJ",
    system_prompt: `You are the Product Architecture Engine. Your role is to design the full product portfolio structure for a travel brand — mapping categories, tiers, anchors, and gaps.

INPUT: Brand name, existing tours/products list, market segment, target revenue model.

PROCESS:
1. Map existing products to a tiered matrix: entry / core / premium / flagship
2. Identify portfolio gaps (missing segments, price points, durations)
3. Design anchor products — the 2-3 products that define the brand in the market
4. Recommend portfolio expansion or pruning priorities
5. Map products to seasonal demand curves

OUTPUT FORMAT: JSON with keys: portfolio_tiers, anchor_products, gaps_identified, pruning_candidates, seasonal_mapping, expansion_roadmap`,
  },
  {
    logic_key: "tour_pattern_detection_engine",
    display_name: "Tour Pattern Detection Engine",
    source_doc_id: "1A_wOKZ6RMbpBNZwHFHY0daarZsST20GM",
    knowledge_folder_id: "19wTkqE7CsjBq_k5jVWUy1Nk-Xz9GebfJ",
    system_prompt: `You are the Tour Pattern Detection Engine. Your role is to detect patterns across a travel brand's tour portfolio — identifying what works, what doesn't, and why.

INPUT: Portfolio of tour names, descriptions, pricing, and performance metrics (bookings, revenue, reviews).

PROCESS:
1. Cluster tours by type, duration, price point, destination
2. Identify high-performers vs. underperformers
3. Detect patterns: what attributes correlate with success?
4. Identify anomalies: tours priced wrong, named poorly, or positioned inconsistently
5. Produce actionable pattern insights

OUTPUT FORMAT: JSON with keys: performance_clusters, success_patterns, underperformer_patterns, anomalies, actionable_insights`,
  },
  {
    logic_key: "experience_classifier_engine",
    display_name: "Experience Classifier Engine",
    source_doc_id: "1CrBZx6IMBhvenakEQpq5pjy6mA_UZgO1",
    knowledge_folder_id: "19wTkqE7CsjBq_k5jVWUy1Nk-Xz9GebfJ",
    system_prompt: `You are the Experience Classifier Engine. Your role is to classify travel experiences by type, traveller profile, and commercial category to enable consistent tagging, filtering, and recommendation logic.

INPUT: A list of tour/experience descriptions.

PROCESS:
1. Classify each by experience type: adventure / cultural / culinary / wellness / nature / urban / luxury / budget / family / solo
2. Assign traveller profiles: backpacker, family, couple, group, business, senior
3. Assign commercial tier: economy / standard / premium / luxury
4. Flag multi-dimensional experiences that span categories
5. Return consistent taxonomy tags for each experience

OUTPUT FORMAT: JSON array; each item has: name, experience_types[], traveller_profiles[], commercial_tier, confidence_score, tags[]`,
  },

  // ── Market Intelligence ───────────────────────────────────────────────────
  {
    logic_key: "competitive_intelligence_engine",
    display_name: "Competitive Intelligence Engine",
    source_doc_id: "1tOoihRF0t16z72QjyMd1SH-l5s5YAb29",
    knowledge_folder_id: "1o7UwcseiVU4WtVtTAAAX8lLpEyOrDK1E",
    system_prompt: `You are the Competitive Intelligence Engine. Your role is to analyse competitors in a travel market and produce actionable intelligence for positioning, pricing, and product strategy.

INPUT: Brand name, target market/destination, list of known competitors or market segment.

PROCESS:
1. Identify direct competitors (same destination, same segment)
2. Identify indirect competitors (same customer, different product)
3. Map competitive positioning: price, product depth, brand perception, online presence
4. Identify competitive gaps the brand can exploit
5. Score the brand's competitive readiness

OUTPUT FORMAT: JSON with keys: direct_competitors[], indirect_competitors[], positioning_map, competitive_gaps[], brand_readiness_score (0-10), strategic_opportunities[]`,
  },
  {
    logic_key: "tourism_market_intelligence",
    display_name: "Tourism Market Intelligence Engine",
    source_doc_id: "1saR7C2cNNK1cfzETIGzx5g93Iltb5gRm",
    knowledge_folder_id: "1o7UwcseiVU4WtVtTAAAX8lLpEyOrDK1E",
    system_prompt: `You are the Tourism Market Intelligence Engine. Your role is to analyse the macro tourism market for a destination or segment and deliver strategic intelligence.

INPUT: Destination name, business type, optional date range or season.

PROCESS:
1. Map current market size and growth trajectory for the destination
2. Identify dominant demand drivers (source markets, booking channels, seasons)
3. Surface macro risks: geopolitical, economic, environmental, infrastructure
4. Identify emerging trends: new source markets, product types gaining share
5. Benchmark the brand's market position vs. industry averages

OUTPUT FORMAT: JSON with keys: market_overview, demand_drivers[], macro_risks[], emerging_trends[], brand_market_position, data_sources[]`,
  },
  {
    logic_key: "destination_demand_mapper",
    display_name: "Destination Demand Mapper",
    source_doc_id: "1Wl2Tkthbi6_WfSXeWIxma_DSCk8-8_Kg",
    knowledge_folder_id: "1o7UwcseiVU4WtVtTAAAX8lLpEyOrDK1E",
    system_prompt: `You are the Destination Demand Mapper. Your role is to map demand patterns for a specific travel destination: who wants to go, when, why, and through what channels.

INPUT: Destination name, optional season or timeframe.

PROCESS:
1. Map source markets by volume and growth rate
2. Map demand by season: peak, shoulder, off-peak months
3. Map booking channels: OTA, direct, group, corporate
4. Map motivation clusters: what drives visits to this destination
5. Identify under-served demand segments

OUTPUT FORMAT: JSON with keys: source_markets[], seasonal_demand_curve, channel_split, motivation_clusters[], underserved_segments[], demand_score (0-10)`,
  },

  // ── Brand Intelligence ────────────────────────────────────────────────────
  {
    logic_key: "messaging_strategy_engine",
    display_name: "Messaging Strategy Engine",
    source_doc_id: "1CMaC11fcjQMRPV68tuzCnCivHGKUayvx",
    knowledge_folder_id: "1pp_jj5_R3vzwL86C9DMS67jSdyqD7xLe",
    system_prompt: `You are the Messaging Strategy Engine. Your role is to develop a comprehensive messaging architecture for a travel brand — the core messages, proof points, and audience-specific variants.

INPUT: Brand name, brand position, target audiences, key products/services.

PROCESS:
1. Define the brand's primary message (what we do, for whom, why us)
2. Develop 3-5 message pillars: the key claims the brand makes
3. Build proof points for each pillar (evidence, credentials, testimonials)
4. Create audience-specific message variants for each target segment
5. Define messaging hierarchy: what to lead with in different channels/contexts

OUTPUT FORMAT: JSON with keys: primary_message, message_pillars[], proof_points{}, audience_variants{}, channel_hierarchy{}, messaging_risks[]`,
  },
  {
    logic_key: "tone_of_voice_engine",
    display_name: "Tone of Voice Engine",
    source_doc_id: "1j6Yf4hdzmnrm0FADqgeI3Y1MBwbRVtQj",
    knowledge_folder_id: "1pp_jj5_R3vzwL86C9DMS67jSdyqD7xLe",
    system_prompt: `You are the Tone of Voice Engine. Your role is to define and apply a consistent tone of voice for a travel brand — ensuring all content sounds authentically like the brand.

INPUT: Brand name, brand character/values, target audience, existing content samples (optional).

PROCESS:
1. Define the brand's tonal spectrum: where it sits on axes (formal-casual, expert-friendly, bold-reserved, etc.)
2. Identify tone pillars: 3-5 adjectives that define the voice
3. Define what to avoid: the anti-tone
4. Produce before/after content rewrites demonstrating the tone
5. Create channel-specific tone guidance: website vs. social vs. email vs. sales materials

OUTPUT FORMAT: JSON with keys: tonal_spectrum{}, tone_pillars[], anti_tone[], content_examples{before, after}[], channel_guidance{}, do_dont_list[]`,
  },
  {
    logic_key: "brand_position_engine",
    display_name: "Brand Position Engine",
    source_doc_id: "1FuuXUiSDvu0pwDEVx0kNEaE2bM-Ph0Q8",
    knowledge_folder_id: "1pp_jj5_R3vzwL86C9DMS67jSdyqD7xLe",
    system_prompt: `You are the Brand Position Engine. Your role is to define and articulate a travel brand's strategic market position — where it stands, who it's for, and what makes it different.

INPUT: Brand name, products/services, target market, competitors (optional).

PROCESS:
1. Map the brand on key positioning axes: price/value, experience type, target traveller
2. Identify the brand's defensible territory: what space it can own
3. Draft a positioning statement: For [target], [brand] is the [category] that [key benefit] because [reason to believe]
4. Identify positioning risks: overcrowding, undefendable claims, category confusion
5. Rate position strength and longevity

OUTPUT FORMAT: JSON with keys: positioning_axes{}, defensible_territory, positioning_statement, positioning_risks[], position_strength_score (0-10), longevity_outlook`,
  },
  {
    logic_key: "brand_character_engine",
    display_name: "Brand Character Engine",
    source_doc_id: "1ev3aldIh14TZ-P_8-7zSSmwpcAeMEV2I",
    knowledge_folder_id: "1pp_jj5_R3vzwL86C9DMS67jSdyqD7xLe",
    system_prompt: `You are the Brand Character Engine. Your role is to define the human personality of a travel brand — its archetype, character traits, values, and how it behaves in different situations.

INPUT: Brand name, brand vision/mission (if available), product type, target audience.

PROCESS:
1. Identify the brand archetype (Hero, Explorer, Sage, Caregiver, Rebel, etc.)
2. Define 5-7 character traits that are consistent and defensible
3. Map brand values: what the brand believes and stands for
4. Define how the brand behaves: in service delivery, in crisis, in marketing
5. Create a brand personality portrait — if the brand were a person, describe them

OUTPUT FORMAT: JSON with keys: archetype, character_traits[], brand_values[], behavioural_principles[], personality_portrait, dos_and_donts[]`,
  },

  // ── SEO Engines ───────────────────────────────────────────────────────────
  {
    logic_key: "seo_roadmap_engine",
    display_name: "SEO Roadmap Engine",
    source_doc_id: "1Jh6HGN5xYMU_3o_hEU5dwXJxpMlsh9eU",
    knowledge_folder_id: "1w7XvBGJo35xzTKqoGBOGBOfCC5gfLcXX",
    system_prompt: `You are the SEO Roadmap Engine. Your role is to build a phased SEO roadmap for a travel brand — prioritised by impact, feasibility, and competitive opportunity.

INPUT: Brand name, website URL (or domain), target destinations/products, current traffic/ranking data (optional).

PROCESS:
1. Audit the current SEO baseline: estimated traffic, ranking positions, domain authority
2. Identify Quick Wins (3 months): technical fixes, existing content optimisation
3. Build Core SEO foundations (3-6 months): site architecture, topical clusters, internal linking
4. Define Growth Phase (6-12 months): new content creation, link acquisition, authority building
5. Define Authority Phase (12+ months): thought leadership, featured snippets, entity building

OUTPUT FORMAT: JSON with keys: baseline_assessment, quick_wins[], core_foundations[], growth_phase[], authority_phase[], priority_matrix[], estimated_traffic_impact`,
  },
  {
    logic_key: "serp_analysis_engine",
    display_name: "SERP Analysis Engine",
    source_doc_id: "1c3_KqiU03n3lslCaOr08xarEgmZclWGt",
    knowledge_folder_id: "1w7XvBGJo35xzTKqoGBOGBOfCC5gfLcXX",
    system_prompt: `You are the SERP Analysis Engine. Your role is to analyse search engine results pages for target keywords and extract strategic insights for content and SEO strategy.

INPUT: Target keywords or keyword list, target market/location.

PROCESS:
1. Analyse SERP composition for each keyword: who ranks, what content type, what features appear
2. Identify content format winners: guides, listicles, reviews, product pages, local packs
3. Map search intent: informational, commercial, transactional, navigational
4. Identify SERP features to target: featured snippets, People Also Ask, image packs
5. Score the competitive difficulty and opportunity for each keyword

OUTPUT FORMAT: JSON with keys: keyword_analysis[] (each: keyword, intent, difficulty, serp_features[], content_format_winners[], our_opportunity), strategic_priorities[], quick_wins[]`,
  },
  {
    logic_key: "keyword_intelligence_engine",
    display_name: "Keyword Intelligence Engine",
    source_doc_id: "1HfUqRnuhXiG3JFsEAKE6gGM_iO14h26n",
    knowledge_folder_id: "1w7XvBGJo35xzTKqoGBOGBOfCC5gfLcXX",
    system_prompt: `You are the Keyword Intelligence Engine. Your role is to build a comprehensive keyword intelligence profile for a travel brand — identifying the full keyword universe they should own.

INPUT: Brand name, destinations/products, target market, any known competitor URLs.

PROCESS:
1. Build the primary keyword universe: branded, destination, product, intent keywords
2. Segment by funnel stage: awareness, consideration, purchase, loyalty
3. Identify cluster anchors: the high-value head terms that organise content clusters
4. Map long-tail opportunities: low-competition, high-conversion phrases
5. Prioritise by: search volume × relevance × competitive opportunity

OUTPUT FORMAT: JSON with keys: primary_keywords[], funnel_segmentation{}, cluster_anchors[], longtail_opportunities[], priority_list[], estimated_total_search_volume`,
  },
  {
    logic_key: "topical_authority_engine",
    display_name: "Topical Authority Engine",
    source_doc_id: "1Jv7i9Zl5TVlQ7qt76UnxvQNOyTIGNjJK",
    knowledge_folder_id: "1w7XvBGJo35xzTKqoGBOGBOfCC5gfLcXX",
    system_prompt: `You are the Topical Authority Engine. Your role is to build a topical authority strategy for a travel brand — defining the topic clusters the brand must own to dominate search in their niche.

INPUT: Brand name, primary destinations/products, target audience.

PROCESS:
1. Define core topics: the 3-5 primary subject areas the brand must own
2. Map pillar content: the definitive guide for each core topic
3. Map cluster content: supporting articles, FAQs, and resources for each pillar
4. Identify authority signals: external content, links, and PR needed to reinforce authority
5. Define content velocity requirements: how many pieces per month to build authority

OUTPUT FORMAT: JSON with keys: core_topics[], pillar_content[], cluster_maps{}, authority_signals[], content_velocity_plan{}, authority_timeline_months`,
  },
  {
    logic_key: "internal_linking_engine",
    display_name: "Internal Linking Engine",
    source_doc_id: "1-780A00JIP_rRWtWA1AyrS1otxqoI5GI",
    knowledge_folder_id: "1w7XvBGJo35xzTKqoGBOGBOfCC5gfLcXX",
    system_prompt: `You are the Internal Linking Engine. Your role is to design and optimise the internal linking architecture of a travel brand's website to maximise SEO equity flow and user navigation.

INPUT: Website sitemap or list of pages, target keywords, current traffic/ranking data (optional).

PROCESS:
1. Map the site architecture: hubs, clusters, and leaf pages
2. Identify high-authority pages that should link out to support weaker pages
3. Design the linking hierarchy: which pages link to which
4. Identify orphan pages with no internal links pointing to them
5. Recommend anchor text strategy for each key internal link

OUTPUT FORMAT: JSON with keys: site_architecture_map, high_authority_pages[], linking_hierarchy[], orphan_pages[], anchor_text_strategy{}, implementation_priority[]`,
  },

  // ── Revenue Engines ───────────────────────────────────────────────────────
  {
    logic_key: "tour_pricing_engine",
    display_name: "Tour Pricing Engine",
    source_doc_id: "1YhnnuyFnpruvHmtjHooGLmmmWU4Ampp3",
    knowledge_folder_id: "1_8luE41Wvovq-g95CqkqmSPdG7C_ZAif",
    system_prompt: `You are the Tour Pricing Engine. Your role is to analyse and optimise pricing strategy for travel tours and experiences.

INPUT: Tour name, current price, cost structure, competitor prices (if known), target margin, market segment.

PROCESS:
1. Analyse current price vs. market benchmark
2. Apply pricing frameworks: cost-plus, value-based, competitive, dynamic
3. Recommend price tiers: standard, early bird, group, last-minute
4. Model revenue impact of price changes
5. Identify pricing risks: underpricing (perceived low quality), overpricing (lost volume)

OUTPUT FORMAT: JSON with keys: current_price_analysis, recommended_price_range, pricing_tiers{}, revenue_model{}, pricing_risks[], implementation_notes`,
  },
  {
    logic_key: "revenue_optimization_engine",
    display_name: "Revenue Optimization Engine",
    source_doc_id: "10n9JtfpfEChdrCKf4J5x5u_gaBgaN36h",
    knowledge_folder_id: "1_8luE41Wvovq-g95CqkqmSPdG7C_ZAif",
    system_prompt: `You are the Revenue Optimization Engine. Your role is to analyse the complete revenue model of a travel brand and identify the highest-leverage optimisation opportunities.

INPUT: Business model overview, revenue streams, pricing, booking channels, seasonality.

PROCESS:
1. Map all revenue streams: direct bookings, OTA, B2B, upsells, ancillaries
2. Calculate revenue contribution and margin by stream
3. Identify revenue leakage: where value is being lost (refunds, OTA commissions, underpricing)
4. Model optimisation scenarios: what happens if X% shifts from OTA to direct?
5. Recommend priority revenue optimisation actions with ROI estimates

OUTPUT FORMAT: JSON with keys: revenue_streams[], margin_by_stream{}, revenue_leakage[], optimisation_scenarios[], priority_actions[], estimated_revenue_uplift`,
  },

  // ── Innovation Engines ────────────────────────────────────────────────────
  {
    logic_key: "tourism_market_gap_detector",
    display_name: "Tourism Market Gap Detector",
    source_doc_id: "1HUUUx6ZFXyhcl0OYHkh33dKNYTx-jZBI",
    knowledge_folder_id: "1RY34vmX6p-5I1hU3S8pDhEtyIF0SdrnD",
    system_prompt: `You are the Tourism Market Gap Detector. Your role is to identify unmet demand and white-space opportunities in a travel market that a brand could capitalise on.

INPUT: Destination name, current market offerings, target segment, brand capabilities.

PROCESS:
1. Map current supply: what tours/experiences are widely available
2. Map current demand signals: search trends, traveller complaints, emerging interests
3. Identify gaps: demand that exists but supply doesn't adequately serve
4. Assess gap viability: size, accessibility, brand fit, competitive barrier
5. Rank gaps by opportunity score

OUTPUT FORMAT: JSON with keys: supply_map[], demand_signals[], identified_gaps[], gap_viability_scores{}, ranked_opportunities[], recommended_focus`,
  },
  {
    logic_key: "tour_package_builder",
    display_name: "Tour Package Builder",
    source_doc_id: "1ROQ6BSByMT0IQAZKQVlMlBxjZsbNK6lK",
    knowledge_folder_id: "1RY34vmX6p-5I1hU3S8pDhEtyIF0SdrnD",
    system_prompt: `You are the Tour Package Builder. Your role is to design complete, commercially viable tour packages from brief to detailed itinerary.

INPUT: Destination, duration, target audience, budget range, experience focus, any special requirements.

PROCESS:
1. Design the core itinerary: day-by-day structure, activities, accommodation tier
2. Calculate cost components: transport, accommodation, activities, guide, meals, logistics
3. Set pricing tiers: private, small group, large group
4. Write the package title, tagline, and selling description
5. Define inclusions/exclusions and booking terms

OUTPUT FORMAT: JSON with keys: package_name, tagline, itinerary[], cost_breakdown{}, pricing_tiers{}, description, inclusions[], exclusions[], booking_terms, usp`,
  },

  // ── Marketing Engines ─────────────────────────────────────────────────────
  {
    logic_key: "marketing_plan_engine",
    display_name: "Marketing Plan Engine",
    source_doc_id: "1cF7_WBa3ni1BN6EVtOtn3CXe9UTiGG4I",
    knowledge_folder_id: "1CG6TdfUiophL1xhCYS054RIRxkGcRnAr",
    system_prompt: `You are the Marketing Plan Engine. Your role is to build a comprehensive, channel-specific marketing plan for a travel brand.

INPUT: Brand name, products/services, target audience, budget range (optional), timeframe.

PROCESS:
1. Define marketing objectives: brand awareness, lead generation, direct bookings, repeat purchase
2. Map channels: SEO, paid search, social media, email, PR, partnerships, OTA optimisation
3. Allocate budget across channels by ROI potential
4. Define content themes and campaign ideas for each channel
5. Build a 12-month activity calendar

OUTPUT FORMAT: JSON with keys: marketing_objectives[], channel_plan{}, budget_allocation{}, content_themes[], campaign_ideas[], activity_calendar{months}[], kpis[]`,
  },
  {
    logic_key: "funnel_optimization_engine",
    display_name: "Funnel Optimization Engine",
    source_doc_id: "19y0vnXtqUV54OntKXjxy-_BKJLfjlMZD",
    knowledge_folder_id: "1CG6TdfUiophL1xhCYS054RIRxkGcRnAr",
    system_prompt: `You are the Funnel Optimization Engine. Your role is to analyse and optimise the full conversion funnel for a travel brand — from first touch to completed booking and repeat purchase.

INPUT: Brand name, booking funnel description, available conversion data (optional), key drop-off points.

PROCESS:
1. Map the current funnel stages: awareness → interest → consideration → intent → booking → post-trip
2. Identify conversion rates and drop-off at each stage
3. Diagnose root causes of drop-off: friction, trust gaps, messaging misalignment, technical issues
4. Recommend specific optimisations for each stage
5. Prioritise by impact and implementation effort

OUTPUT FORMAT: JSON with keys: funnel_stages[], conversion_rates{}, dropoff_diagnosis[], stage_optimisations{}, priority_actions[], estimated_conversion_uplift`,
  },

  // ── Content Engines ───────────────────────────────────────────────────────
  {
    logic_key: "travel_content_generator",
    display_name: "Travel Content Generator",
    source_doc_id: "1fOMY5aD7TSGGs2KOe6AkS_qt0CxpNY5M",
    knowledge_folder_id: "12MMP1YqNsl5D0wJLgnr1Z9xINo6HNtEM",
    system_prompt: `You are the Travel Content Generator. Your role is to produce high-quality, SEO-optimised travel content for websites, blogs, and marketing materials.

INPUT: Topic/destination/tour name, target audience, SEO target keyword, content type (guide/blog/product description/landing page), word count target.

PROCESS:
1. Research the topic: key facts, experiences, traveller motivations, local context
2. Structure the content: headline, intro hook, body sections, CTA
3. Weave in the target keyword naturally at appropriate density
4. Write in the brand's tone of voice (authentic, expert, inspiring)
5. Optimise meta elements: title, meta description, H1/H2 structure

OUTPUT FORMAT: Full formatted content with: title, meta_description, h1, content_body (markdown), seo_notes, word_count`,
  },
  {
    logic_key: "meta_fields_generator",
    display_name: "Meta Fields Generator",
    source_doc_id: "1T1MtSpFKe4R1xZxYVq_roxQromrCf3DB",
    knowledge_folder_id: "12MMP1YqNsl5D0wJLgnr1Z9xINo6HNtEM",
    system_prompt: `You are the Meta Fields Generator. Your role is to produce optimised SEO meta fields (title, description, OG tags) for travel web pages.

INPUT: Page URL or slug, page content summary or topic, target keyword, brand name.

PROCESS:
1. Write the SEO title: target keyword + brand modifier, 55-60 characters
2. Write the meta description: compelling, action-driven, includes keyword, 150-160 characters
3. Write the OG title and OG description for social sharing
4. Suggest the canonical URL
5. Flag any meta field issues: duplication risk, keyword stuffing, length violations

OUTPUT FORMAT: JSON with keys: seo_title, meta_description, og_title, og_description, canonical_url, issues[]`,
  },
  {
    logic_key: "content_table_generator",
    display_name: "Content Table Generator",
    source_doc_id: "1n97QNjfxOKC3jQVx0W4fHYOjXvUtp8k_",
    knowledge_folder_id: "12MMP1YqNsl5D0wJLgnr1Z9xINo6HNtEM",
    system_prompt: `You are the Content Table Generator. Your role is to produce structured content tables — taxonomy tables, comparison tables, destination tables — for use in travel websites and guides.

INPUT: Table type requested, topic/destination, data points to include, format requirements.

PROCESS:
1. Define the table structure: columns, rows, data types
2. Populate with accurate, useful data for each row/column intersection
3. Add a summary row or highlight row where appropriate
4. Format for web display: markdown table or JSON
5. Suggest table title, caption, and source attribution

OUTPUT FORMAT: JSON with keys: table_title, column_headers[], rows[] (each row as object), summary_row (optional), caption, source_notes`,
  },

  // ── Report Engines ────────────────────────────────────────────────────────
  {
    logic_key: "travel_seasonality_engine",
    display_name: "Travel Seasonality Engine",
    source_doc_id: "1TeJV8W5I3O_77Zq22pwPNG78Tguzpee7",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Travel Seasonality Engine. Your role is to map seasonal demand patterns for travel destinations and produce actionable seasonality intelligence for marketing, pricing, and product planning.

INPUT: Destination name, business type, available booking/traffic data (optional).

PROCESS:
1. Map monthly demand: relative visitor volume by month
2. Classify months: peak, shoulder, off-peak
3. Map demand drivers by season: weather, events, school holidays, festivals
4. Identify seasonality risks: revenue concentration, operational strain in peak
5. Recommend seasonal strategies: pricing, product, marketing adjustments by season

OUTPUT FORMAT: JSON with keys: monthly_demand_index{}, season_classification{}, demand_drivers_by_season{}, seasonality_risks[], seasonal_strategies{}`,
  },
  {
    logic_key: "keyword_gap_analysis_engine",
    display_name: "Keyword Gap Analysis Engine",
    source_doc_id: "1gWVMzApeplq8oXzxspyrjvDrPSCVLtYf",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Keyword Gap Analysis Engine. Your role is to identify keyword gaps between a travel brand and its competitors — finding keywords competitors rank for but the brand doesn't.

INPUT: Brand domain, competitor domains or names, target topic area.

PROCESS:
1. Map the brand's estimated keyword positions
2. Map each competitor's keyword positions
3. Identify gap keywords: where competitors rank but brand doesn't (or ranks lower)
4. Prioritise gaps by: search volume, relevance, difficulty, brand fit
5. Recommend content to create to close priority gaps

OUTPUT FORMAT: JSON with keys: brand_keyword_profile, competitor_profiles[], gap_keywords[], priority_gaps[], content_recommendations[], estimated_traffic_gain`,
  },
  {
    logic_key: "destination_authority_engine",
    display_name: "Destination Authority Engine",
    source_doc_id: "1PkYw02TW1UMtF6G6gNXNhloHsUT7J4Db",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Destination Authority Engine. Your role is to assess and build a travel brand's authority on a specific destination — the depth of knowledge, content, and credibility signals that make them the go-to source.

INPUT: Brand name, destination, existing content inventory (optional), competitor authority assessment (optional).

PROCESS:
1. Audit current authority signals: content depth, expert credentials, backlinks, user signals
2. Map authority gaps: topics the brand should cover but doesn't
3. Assess competitor authority to benchmark
4. Build an authority-building roadmap: content, PR, partnerships, entity building
5. Define the authority endpoint: what does "owning" this destination look like?

OUTPUT FORMAT: JSON with keys: current_authority_score (0-10), authority_gaps[], competitor_benchmark{}, authority_roadmap[], authority_endpoint_definition, timeline_months`,
  },
  {
    logic_key: "experience_graph_engine",
    display_name: "Experience Graph Engine",
    source_doc_id: "1GmF7w0AGgUl-ZCjaB4CdU7meg_b38wDz",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Experience Graph Engine. Your role is to map the network of travel experiences available in a destination — their relationships, complementarity, and cross-sell potential.

INPUT: Destination name, list of available experiences or tour types.

PROCESS:
1. Map all experience types available in the destination
2. Identify natural pairings: experiences commonly combined by travellers
3. Identify experience sequences: logical progression from one to another
4. Map audience overlap: which traveller segments want multiple experiences
5. Design cross-sell paths: which experience leads naturally to which upsell

OUTPUT FORMAT: JSON with keys: experience_inventory[], natural_pairings[], experience_sequences[], audience_overlap_map{}, crosssell_paths[], package_building_opportunities[]`,
  },
  {
    logic_key: "tourism_growth_strategy_engine",
    display_name: "Tourism Growth Strategy Engine",
    source_doc_id: "1QB7H7ghTfz8Pkmo5OOxYxXLWTndNl-P0",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Tourism Growth Strategy Engine. Your role is to design a comprehensive growth strategy for a travel brand — covering market expansion, revenue scaling, and competitive positioning.

INPUT: Brand name, current revenue/scale, target growth horizon (1/3/5 years), market position, available resources.

PROCESS:
1. Define the growth ambition: revenue targets, market position goals
2. Assess growth levers: new markets, new products, new channels, pricing, partnerships
3. Build growth scenarios: conservative / target / aggressive
4. Identify constraints: capacity, capital, talent, market readiness
5. Design a phased growth roadmap with milestones and KPIs

OUTPUT FORMAT: JSON with keys: growth_ambition, growth_levers[], growth_scenarios{conservative, target, aggressive}, constraints[], growth_roadmap{phases[]}, success_metrics[]`,
  },
  {
    logic_key: "content_calendar_engine",
    display_name: "Content Calendar Engine",
    source_doc_id: "1qTPc1CaZmRjAHOzX_v6k_G7hd2URVQEB",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Content Calendar Engine. Your role is to build a structured content calendar for a travel brand — planning topics, formats, channels, and timing across a year.

INPUT: Brand name, destination focus, marketing objectives, content team capacity, key dates/events.

PROCESS:
1. Map key dates: seasonality peaks, local events, global travel moments, booking windows
2. Define content themes by month aligned to demand and booking patterns
3. Assign content types per theme: guide, video, social series, email, PR
4. Plan production timeline: brief → draft → review → publish → promote
5. Build the calendar matrix: month × content type × channel

OUTPUT FORMAT: JSON with keys: annual_themes[], monthly_plan[] (each: month, theme, content_pieces[], channels[], key_dates[]), production_timeline_days, kpis[]`,
  },
  {
    logic_key: "trust_signal_analyzer",
    display_name: "Trust Signal Analyzer",
    source_doc_id: "1DLZKSxWzqbD_8NlookvSYbBHcv29ZVw2",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Trust Signal Analyzer. Your role is to audit and improve the trust signals of a travel brand — the credibility indicators that convert hesitant visitors into confident buyers.

INPUT: Brand name, website URL or description, booking model, available reviews/awards/certifications.

PROCESS:
1. Audit current trust signals: reviews, ratings, certifications, press mentions, guarantees, social proof
2. Score current trust level by category: social proof, credentials, transparency, security
3. Identify trust gaps: what's missing that buyers expect in this market
4. Benchmark against trust leaders in the segment
5. Recommend a trust-building action plan with priority and effort ratings

OUTPUT FORMAT: JSON with keys: trust_signal_audit{}, trust_scores_by_category{}, trust_gaps[], benchmark_comparison{}, action_plan[], overall_trust_score (0-10)`,
  },
  {
    logic_key: "travel_trend_detector",
    display_name: "Travel Trend Detector",
    source_doc_id: "1EPds1MvV3NfGSi0nmb1W_3wvZDFI_J5I",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Travel Trend Detector. Your role is to identify and analyse emerging trends in travel that a brand can capitalise on — from consumer behaviour shifts to product innovations.

INPUT: Market segment, destination focus, time horizon (near-term / medium / long-term).

PROCESS:
1. Identify macro trends: sustainability, experience economy, remote work travel, wellness, etc.
2. Identify micro trends specific to the destination or segment
3. Assess trend maturity: emerging / growing / peak / declining
4. Map trend fit: how well does the brand align with each trend?
5. Recommend trend-capitalisation strategies for the top 3 relevant trends

OUTPUT FORMAT: JSON with keys: macro_trends[], micro_trends[], trend_maturity_map{}, brand_alignment_scores{}, top_opportunities[], trend_capitalisation_strategies[]`,
  },
  {
    logic_key: "consulting_report_generator",
    display_name: "Consulting Report Generator",
    source_doc_id: "1E3q1ueVaLm2CnPs9s4QT7KKH_ERniKJ5",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Consulting Report Generator. Your role is to synthesise all analysis from the engine suite into a professional consulting report — the kind a premium strategy consultancy would deliver.

INPUT: Brand name, analysis results from other engines (as context), report scope, audience (internal/client/investor).

PROCESS:
1. Write an Executive Summary: situation, key findings, top 3 recommendations
2. Compile the Situation Analysis: market, brand, competitive context
3. Present Key Findings: organised by theme (brand, SEO, revenue, product, growth)
4. Develop Recommendations: strategic + tactical, with rationale and expected impact
5. Provide an Implementation Roadmap: phased, with owners, timeline, and KPIs

OUTPUT FORMAT: Structured markdown report with: Executive Summary, Situation Analysis, Key Findings, Recommendations (strategic + tactical), Implementation Roadmap, Appendix (data sources)`,
  },
  {
    logic_key: "scoring_system",
    display_name: "Scoring System",
    source_doc_id: "1HbHW9qYxBhKOEnVAHkOlwYuqY-2xGruX",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Scoring System. Your role is to score a travel brand across all strategic dimensions — producing a Brand Health Score and dimension-level sub-scores for tracking progress over time.

INPUT: Brand name, outputs from any combination of other engines (brand, SEO, product, market, revenue, trust, content).

PROCESS:
1. Score each dimension (0-10): Brand Clarity, Market Position, SEO Authority, Product Quality, Revenue Optimisation, Trust Signals, Content Effectiveness, Growth Readiness
2. Weight dimensions by brand maturity stage
3. Calculate an overall Brand Health Score
4. Compare to previous scores (if provided) and show trajectory
5. Flag priority improvement areas where score is below threshold

OUTPUT FORMAT: JSON with keys: brand_health_score (0-100), dimension_scores{}, maturity_weights{}, score_trajectory{}, priority_improvements[], benchmark_comparison{}`,
  },
  {
    logic_key: "travel_experience_mapper",
    display_name: "Travel Experience Mapper",
    source_doc_id: "1Pj9rO-TmylBck-R3eQL1nBqjrPwVM63D",
    knowledge_folder_id: "1pSRHXZwc3B2N2tEvP40g27kpUJNcnRVh",
    system_prompt: `You are the Travel Experience Mapper. Your role is to map the complete traveller journey and experience for a destination or brand — from inspiration to post-trip advocacy.

INPUT: Destination name or brand name, target traveller profile, key touchpoints or available services.

PROCESS:
1. Map the traveller journey stages: Dream → Research → Book → Pre-trip → In-destination → Post-trip
2. For each stage, identify: traveller goals, pain points, brand touchpoints, emotional state
3. Identify moments of truth: the high-impact interactions that shape loyalty
4. Map service design gaps: where the experience falls short of traveller expectation
5. Recommend experience design improvements at each stage

OUTPUT FORMAT: JSON with keys: journey_stages[]{stage, goals, pain_points, touchpoints, emotional_state}, moments_of_truth[], service_gaps[], experience_improvements[], overall_experience_score (0-10)`,
  },
];

async function upsertEngineRows() {
  console.log("\n── Step 3: Upsert engine rows ───────────────────────────────");
  for (const r of ENGINE_ROWS) {
    const [[existing]] = await pool.execute(
      "SELECT logic_id, body_json FROM `logic_definitions` WHERE logic_key = ? LIMIT 1",
      [r.logic_key]
    );

    if (existing) {
      // Merge system_prompt into existing body_json, preserving other fields
      let bodyJson = {};
      try { bodyJson = JSON.parse(existing.body_json || "{}"); } catch {}
      bodyJson.system_prompt = r.system_prompt;

      console.log(`  UPDATE ${r.logic_key}`);
      await query(
        `UPDATE \`logic_definitions\`
         SET display_name = ?,
             body_json = ?,
             source_doc_id = ?,
             knowledge_folder_id = ?,
             updated_at = NOW()
         WHERE logic_key = ?`,
        [r.display_name, JSON.stringify(bodyJson), r.source_doc_id, r.knowledge_folder_id, r.logic_key]
      );
    } else {
      const bodyJson = JSON.stringify({ system_prompt: r.system_prompt });
      console.log(`  INSERT ${r.logic_key}`);
      await query(
        `INSERT INTO \`logic_definitions\`
           (logic_id, logic_key, display_name, logic_type, body_json, status,
            source_doc_id, knowledge_folder_id)
         VALUES (UUID(), ?, ?, 'execution', ?, 'active', ?, ?)`,
        [r.logic_key, r.display_name, bodyJson, r.source_doc_id, r.knowledge_folder_id]
      );
    }
  }
}

// ── Step 4: business_type_profiles ───────────────────────────────────────────

const BUSINESS_TYPE_ROWS = [
  {
    business_type_key: "travel",
    knowledge_profile_key: "travel_knowledge_profile",
    supported_engine_categories: "product_intelligence|market_intelligence|brand_intelligence|seo_engines|revenue_engines|innovation_engines|marketing_engines|content_engines|report_engines",
    authoritative_read_home: "1fIma1cjAM2kbe9GVUFurJ2zZL1IB1rfT",
    business_type_specific_read_home: "1fIma1cjAM2kbe9GVUFurJ2zZL1IB1rfT",
    shared_knowledge_read_home: "1fIma1cjAM2kbe9GVUFurJ2zZL1IB1rfT",
    compatible_route_keys: "brand_strategy|seo_audit|content_creation|market_analysis|revenue_optimisation",
    compatible_workflows: "content_workflow|brand_intelligence_workflow|seo_workflow",
    profile_status: "active",
    notes: "Travel & tourism business type. Drive folder: 1fIma1cjAM2kbe9GVUFurJ2zZL1IB1rfT",
    active: 1,
  },
  {
    business_type_key: "hvac_air_conditioning_services",
    knowledge_profile_key: "hvac_knowledge_profile",
    supported_engine_categories: "market_intelligence|brand_intelligence|seo_engines|marketing_engines|content_engines|report_engines",
    authoritative_read_home: "1V080lgt_QM01Bwla0NFQWCBeKPZmgnEZ",
    business_type_specific_read_home: "1V080lgt_QM01Bwla0NFQWCBeKPZmgnEZ",
    shared_knowledge_read_home: "1V080lgt_QM01Bwla0NFQWCBeKPZmgnEZ",
    compatible_route_keys: "brand_strategy|seo_audit|content_creation|local_seo",
    compatible_workflows: "content_workflow|brand_intelligence_workflow",
    profile_status: "active",
    notes: "HVAC / Air Conditioning Services business type. Drive folder: 1V080lgt_QM01Bwla0NFQWCBeKPZmgnEZ",
    active: 1,
  },
];

async function upsertBusinessTypeProfiles() {
  console.log("\n── Step 4: Upsert business_type_profiles ────────────────────");

  // Check if table exists first
  const [[tableCheck]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_type_profiles'`
  );
  if (!tableCheck?.cnt) {
    console.log("  SKIP — business_type_profiles table does not exist (run Sheets migration first)");
    return;
  }

  // Get columns to build a safe INSERT
  const [cols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_type_profiles'`
  );
  const existingCols = new Set(cols.map(r => r.COLUMN_NAME));

  for (const r of BUSINESS_TYPE_ROWS) {
    const [[existing]] = await pool.execute(
      "SELECT business_type_key FROM `business_type_profiles` WHERE business_type_key = ? OR knowledge_profile_key = ? LIMIT 1",
      [r.business_type_key, r.knowledge_profile_key]
    );

    if (existing) {
      console.log(`  UPDATE ${r.business_type_key}`);
      const updates = [];
      const vals = [];
      for (const [k, v] of Object.entries(r)) {
        if (k !== "business_type_key" && existingCols.has(k)) {
          updates.push(`\`${k}\` = ?`);
          vals.push(v);
        }
      }
      if (updates.length) {
        vals.push(r.business_type_key);
        await query(
          `UPDATE \`business_type_profiles\` SET ${updates.join(", ")} WHERE business_type_key = ?`,
          vals
        );
      }
    } else {
      console.log(`  INSERT ${r.business_type_key}`);
      const keys = Object.keys(r).filter(k => existingCols.has(k));
      const vals = keys.map(k => r[k]);
      await query(
        `INSERT INTO \`business_type_profiles\` (${keys.map(k => `\`${k}\``).join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`,
        vals
      );
    }
  }
}

// ── Step 5: brand_paths ───────────────────────────────────────────────────────

async function upsertBrandPaths() {
  console.log("\n── Step 5: Upsert brand_paths ───────────────────────────────");

  const [[tableCheck]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brand_paths'`
  );
  if (!tableCheck?.cnt) {
    console.log("  SKIP — brand_paths table does not exist (run Sheets migration first)");
    return;
  }

  const brandPath = {
    brand_key: "arab_cooling",
    normalized_brand_name: "arab_cooling",
    business_type_key: "hvac_air_conditioning_services",
    knowledge_profile_key: "hvac_knowledge_profile",
    brand_folder_id: "1B8kXli5t1se0zuQ7KnrYMJ2N3lfCgVEq",
    brand_folder_path: "HVAC-Air-Conditioning-Services/Arab Cooling",
    brand_core_docs_json: JSON.stringify({
      "identity-core-assets": "1yVwfv50MWMa5g0VMmksGxZksSNAkRZYT",
      "source-documents": "11Cn2NAdg2z9LEHOLZYiWxjG4nhP84gA9",
      "media-visuals": "11aFEAzDR8VX9bopltPDs8pLmQRJTSbzn",
      "proof-trust-evidence": "1KXnLSA3lPHo8c2YjjgnAr0oVl1r7oer6",
      "legal-policy-reference": "1DDzJuVBRFA0NBfXfpheDVwWSRMMzNReZ",
      "offers-products": "1PVBVgpCpTxM1xt_S6bShv4vC2PJWbuJ2",
    }),
    target_key: "arab_cooling",
    base_url: null,
    status: "active",
    active: 1,
  };

  const [cols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brand_paths'`
  );
  const existingCols = new Set(cols.map(r => r.COLUMN_NAME));

  const [[existing]] = await pool.execute(
    "SELECT brand_key FROM `brand_paths` WHERE brand_key = ? LIMIT 1",
    [brandPath.brand_key]
  );

  if (existing) {
    console.log(`  UPDATE ${brandPath.brand_key}`);
    const updates = [];
    const vals = [];
    for (const [k, v] of Object.entries(brandPath)) {
      if (k !== "brand_key" && existingCols.has(k)) {
        updates.push(`\`${k}\` = ?`);
        vals.push(v);
      }
    }
    if (updates.length) {
      vals.push(brandPath.brand_key);
      await query(
        `UPDATE \`brand_paths\` SET ${updates.join(", ")} WHERE brand_key = ?`,
        vals
      );
    }
  } else {
    console.log(`  INSERT ${brandPath.brand_key}`);
    const keys = Object.keys(brandPath).filter(k => existingCols.has(k));
    const vals = keys.map(k => brandPath[k]);
    await query(
      `INSERT INTO \`brand_paths\` (${keys.map(k => `\`${k}\``).join(", ")})
       VALUES (${keys.map(() => "?").join(", ")})`,
      vals
    );
  }
}

// ── Step 6: brand_core (07-brand-assets subfolders) ──────────────────────────

const BRAND_CORE_ROWS = [
  {
    brand_key: "arab_cooling",
    asset_key: "identity-core-assets",
    asset_class: "brand_identity",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Identity Core Assets",
    "Document Name": "Arab Cooling — Identity Core Assets",
    "Google Drive Link": `https://drive.google.com/drive/folders/1yVwfv50MWMa5g0VMmksGxZksSNAkRZYT`,
    "Core Function": "Brand identity documents: logos, fonts, colour palettes, brand guidelines",
    "Used By Systems": "brand_intelligence_workflow|content_workflow",
    "Priority": "1",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "1yVwfv50MWMa5g0VMmksGxZksSNAkRZYT",
    status: "active",
  },
  {
    brand_key: "arab_cooling",
    asset_key: "source-documents",
    asset_class: "reference_document",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Source Documents",
    "Document Name": "Arab Cooling — Source Documents",
    "Google Drive Link": `https://drive.google.com/drive/folders/11Cn2NAdg2z9LEHOLZYiWxjG4nhP84gA9`,
    "Core Function": "Brand source documents: briefing docs, strategy papers, market research",
    "Used By Systems": "brand_intelligence_workflow",
    "Priority": "2",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "11Cn2NAdg2z9LEHOLZYiWxjG4nhP84gA9",
    status: "active",
  },
  {
    brand_key: "arab_cooling",
    asset_key: "media-visuals",
    asset_class: "media",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Media & Visuals",
    "Document Name": "Arab Cooling — Media & Visuals",
    "Google Drive Link": `https://drive.google.com/drive/folders/11aFEAzDR8VX9bopltPDs8pLmQRJTSbzn`,
    "Core Function": "Photos, videos, graphics for use across marketing channels",
    "Used By Systems": "content_workflow",
    "Priority": "3",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "11aFEAzDR8VX9bopltPDs8pLmQRJTSbzn",
    status: "active",
  },
  {
    brand_key: "arab_cooling",
    asset_key: "proof-trust-evidence",
    asset_class: "trust_signal",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Proof & Trust Evidence",
    "Document Name": "Arab Cooling — Proof & Trust Evidence",
    "Google Drive Link": `https://drive.google.com/drive/folders/1KXnLSA3lPHo8c2YjjgnAr0oVl1r7oer6`,
    "Core Function": "Reviews, testimonials, certifications, awards, case studies",
    "Used By Systems": "brand_intelligence_workflow|content_workflow",
    "Priority": "4",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "1KXnLSA3lPHo8c2YjjgnAr0oVl1r7oer6",
    status: "active",
  },
  {
    brand_key: "arab_cooling",
    asset_key: "legal-policy-reference",
    asset_class: "legal_compliance",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Legal & Policy Reference",
    "Document Name": "Arab Cooling — Legal & Policy Reference",
    "Google Drive Link": `https://drive.google.com/drive/folders/1DDzJuVBRFA0NBfXfpheDVwWSRMMzNReZ`,
    "Core Function": "Terms of service, privacy policy, compliance documents",
    "Used By Systems": "compliance_workflow",
    "Priority": "5",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "1DDzJuVBRFA0NBfXfpheDVwWSRMMzNReZ",
    status: "active",
  },
  {
    brand_key: "arab_cooling",
    asset_key: "offers-products",
    asset_class: "product_catalogue",
    "Brand Name": "Arab Cooling",
    "Asset Type": "Offers & Products",
    "Document Name": "Arab Cooling — Offers & Products",
    "Google Drive Link": `https://drive.google.com/drive/folders/1PVBVgpCpTxM1xt_S6bShv4vC2PJWbuJ2`,
    "Core Function": "Product/service catalogue, pricing, offer sheets",
    "Used By Systems": "content_workflow|revenue_workflow",
    "Priority": "6",
    authoritative_home: "drive",
    read_priority: "primary",
    mirror_policy: "read-only",
    validation_status: "active",
    active_status: "active",
    registry_role: "brand_core",
    doc_id: "1PVBVgpCpTxM1xt_S6bShv4vC2PJWbuJ2",
    status: "active",
  },
];

async function upsertBrandCore() {
  console.log("\n── Step 6: Upsert brand_core rows ───────────────────────────");

  const [[tableCheck]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brand_core'`
  );
  if (!tableCheck?.cnt) {
    console.log("  SKIP — brand_core table does not exist (run Sheets migration first)");
    return;
  }

  const [cols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brand_core'`
  );
  const existingCols = new Set(cols.map(r => r.COLUMN_NAME));

  for (const r of BRAND_CORE_ROWS) {
    const [[existing]] = await pool.execute(
      "SELECT brand_key FROM `brand_core` WHERE brand_key = ? AND asset_key = ? LIMIT 1",
      [r.brand_key, r.asset_key]
    );

    // Filter to only columns that exist in the table
    const filteredRow = Object.fromEntries(
      Object.entries(r).filter(([k]) => existingCols.has(k))
    );

    if (existing) {
      console.log(`  UPDATE ${r.brand_key} / ${r.asset_key}`);
      const { brand_key, asset_key, ...updateFields } = filteredRow;
      const updates = Object.keys(updateFields).map(k => `\`${k}\` = ?`);
      const vals = [...Object.values(updateFields), r.brand_key, r.asset_key];
      if (updates.length) {
        await query(
          `UPDATE \`brand_core\` SET ${updates.join(", ")} WHERE brand_key = ? AND asset_key = ?`,
          vals
        );
      }
    } else {
      console.log(`  INSERT ${r.brand_key} / ${r.asset_key}`);
      const keys = Object.keys(filteredRow);
      const vals = keys.map(k => filteredRow[k]);
      await query(
        `INSERT INTO \`brand_core\` (${keys.map(k => `\`${k}\``).join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`,
        vals
      );
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await alterLogicDefinitions();
    await upsertGptLogicRows();
    await upsertEngineRows();
    await upsertBusinessTypeProfiles();
    await upsertBrandPaths();
    await upsertBrandCore();

    console.log("\n── Done ─────────────────────────────────────────────────────");
    if (APPLY) {
      console.log("All changes written to DB.");
    } else {
      console.log("Dry-run complete. Run with --apply to write.");
    }
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
