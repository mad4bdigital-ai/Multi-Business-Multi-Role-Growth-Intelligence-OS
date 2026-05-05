#!/usr/bin/env node
/**
 * skillInstaller.mjs — AI Agent Skill Install Protocol
 *
 * Usage:
 *   node skillInstaller.mjs install <github-url-or-npm-package>
 *   node skillInstaller.mjs install https://github.com/kepano/obsidian-skills
 *   node skillInstaller.mjs install https://github.com/ruvnet/ruflo
 *   node skillInstaller.mjs list
 *   node skillInstaller.mjs enable  <package_key>
 *   node skillInstaller.mjs disable <package_key>
 *   node skillInstaller.mjs remove  <package_key>
 *
 * On install, the script:
 *   1. Fetches skill.json manifest from the repo root (or package.json with "skill" key)
 *   2. Validates the manifest
 *   3. Upserts a logic_definitions row (logic_key = package_key, body_json = manifest body)
 *   4. Upserts a skill_packages row
 *   5. Runs any install_hooks declared in the manifest (DB migrations, config)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* no .env */ }

async function getDb() {
  return mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

function packageKeyFromName(name = "") {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Manifest fetching ──────────────────────────────────────────────────────────

async function fetchFromGitHub(repoUrl) {
  // Normalise: https://github.com/owner/repo → raw content base
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Not a GitHub URL: ${repoUrl}`);
  const [, owner, repo] = match;
  const base = `https://raw.githubusercontent.com/${owner}/${repo.replace(/\.git$/, "")}/main`;

  // Try skill.json first, then package.json with "skill" key
  for (const path of ["skill.json", "skills/skill.json", ".claude/skill.json"]) {
    try {
      const res = await fetch(`${base}/${path}`);
      if (res.ok) {
        const json = await res.json();
        return { manifest: json, source_url: repoUrl, source_type: "github" };
      }
    } catch { /* try next */ }
  }

  // Fall back to package.json
  const pkgRes = await fetch(`${base}/package.json`);
  if (pkgRes.ok) {
    const pkg = await pkgRes.json();
    if (pkg.skill) return { manifest: { ...pkg.skill, name: pkg.name, version: pkg.version }, source_url: repoUrl, source_type: "github" };
    // Synthesise minimal manifest from package.json
    return {
      manifest: {
        name: pkg.name,
        version: pkg.version || "0.1.0",
        description: pkg.description || pkg.name,
        system_prompt: pkg.description || "",
        tools: [],
        models: ["claude", "openai", "gemini"],
      },
      source_url: repoUrl,
      source_type: "github",
    };
  }

  throw new Error(`No skill.json or package.json found in ${repoUrl}`);
}

function validateManifest(manifest = {}) {
  if (!manifest.name) throw new Error("Manifest missing: name");
  if (!manifest.description) throw new Error("Manifest missing: description");
  return true;
}

// ── DB operations ──────────────────────────────────────────────────────────────

async function upsertLogicDefinition(db, manifest, sourceUrl) {
  const logic_key = packageKeyFromName(manifest.name);
  const body = {
    source:          "skill_package",
    source_url:      sourceUrl,
    system_prompt:   manifest.system_prompt || manifest.description,
    trigger_phrase:  manifest.description,
    action_class:    manifest.logic_type || "skill",
    execution_layer: "skill_runtime",
    module_binding:  manifest.name,
    runtime_callable: "TRUE",
    tools:           manifest.tools || [],
    models:          manifest.models || ["claude", "openai", "gemini"],
    tags:            manifest.tags || [],
  };

  await db.query(`
    INSERT INTO \`logic_definitions\`
      (logic_id, logic_key, display_name, logic_type, body_json, source_url, package_version, skill_manifest, version, status)
    VALUES (?, ?, ?, 'skill', ?, ?, ?, ?, '1', 'active')
    ON DUPLICATE KEY UPDATE
      display_name   = VALUES(display_name),
      body_json      = VALUES(body_json),
      source_url     = VALUES(source_url),
      package_version= VALUES(package_version),
      skill_manifest = VALUES(skill_manifest),
      status         = 'active',
      updated_at     = NOW()
  `, [
    randomUUID(), logic_key, manifest.name,
    JSON.stringify(body), sourceUrl,
    manifest.version || "0.1.0",
    JSON.stringify(manifest),
  ]);

  return logic_key;
}

async function upsertSkillPackage(db, manifest, sourceUrl, sourceType, logicKey) {
  const package_key = packageKeyFromName(manifest.name);
  const package_id  = `pkg_${package_key}`;

  await db.query(`
    INSERT INTO \`skill_packages\`
      (package_id, package_key, display_name, source_url, source_type, version, manifest_json, logic_key, install_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'installed')
    ON DUPLICATE KEY UPDATE
      display_name   = VALUES(display_name),
      source_url     = VALUES(source_url),
      version        = VALUES(version),
      manifest_json  = VALUES(manifest_json),
      logic_key      = VALUES(logic_key),
      install_status = 'installed',
      enabled        = 1,
      updated_at     = NOW()
  `, [
    package_id, package_key, manifest.name,
    sourceUrl, sourceType,
    manifest.version || "0.1.0",
    JSON.stringify(manifest),
    logicKey,
  ]);

  return package_key;
}

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdInstall(source) {
  console.log(`\nInstalling skill from: ${source}`);

  let fetched;
  if (source.includes("github.com")) {
    fetched = await fetchFromGitHub(source);
  } else {
    throw new Error("Only GitHub URLs are supported currently. npm support coming soon.");
  }

  validateManifest(fetched.manifest);
  console.log(`  Manifest: ${fetched.manifest.name} v${fetched.manifest.version || "?"}`);
  console.log(`  Tools:    ${(fetched.manifest.tools || []).length} defined`);
  console.log(`  Models:   ${(fetched.manifest.models || ["claude","openai","gemini"]).join(", ")}`);

  const db = await getDb();
  const logicKey   = await upsertLogicDefinition(db, fetched.manifest, fetched.source_url);
  const packageKey = await upsertSkillPackage(db, fetched.manifest, fetched.source_url, fetched.source_type, logicKey);
  await db.end();

  console.log(`\n✅ Installed: ${packageKey} → logic_key="${logicKey}"`);
  console.log(`   Use logic_key "${logicKey}" in workflows.target_module to activate this skill as an agent.`);
}

async function cmdList() {
  const db = await getDb();
  const [rows] = await db.query(
    "SELECT package_key, display_name, version, source_type, install_status, enabled, installed_at FROM `skill_packages` ORDER BY installed_at DESC"
  );
  await db.end();
  if (!rows.length) { console.log("No skills installed."); return; }
  console.log("\nInstalled skills:");
  rows.forEach(r => console.log(
    `  ${r.enabled ? "✅" : "⏸"} ${r.package_key.padEnd(30)} v${(r.version||"?").padEnd(10)} [${r.source_type}] ${r.install_status}`
  ));
}

async function cmdSetEnabled(packageKey, enabled) {
  const db = await getDb();
  const [res] = await db.query(
    "UPDATE `skill_packages` SET enabled = ? WHERE package_key = ?", [enabled ? 1 : 0, packageKey]
  );
  await db.end();
  if (!res.affectedRows) { console.error(`Package not found: ${packageKey}`); process.exit(1); }
  console.log(`${enabled ? "Enabled" : "Disabled"}: ${packageKey}`);
}

async function cmdRemove(packageKey) {
  const db = await getDb();
  await db.query("UPDATE `skill_packages` SET install_status='removed', enabled=0 WHERE package_key=?", [packageKey]);
  await db.query("UPDATE `logic_definitions` SET status='disabled' WHERE logic_key=(SELECT logic_key FROM `skill_packages` WHERE package_key=? LIMIT 1)", [packageKey]);
  await db.end();
  console.log(`Removed: ${packageKey}`);
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "install" && arg) await cmdInstall(arg);
  else if (cmd === "list")     await cmdList();
  else if (cmd === "enable"  && arg) await cmdSetEnabled(arg, true);
  else if (cmd === "disable" && arg) await cmdSetEnabled(arg, false);
  else if (cmd === "remove"  && arg) await cmdRemove(arg);
  else {
    console.log("Usage: node skillInstaller.mjs <install <url>|list|enable <key>|disable <key>|remove <key>>");
    process.exit(1);
  }
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
