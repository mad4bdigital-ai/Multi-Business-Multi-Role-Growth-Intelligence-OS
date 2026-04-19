// Adds missing shared.js imports to each phase module that needs them
import { readFileSync, writeFileSync } from "fs";

// All symbols now exported from shared.js that modules reference without importing
const SHARED_SYMBOLS = [
  "normalizeWordpressPhaseAType",
  "WORDPRESS_PHASE_A_ALLOWED_TYPES",
  "WORDPRESS_PHASE_A_BLOCKED_TYPES",
  "WORDPRESS_PHASE_B_BUILDER_TYPES",
  "WORDPRESS_PHASE_D_FORM_TYPES",
  "WORDPRESS_MUTATION_PUBLISH_STATUSES",
  "toPositiveInt",
  "nowIsoSafe",
  "normalizeStringList",
  "normalizeProviderDomain",
  "normalizeWordpressFormIntegrationSignals",
  "verifyWordpressRolledBackEntry",
  "classifyWordpressExecutionStage",
  // already in shared.js, ensure all usages resolved:
  "getWordpressItemById",
  "listWordpressEntriesByType",
  "buildWordpressBuilderAuditRow",
];

// These also need the shared symbols but their canonical source
const PHASE_FILES = [
  "wordpress/shared.js",
  "wordpress/phaseA.js",
  "wordpress/phaseB.js",
  "wordpress/phaseC.js",
  "wordpress/phaseD.js",
  "wordpress/phaseE.js",
  "wordpress/phaseF.js",
  "wordpress/phaseG.js",
  "wordpress/phaseH.js",
  "wordpress/phaseI.js",
  "wordpress/phaseJ.js",
  "wordpress/phaseK.js",
  "wordpress/phaseL.js",
  "wordpress/phaseM.js",
  "wordpress/phaseN.js",
  "wordpress/phaseO.js",
  "wordpress/phaseP.js",
];

// Build set of what shared.js actually exports
const sharedRaw = readFileSync("wordpress/shared.js", "utf8");
const sharedExports = new Set();
for (const m of sharedRaw.matchAll(/^export (?:async )?function ([A-Za-z_$][A-Za-z0-9_$]*)|^export const ([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
  sharedExports.add(m[1] || m[2]);
}
console.log("shared.js exports:", sharedExports.size);

let totalAdded = 0;

for (const file of PHASE_FILES) {
  const raw = readFileSync(file, "utf8");

  // Find which shared symbols this file uses but doesn't define or import
  const needed = [];
  for (const sym of sharedExports) {
    // Does this file use this symbol?
    if (!new RegExp(`\\b${sym}\\b`).test(raw)) continue;
    // Does this file define it?
    if (new RegExp(`^export (?:async )?function ${sym}\\b|^export const ${sym}\\b|^function ${sym}\\b|^const ${sym}\\b`, "m").test(raw)) continue;
    // Does this file already import it from shared.js?
    if (new RegExp(`\\b${sym}\\b`).test(
      raw.match(/from "\.\/shared\.js"[\s\S]*?(?=\nimport|\nexport|\nconst|\nfunction|$)/)?.[0] || ""
    )) continue;
    needed.push(sym);
  }

  if (needed.length === 0) {
    console.log(`${file}: nothing to add`);
    continue;
  }

  // Check if there's already an import from shared.js
  const existingImportMatch = raw.match(/^import \{([^}]+)\} from "\.\/shared\.js";/m);
  let updated;

  if (existingImportMatch) {
    // Merge into existing import
    const existing = existingImportMatch[1]
      .split(",").map(s => s.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...needed])].sort();
    const newImport = `import {\n${merged.map(s => `  ${s}`).join(",\n")}\n} from "./shared.js";`;
    updated = raw.replace(/^import \{[^}]+\} from "\.\/shared\.js";/m, newImport);
  } else {
    // Insert after first line (comment) or before first export/function
    const insertAfter = raw.match(/^\/\/ .+\n/)?.[0] || "";
    const newImport = `import {\n${needed.sort().map(s => `  ${s}`).join(",\n")}\n} from "./shared.js";\n`;
    if (insertAfter) {
      updated = raw.replace(insertAfter, insertAfter + newImport);
    } else {
      updated = newImport + raw;
    }
  }

  writeFileSync(file, updated, "utf8");
  console.log(`${file}: added ${needed.length} imports — ${needed.join(", ")}`);
  totalAdded += needed.length;
}

console.log(`\nTotal imports added: ${totalAdded}`);
