#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function clean(value = "") { return String(value ?? "").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run" };
  let applySeen = false;
  let drySeen = false;
  for (const arg of argv) {
    if (arg === "--apply") { args.mode = "apply"; applySeen = true; continue; }
    if (arg === "--dry-run") { args.mode = "dry_run"; drySeen = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  if (applySeen && drySeen) throw new Error("Conflicting mode flags: use either --dry-run or --apply, not both.");
  return args;
}
function required(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  if (/[\0\r\n]/.test(value)) throw new Error(`${key} contains invalid control characters`);
  return value;
}
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function statOrNull(p) { try { return await fs.stat(p); } catch { return null; } }

const REQUIRED_DIRS = [
  "artifacts",
  "manifests",
  "restore-tests",
  path.join("restore-tests", "db-isolated"),
  path.join("restore-tests", "code-clean-checkout"),
  "logs"
];

async function main() {
  const args = parseArgs();
  const root = path.resolve(required(args, "root"));
  const locationKey = clean(args.location_key || "local:Essam:growth-os-backups");
  const apply = args.mode === "apply";
  const rootStat = await statOrNull(root);
  if (rootStat && !rootStat.isDirectory()) throw new Error(`root exists but is not a directory: ${root}`);

  const plan = [];
  if (!rootStat) plan.push({ type: "mkdir", path: root });
  for (const rel of REQUIRED_DIRS) {
    const abs = path.join(root, rel);
    const st = await statOrNull(abs);
    if (!st) plan.push({ type: "mkdir", path: abs });
    else if (!st.isDirectory()) plan.push({ type: "conflict", path: abs, reason: "expected_directory" });
  }

  const markerPath = path.join(root, ".growth-os-backup-destination.json");
  const marker = {
    schema: "backup-destination/v1",
    location_key: locationKey,
    purpose: "platform_backup_destination",
    no_backup_artifact_created: true,
    required_subdirectories: REQUIRED_DIRS.map((p) => p.split(path.sep).join("/")),
    created_or_validated_at: new Date().toISOString()
  };

  const conflicts = plan.filter((item) => item.type === "conflict");
  if (apply && conflicts.length === 0) {
    await fs.mkdir(root, { recursive: true });
    for (const rel of REQUIRED_DIRS) await fs.mkdir(path.join(root, rel), { recursive: true });
    await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  }

  const result = {
    ok: conflicts.length === 0,
    mode: apply ? "apply" : "dry-run",
    root,
    locationKey,
    markerPath,
    requiredDirectories: REQUIRED_DIRS,
    plannedActions: plan,
    conflicts,
    noBackupArtifactCreated: true
  };
  console.log(JSON.stringify(result, null, 2));
  if (conflicts.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_backup_destination_prepare_failed", message: err.message } }, null, 2));
  process.exitCode = 1;
});
