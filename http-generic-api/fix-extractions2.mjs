/**
 * Fixes truncated functions in governed.js and registry.js.
 */
import { readFileSync, writeFileSync } from "fs";

const SERVER = readFileSync("server.js", "utf8");
const serverLines = SERVER.split("\n");

function stripForBraces(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/\[[^\]]*\]/g, "[]")
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''")
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, "``")
    .replace(/\$\{[^}]*\}/g, "");
}

function extractFunctionFrom(startLine0) {
  const lines = [];
  let depth = 0;
  let bodyStarted = false;
  for (let i = startLine0; i < serverLines.length; i++) {
    lines.push(serverLines[i]);
    const s = stripForBraces(serverLines[i]);
    for (const ch of s) {
      if (ch === "{") { depth++; bodyStarted = true; }
      else if (ch === "}") depth--;
    }
    if (bodyStarted && depth <= 0) break;
  }
  return lines.join("\n");
}

// ── Fix governed.js: readRelevantExistingRowWindow truncated at line 277 ──────
{
  const content = readFileSync("governed.js", "utf8");
  const fnName = "readRelevantExistingRowWindow";
  const serverLine = 2531 - 1; // 0-indexed
  const fullFn = "export " + extractFunctionFrom(serverLine);
  console.log(`${fnName}: ${fullFn.split("\n").length} lines from server.js`);

  // The truncated version is just the signature line with no body
  const truncated = "export async function readRelevantExistingRowWindow(\n\nexport function normalizeSemanticValue";
  const fixed = content.replace(
    /export async function readRelevantExistingRowWindow\(\n\nexport function normalizeSemanticValue/,
    fullFn + "\n\nexport function normalizeSemanticValue"
  );

  if (fixed !== content) {
    writeFileSync("governed.js", fixed, "utf8");
    console.log("✓ governed.js fixed");
  } else {
    // Try alternate: find truncated signature and replace to next export
    const truncIdx = content.indexOf("export async function readRelevantExistingRowWindow(\n");
    if (truncIdx >= 0) {
      const nextExportIdx = content.indexOf("\nexport", truncIdx + 1);
      if (nextExportIdx >= 0) {
        const fixedAlt = content.slice(0, truncIdx) + fullFn + "\n" + content.slice(nextExportIdx + 1);
        writeFileSync("governed.js", fixedAlt, "utf8");
        console.log("✓ governed.js fixed (alternate)");
      } else {
        console.error("Could not find next export in governed.js");
      }
    } else {
      console.error("Truncated signature not found in governed.js");
    }
  }
}

// ── Fix registry.js: appendRowsIfMissingByKeys truncated at line 1350 ────────
{
  const content = readFileSync("registry.js", "utf8");
  const fnName = "appendRowsIfMissingByKeys";
  const serverLine = 6805 - 1; // 0-indexed
  const fullFn = "export " + extractFunctionFrom(serverLine);
  console.log(`\n${fnName}: ${fullFn.split("\n").length} lines from server.js`);

  const fixed = content.replace(
    /export async function appendRowsIfMissingByKeys\(\n\nexport async function ensureSiteMigrationRegistrySurfaces/,
    fullFn + "\n\nexport async function ensureSiteMigrationRegistrySurfaces"
  );

  if (fixed !== content) {
    writeFileSync("registry.js", fixed, "utf8");
    console.log("✓ registry.js fixed");
  } else {
    const truncIdx = content.indexOf("export async function appendRowsIfMissingByKeys(\n");
    if (truncIdx >= 0) {
      const nextExportIdx = content.indexOf("\nexport", truncIdx + 1);
      if (nextExportIdx >= 0) {
        const fixedAlt = content.slice(0, truncIdx) + fullFn + "\n" + content.slice(nextExportIdx + 1);
        writeFileSync("registry.js", fixedAlt, "utf8");
        console.log("✓ registry.js fixed (alternate)");
      } else {
        console.error("Could not find next export in registry.js");
      }
    } else {
      console.error("Truncated signature not found in registry.js");
    }
  }
}
