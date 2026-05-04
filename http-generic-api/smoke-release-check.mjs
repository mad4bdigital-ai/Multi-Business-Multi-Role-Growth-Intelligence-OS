import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {}

import { runReleaseReadiness } from "./releaseReadiness.js";

const r = await runReleaseReadiness({ persist: true });
console.log("Overall:", r.overall);
console.log("Summary:", JSON.stringify(r.summary, null, 2));

const failed = Object.entries(r.platform_tables).filter(([,v]) => v.status !== "pass");
if (failed.length) {
  console.log("\nFAILED/WARN platform tables:");
  failed.forEach(([k,v]) => console.log(" ", v.status.toUpperCase(), k, "-", v.detail));
}

const seedIssues = Object.entries(r.seed_data).filter(([,v]) => v.status !== "pass");
if (seedIssues.length) {
  console.log("\nSeed data issues:");
  seedIssues.forEach(([k,v]) => console.log(" ", v.status.toUpperCase(), k, "-", v.detail));
}

if (r.migration_inventory.status !== "pass") {
  console.log("\nMigration inventory:", r.migration_inventory.detail);
}

process.exit(r.overall === "fail" ? 1 : 0);
