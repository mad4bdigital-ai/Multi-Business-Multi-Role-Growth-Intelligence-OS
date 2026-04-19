/**
 * Fixes truncated functions in execution.js, governed.js, registry.js
 * by re-extracting them from server.js.
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

function findFunctionLine(name) {
  const pattern = new RegExp(`^(async\\s+)?function\\s+${name}\\s*[\\(\\{]`);
  for (let i = 0; i < serverLines.length; i++) {
    if (pattern.test(serverLines[i])) return i;
  }
  return -1;
}

// ── Fix execution.js ──────────────────────────────────────────────────────────
// Problem: ensureMethodAndPathMatchEndpoint is truncated (only signature, no body)
{
  const execContent = readFileSync("execution.js", "utf8");

  const fnName = "ensureMethodAndPathMatchEndpoint";
  const serverLine = findFunctionLine(fnName);
  if (serverLine < 0) {
    console.error(`${fnName} not found in server.js`);
  } else {
    const fullFn = "export " + extractFunctionFrom(serverLine);
    console.log(`${fnName}: ${fullFn.split("\n").length} lines from server.js`);

    // Replace the truncated version: from `export function ensureMethodAndPathMatchEndpoint(`
    // to the next function `export async function fetchSchemaContract`
    const bad = "export function ensureMethodAndPathMatchEndpoint(\n\nexport async function fetchSchemaContract";
    const good = fullFn + "\n\nexport async function fetchSchemaContract";

    if (execContent.includes(bad.split("\n")[0])) {
      const fixed = execContent.replace(
        /export function ensureMethodAndPathMatchEndpoint\(\n\nexport async function fetchSchemaContract/,
        fullFn + "\n\nexport async function fetchSchemaContract"
      );
      writeFileSync("execution.js", fixed, "utf8");
      console.log("✓ execution.js fixed");
    } else {
      console.log("Pattern not found in execution.js, trying alternate approach...");
      // Find the truncated signature and replace up to next function
      const truncIdx = execContent.indexOf("export function ensureMethodAndPathMatchEndpoint(\n\nexport");
      if (truncIdx >= 0) {
        const nextFnIdx = execContent.indexOf("\nexport", truncIdx + 1);
        if (nextFnIdx >= 0) {
          const fixed = execContent.slice(0, truncIdx) + fullFn + "\n" + execContent.slice(nextFnIdx + 1);
          writeFileSync("execution.js", fixed, "utf8");
          console.log("✓ execution.js fixed (alternate)");
        }
      }
    }
  }
}

// ── Fix governed.js ───────────────────────────────────────────────────────────
// Problem: normalizeSemanticValue export issue
{
  const govContent = readFileSync("governed.js", "utf8");
  const errLine = govContent.split("\n").findIndex((l, i) => {
    // Find the line that causes "Unexpected token 'export'" - i.e., an `export` inside a function body
    return i > 0 && l.startsWith("export function normalizeSemanticValue");
  });

  if (errLine >= 0) {
    console.log(`governed.js: problem at line ${errLine + 1}: ${govContent.split("\n")[errLine]}`);
  }

  // Check the server.js version of normalizeSemanticValue
  const serverLine = findFunctionLine("normalizeSemanticValue");
  if (serverLine >= 0) {
    console.log(`normalizeSemanticValue in server.js at line ${serverLine + 1}`);
    const fullFn = extractFunctionFrom(serverLine);
    console.log(`  → ${fullFn.split("\n").length} lines`);
  }
}

// ── Check registry.js ─────────────────────────────────────────────────────────
{
  const regContent = readFileSync("registry.js", "utf8");
  const fnName = "ensureSiteMigrationRegistrySurfaces";
  const serverLine = findFunctionLine(fnName);
  if (serverLine >= 0) {
    const fullFn = extractFunctionFrom(serverLine);
    console.log(`\n${fnName} in server.js: ${fullFn.split("\n").length} lines`);
  }

  // Find problem in registry.js
  const regLines = regContent.split("\n");
  const probLine = regLines.findIndex(l => l.startsWith("export async function ensureSiteMigrationRegistrySurfaces"));
  if (probLine >= 0) {
    console.log(`registry.js problem at line ${probLine + 1}`);
    console.log("  context:", regLines.slice(Math.max(0, probLine-2), probLine+3).join("\n  "));
  }
}
