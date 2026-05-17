#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

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

function clean(value = "") {
  return String(value ?? "").trim();
}

function required(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  if (/[\0\r\n]/.test(value)) throw new Error(`${key} contains invalid control characters`);
  return value;
}

function splitList(value = "") {
  return clean(value).split(/[;,]/).map(v => v.trim()).filter(Boolean);
}

function usage() {
  return `Usage:\n\nnode scripts/local-project-path-repair.mjs \\\n  --source-path=<old_or_source_path> \\\n  --target-path=<new_or_partial_path> \\\n  [--markers=.git,package.json] \\\n  [--exclude=node_modules,.cache,dist,coverage] \\\n  [--manifest-path=<path>] \\\n  [--apply|--dry-run]\n\nDefault is dry-run. Apply mode copies missing files only and never deletes the source path.`;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function statOrNull(p) {
  try { return await fs.stat(p); } catch { return null; }
}

function shouldExclude(rel, excludes) {
  const normalized = rel.split(path.sep).join("/");
  return excludes.some(ex => normalized === ex || normalized.startsWith(`${ex}/`) || normalized.includes(`/${ex}/`));
}

async function walk(root, excludes, prefix = "") {
  const out = [];
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(prefix, entry.name);
    if (shouldExclude(rel, excludes)) continue;
    const abs = path.join(root, rel);
    if (entry.isDirectory()) {
      out.push(...await walk(root, excludes, rel));
    } else if (entry.isFile()) {
      const st = await fs.stat(abs);
      out.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

async function sha256File(file) {
  const data = await fs.readFile(file);
  return createHash("sha256").update(data).digest("hex");
}

async function copyMissingFile(sourceAbs, targetAbs) {
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.copyFile(sourceAbs, targetAbs, fs.constants.COPYFILE_EXCL);
}

async function main() {
  const args = parseArgs();
  const sourcePath = path.resolve(required(args, "source_path"));
  const targetPath = path.resolve(required(args, "target_path"));
  const markers = splitList(args.markers || ".git,package.json");
  const excludes = splitList(args.exclude || "node_modules,.cache,dist,coverage");
  const apply = args.mode === "apply";
  const manifestPath = path.resolve(clean(args.manifest_path || path.join(targetPath, ".mad4b-local-path-repair.json")));

  if (!(await exists(sourcePath))) throw new Error(`source_path does not exist: ${sourcePath}`);
  if (!(await exists(targetPath))) throw new Error(`target_path does not exist: ${targetPath}`);

  const markerStatus = [];
  for (const marker of markers) {
    markerStatus.push({ marker, source: await exists(path.join(sourcePath, marker)), target: await exists(path.join(targetPath, marker)) });
  }

  const sourceFiles = await walk(sourcePath, excludes);
  const missing = [];
  const conflicts = [];
  let checked = 0;

  for (const file of sourceFiles) {
    checked += 1;
    const targetAbs = path.join(targetPath, file.rel);
    const targetStat = await statOrNull(targetAbs);
    if (!targetStat) {
      missing.push(file);
      continue;
    }
    if (targetStat.size !== file.size) {
      conflicts.push({ rel: file.rel, sourceSize: file.size, targetSize: targetStat.size });
    }
  }

  let copied = 0;
  if (apply) {
    for (const file of missing) {
      await copyMissingFile(file.abs, path.join(targetPath, file.rel));
      copied += 1;
    }
  }

  const manifest = {
    ok: true,
    repair_run_id: randomUUID(),
    mode: apply ? "apply" : "dry-run",
    sourcePath,
    targetPath,
    markers: markerStatus,
    excludes,
    filesChecked: checked,
    filesMissing: missing.length,
    filesCopied: copied,
    conflictsFound: conflicts.length,
    missingPreview: missing.slice(0, 50).map(f => ({ rel: f.rel, size: f.size })),
    conflictsPreview: conflicts.slice(0, 50),
    warnings: [
      "This script never deletes the source path.",
      "Apply mode copies missing files only; conflicting files are reported but not overwritten."
    ],
    createdAt: new Date().toISOString()
  };

  if (apply || clean(args.write_manifest) === "true") {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    manifest.manifestPath = manifestPath;
  }

  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_project_path_repair_failed", message: err.message }, usage: usage() }, null, 2));
  process.exitCode = 1;
});
