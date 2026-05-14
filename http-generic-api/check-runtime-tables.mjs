import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envLines = readFileSync(resolve(__dirname, ".env"), "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const { getPool } = await import("./db.js");
const pool = getPool();

const tables = [
  "task_routes", "workflows", "site_runtime_inventory",
  "site_settings_inventory", "plugins", "registry_surfaces_catalog",
  "execution_policies", "validation_repair", "json_assets"
];

for (const t of tables) {
  try {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
    console.log(`${t}: ${row.cnt} rows`);
  } catch (e) {
    console.log(`${t}: ERROR — ${e.message}`);
  }
}
await pool.end();
