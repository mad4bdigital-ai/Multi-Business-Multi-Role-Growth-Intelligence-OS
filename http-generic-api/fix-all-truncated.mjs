/**
 * Comprehensive fix for truncated exported functions in execution.js, governed.js, registry.js.
 * Detects truncation by tracking paren depth to find closing ) then checks for body {.
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const SERVER = readFileSync("server.js", "utf8");
const serverLines = SERVER.split("\n").map(l => l.replace(/\r$/, ""));

function stripStrings(line) {
  return line
    .replace(/\/\/.*$/, "")                            // line comment
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, "``")       // template literals
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')        // double-quoted strings
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''")        // single-quoted strings
    .replace(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, "/!/"); // regex literals
}

function extractFunctionFrom(startLine0) {
  const lines = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let paramsClosed = false; // true once function's opening ( has matched its )
  let bodyStarted = false;

  for (let i = startLine0; i < serverLines.length; i++) {
    lines.push(serverLines[i]);
    const s = stripStrings(serverLines[i]);
    for (const ch of s) {
      if (!paramsClosed) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") { parenDepth--; if (parenDepth <= 0) paramsClosed = true; }
        // ignore { } inside parameter list (default values)
      } else {
        if (ch === "{") { braceDepth++; bodyStarted = true; }
        else if (ch === "}") braceDepth--;
      }
    }
    if (bodyStarted && braceDepth <= 0) break;
  }
  return lines.join("\n");
}

function findInServer(name) {
  const pattern = new RegExp(`^(async\\s+)?function\\s+${name}\\b`);
  for (let i = 0; i < serverLines.length; i++) {
    if (pattern.test(serverLines[i])) return i;
  }
  return -1;
}

/**
 * Returns true if this export function has a properly opened body.
 * Tracks paren depth to skip past parameter list (including defaults like = {}),
 * then looks for { after closing ).
 */
function functionHasBody(lines, startIdx) {
  let parenDepth = 0;
  let parenClosed = false;

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    // Stop scanning if we hit the next export (and paren never closed properly)
    if (i > startIdx && !parenClosed && /^export\s+(async\s+)?function\s+/.test(raw)) {
      return false;
    }
    const s = stripStrings(raw);
    for (let ci = 0; ci < s.length; ci++) {
      const ch = s[ci];
      if (!parenClosed) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") {
          parenDepth--;
          if (parenDepth <= 0) parenClosed = true;
        }
      } else {
        // After closing paren — look for {
        if (ch === "{") return true;
        // If we see next export, no body
        if (raw.trimStart().startsWith("export")) return false;
      }
    }
    // After line ends, if paren closed, body { should be on this or next line
    // Keep scanning
    if (i > startIdx + 1 && !parenClosed && /^export\s+(async\s+)?function\s+/.test(raw)) {
      return false;
    }
  }
  return false;
}

function findTruncatedFunctions(content) {
  const lines = content.split("\n");
  const truncated = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const m = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (!m) continue;
    if (!functionHasBody(lines, i)) {
      truncated.push({ name: m[1], lineIdx: i });
    }
  }
  return truncated;
}

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf8");
  let truncated = findTruncatedFunctions(content);
  if (truncated.length === 0) {
    console.log(`${filePath}: no truncated functions`);
    return;
  }
  console.log(`${filePath}: ${truncated.length} truncated:`, truncated.map(t => t.name).join(", "));

  // Fix iteratively (one at a time, re-read after each)
  for (const { name } of truncated) {
    content = readFileSync(filePath, "utf8");
    const serverLine = findInServer(name);
    if (serverLine < 0) {
      console.warn(`  ${name}: NOT FOUND in server.js`);
      continue;
    }
    const fullFn = "export " + extractFunctionFrom(serverLine);
    console.log(`  ${name}: ${fullFn.split("\n").length} lines (server.js:${serverLine + 1})`);

    // Find start of truncated function in content
    const exportPat = new RegExp(`(export\\s+(?:async\\s+)?function\\s+${name}\\b)`);
    const startMatch = exportPat.exec(content);
    if (!startMatch) {
      console.warn(`  ${name}: not found in ${filePath}`);
      continue;
    }
    const startIdx = startMatch.index;

    // Find where the truncated block ends: the \n of the NEXT export function/const
    // Scan from startIdx + 1 to find \nexport or \r\nexport
    let endIdx = -1;
    const afterStart = content.slice(startIdx + startMatch[0].length);
    const nextExportMatch = afterStart.match(/\r?\nexport\s+(?:async\s+)?function\s+/);
    if (nextExportMatch) {
      endIdx = startIdx + startMatch[0].length + nextExportMatch.index + nextExportMatch[0].match(/^\r?\n/)[0].length;
    }

    if (endIdx < 0) {
      console.warn(`  ${name}: can't find end of truncated block`);
      continue;
    }

    const fixed = content.slice(0, startIdx) + fullFn + "\n\n" + content.slice(endIdx);
    writeFileSync(filePath, fixed, "utf8");
    console.log(`  ✓ ${name} replaced`);
  }
}

fixFile("execution.js");
fixFile("governed.js");
fixFile("registry.js");

console.log("\n── Syntax check ──");
for (const f of ["execution.js", "governed.js", "registry.js"]) {
  try {
    execSync(`node --check ${f}`, { stdio: "pipe" });
    console.log(`${f}: ✓`);
  } catch (e) {
    const msg = (e.stderr?.toString() || e.stdout?.toString() || "").split("\n").slice(0, 3).join(" | ");
    console.error(`${f}: FAIL — ${msg}`);
  }
}
