import { randomUUID } from "node:crypto";

// Canonical skill manifest schema — compatible with Agent Skills spec (obsidian-skills).
// Any AI frontend (Claude, ChatGPT Custom GPT, Gemini Custom Gem) can call skills via
// the HTTP API; execution always runs server-side through this runtime.
const REQUIRED_FIELDS = ["name", "version", "description"];

export function parseManifest(raw = {}) {
  const manifest = typeof raw === "string" ? JSON.parse(raw) : raw;

  for (const f of REQUIRED_FIELDS) {
    if (!manifest[f]) throw new Error(`skill manifest missing required field: ${f}`);
  }

  return {
    name:           String(manifest.name).trim(),
    version:        String(manifest.version || "0.1.0").trim(),
    description:    String(manifest.description || "").trim(),
    system_prompt:  String(manifest.system_prompt || "").trim(),
    tools:          Array.isArray(manifest.tools) ? manifest.tools : [],
    models:         Array.isArray(manifest.models) ? manifest.models : ["claude", "openai", "gemini"],
    entry_point:    String(manifest.entry_point || "").trim(),
    install_hooks:  Array.isArray(manifest.install_hooks) ? manifest.install_hooks : [],
    logic_type:     String(manifest.logic_type || "skill").trim(),
    tags:           Array.isArray(manifest.tags) ? manifest.tags : [],
    author:         String(manifest.author || "").trim(),
    homepage:       String(manifest.homepage || "").trim(),
  };
}

export function manifestToLogicBody(manifest = {}, sourceUrl = "") {
  return {
    source:          "skill_package",
    source_url:      sourceUrl,
    system_prompt:   manifest.system_prompt,
    trigger_phrase:  manifest.description,
    action_class:    manifest.logic_type || "skill",
    execution_layer: "skill_runtime",
    module_binding:  manifest.name,
    runtime_callable: "TRUE",
    tools:           manifest.tools,
    models:          manifest.models,
    entry_point:     manifest.entry_point,
    tags:            manifest.tags,
  };
}

export function generatePackageId() {
  return `pkg_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function packageKeyFromName(name = "") {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Normalise tool definitions to the platform's common format.
// Accepts OpenAI function-calling, Anthropic tool_use, or Gemini function_declarations.
export function normalizeTools(rawTools = []) {
  return rawTools.map(t => {
    // OpenAI / Claude format: { type: "function", function: { name, description, parameters } }
    if (t.function) return t;
    // Gemini format: { name, description, parameters }
    if (t.name && !t.function) {
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description || "",
          parameters: t.parameters || { type: "object", properties: {} },
        },
      };
    }
    return t;
  });
}
