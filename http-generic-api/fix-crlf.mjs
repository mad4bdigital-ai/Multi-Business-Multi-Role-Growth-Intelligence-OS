import { readFileSync, writeFileSync } from "fs";

const SERVER = readFileSync("server.js", "utf8");
const serverLines = SERVER.split("\n");

// ── Fix execution.js: ensureMethodAndPathMatchEndpoint ────────────────────────
{
  let content = readFileSync("execution.js", "utf8");
  const fnLine = serverLines.findIndex(l =>
    /^(async\s+)?function\s+ensureMethodAndPathMatchEndpoint/.test(l)
  );
  console.log("ensureMethodAndPathMatchEndpoint in server.js at line:", fnLine + 1);
  const fullFn = "export " + extractFunctionFrom(fnLine);
  console.log("lines:", fullFn.split("\n").length);

  const truncIdx = content.indexOf("export function ensureMethodAndPathMatchEndpoint(\r\n");
  console.log("execution.js truncIdx:", truncIdx);
  const nextExportIdx = content.indexOf("\nexport", truncIdx + 30);
  console.log("nextExportIdx:", nextExportIdx);
  if (truncIdx >= 0 && nextExportIdx >= 0) {
    const fixed = content.slice(0, truncIdx) + fullFn + "\n" + content.slice(nextExportIdx + 1);
    writeFileSync("execution.js", fixed, "utf8");
    console.log("✓ execution.js fixed");
  }
}


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

// Fix governed.js — readRelevantExistingRowWindow (server.js line 2531)
{
  let content = readFileSync("governed.js", "utf8");
  const fullFn = "export " + extractFunctionFrom(2531 - 1);
  console.log("readRelevantExistingRowWindow:", fullFn.split("\n").length, "lines");

  const truncIdx = content.indexOf("export async function readRelevantExistingRowWindow(\r\n");
  console.log("governed.js truncIdx:", truncIdx);
  if (truncIdx >= 0) {
    // blank line is \n only (mixed endings), so search for \nexport
    const nextExportIdx = content.indexOf("\nexport", truncIdx + 30);
    console.log("nextExportIdx:", nextExportIdx);
    if (nextExportIdx >= 0) {
      const fixed = content.slice(0, truncIdx) + fullFn + "\n" + content.slice(nextExportIdx + 1);
      writeFileSync("governed.js", fixed, "utf8");
      console.log("✓ governed.js fixed");
    }
  }
}

// Fix registry.js — appendRowsIfMissingByKeys (server.js line 6805)
{
  let content = readFileSync("registry.js", "utf8");
  const fullFn = "export " + extractFunctionFrom(6805 - 1);
  console.log("\nappendRowsIfMissingByKeys:", fullFn.split("\n").length, "lines");

  const truncIdx = content.indexOf("export async function appendRowsIfMissingByKeys(\r\n");
  console.log("registry.js truncIdx:", truncIdx);
  if (truncIdx >= 0) {
    const nextExportIdx = content.indexOf("\nexport", truncIdx + 30);
    console.log("nextExportIdx:", nextExportIdx);
    if (nextExportIdx >= 0) {
      const fixed = content.slice(0, truncIdx) + fullFn + "\n" + content.slice(nextExportIdx + 1);
      writeFileSync("registry.js", fixed, "utf8");
      console.log("✓ registry.js fixed");
    }
  }
}
