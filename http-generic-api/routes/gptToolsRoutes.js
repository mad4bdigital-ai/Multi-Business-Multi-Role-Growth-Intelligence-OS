import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getPool } from "../db.js";

// Meta-operations that live in the GPT schema itself — never callable via tools/call
const RESERVED_TOOL_KEYS = new Set([
  "activation_session_context",
  "gpt_tools_list",
  "gpt_tools_call",
  "gpt_session_turn",
  "gpt_session_end",
]);

const TOOLS_TABLE = {
  admin: "admin_platform_endpoint_tools",
  tenant: "tenant_platform_endpoint_tools",
};

const REPO_INSPECT_DENY_SEGMENTS = new Set([
  ".git",
  ".omx",
  ".codex",
  "node_modules",
  "secrets",
  "tmp",
  "dist",
  "build",
  "coverage",
]);
const REPO_INSPECT_DENY_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^credentials(?:\..*)?\.json$/i,
  /^token(?:\..*)?\.json$/i,
  /^service[-_]?account.*\.json$/i,
  /^private[-_]?key.*\.(?:json|key|pem)$/i,
  /\.(?:key|p12|pem|pfx)$/i,
];
const REPO_INSPECT_TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".csv", ".env.example", ".gitignore", ".html", ".js", ".json",
  ".jsx", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const VIRTUAL_ADMIN_TOOLS = [
  {
    name: "repo_inspect",
    displayName: "Repository Inspect",
    description: "Read-only repository inspection. Actions: list, read, search. Paths are repo-confined; secrets/build folders are blocked.",
    method: "VIRTUAL",
    path: "internal://repo-inspect",
    tags: ["repo", "read_only", "diagnostics"],
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "read", "search"] },
        path: { type: "string" },
        query: { type: "string" },
        recursive: { type: "boolean", default: false },
        max_entries: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        max_chars: { type: "integer", minimum: 1000, maximum: 50000, default: 12000 },
      },
    },
  },
];

function resolveCallerType(req) {
  if (req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true) return "admin";
  return "tenant";
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function fetchTools(callerType) {
  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  const [rows] = await getPool().query(
    `SELECT tool_key, display_name, description, http_method, http_path,
            path_param_keys, input_schema, tags
     FROM \`${table}\`
     WHERE is_enabled = 1
     ORDER BY sort_order ASC, tool_key ASC`
  );
  const dbTools = rows.map((r) => ({
    name: r.tool_key,
    displayName: r.display_name,
    description: r.description,
    method: r.http_method,
    path: r.http_path,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()) : [],
    inputSchema: parseJson(r.input_schema),
  }));
  return callerType === "admin" ? [...VIRTUAL_ADMIN_TOOLS, ...dbTools] : dbTools;
}

async function dispatchTool(callerType, toolKey, args, req) {
  if (callerType === "admin" && toolKey === "repo_inspect") {
    return { status: 200, body: { ok: true, name: toolKey, result: await inspectRepoReadOnly(args) } };
  }

  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  const [rows] = await getPool().query(
    `SELECT http_method, http_path, path_param_keys, fixed_body
     FROM \`${table}\`
     WHERE tool_key = ? AND is_enabled = 1
     LIMIT 1`,
    [toolKey]
  );

  if (!rows[0]) {
    return { status: 404, body: { ok: false, error: { code: "tool_not_found", message: `Tool '${toolKey}' not found.` } } };
  }

  const { http_method: method, http_path: pathTemplate } = rows[0];
  const pathParamKeys = parseJson(rows[0].path_param_keys) || [];
  const fixedBody = parseJson(rows[0].fixed_body) || {};
  const remaining = { ...args };

  // Substitute path parameters
  let path = pathTemplate;
  for (const key of pathParamKeys) {
    const val = args[key];
    if (val === undefined || val === null) {
      return { status: 400, body: { ok: false, error: { code: "missing_path_param", message: `Path parameter '${key}' is required for tool '${toolKey}'.` } } };
    }
    path = path.replace(`{${key}}`, encodeURIComponent(String(val)));
    delete remaining[key];
  }

  const internalBase = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
  const httpMethod = method.toUpperCase();
  let url = `${internalBase}${path}`;

  const fetchOpts = {
    method: httpMethod,
    headers: {
      "Content-Type": "application/json",
      "Authorization": req.headers.authorization || "",
      "X-Forwarded-For": req.ip || "",
    },
    signal: AbortSignal.timeout(300_000),
  };

  if (httpMethod === "GET" || httpMethod === "DELETE") {
    const qs = Object.keys(remaining).length
      ? "?" + new URLSearchParams(
          Object.fromEntries(
            Object.entries(remaining).filter(([, v]) => v !== undefined && v !== null)
          )
        ).toString()
      : "";
    url += qs;
  } else {
    // fixed_body provides defaults (e.g. sub-tool name); caller arguments take priority
    fetchOpts.body = JSON.stringify({ ...fixedBody, ...remaining });
  }

  const response = await fetch(url, fetchOpts);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function repoInspectRoot() {
  if (process.env.REPO_INSPECT_ROOT) return path.resolve(process.env.REPO_INSPECT_ROOT);
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd) === "http-generic-api" ? path.dirname(cwd) : cwd;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function hasDeniedSegment(relativePath) {
  return relativePath.split(path.sep).some((segment) => REPO_INSPECT_DENY_SEGMENTS.has(segment.toLowerCase()));
}

function hasDeniedFileName(filePath) {
  const name = path.basename(filePath);
  return REPO_INSPECT_DENY_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function resolveRepoInspectPath(inputPath = ".") {
  const root = repoInspectRoot();
  const resolved = path.resolve(root, String(inputPath || "."));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const err = new Error("path must stay inside the repository root.");
    err.status = 400;
    err.code = "repo_path_outside_root";
    throw err;
  }
  if (relative && hasDeniedSegment(relative)) {
    const err = new Error("path crosses a blocked repository segment.");
    err.status = 403;
    err.code = "repo_path_blocked";
    throw err;
  }
  if (hasDeniedFileName(resolved)) {
    const err = new Error("file name is blocked by repository inspection policy.");
    err.status = 403;
    err.code = "repo_file_blocked";
    throw err;
  }
  return { root, resolved, relative: relative || "." };
}

function isLikelyTextPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".env.example")) return true;
  return REPO_INSPECT_TEXT_EXTENSIONS.has(path.extname(lower));
}

async function listRepoEntries(dirPath, options) {
  const { root, resolved, relative } = resolveRepoInspectPath(dirPath);
  const recursive = options.recursive === true;
  const maxEntries = clampNumber(options.max_entries, 100, 1, 500);
  const entries = [];

  async function visit(current) {
    if (entries.length >= maxEntries) return;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const fullPath = path.join(current, child.name);
      const childRelative = path.relative(root, fullPath);
      if (hasDeniedSegment(childRelative) || hasDeniedFileName(fullPath)) continue;
      const stat = await fs.stat(fullPath);
      entries.push({
        path: childRelative.replaceAll(path.sep, "/"),
        type: child.isDirectory() ? "directory" : "file",
        size: child.isFile() ? stat.size : undefined,
      });
      if (entries.length >= maxEntries) break;
      if (recursive && child.isDirectory()) await visit(fullPath);
    }
  }

  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    const err = new Error("path must be a directory for action=list.");
    err.status = 400;
    err.code = "repo_list_requires_directory";
    throw err;
  }
  await visit(resolved);
  return { action: "list", root, path: relative.replaceAll(path.sep, "/"), count: entries.length, truncated: entries.length >= maxEntries, entries };
}

async function readRepoFile(filePath, options) {
  const { root, resolved, relative } = resolveRepoInspectPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    const err = new Error("path must be a file for action=read.");
    err.status = 400;
    err.code = "repo_read_requires_file";
    throw err;
  }
  if (!isLikelyTextPath(resolved)) {
    const err = new Error("file extension is not allowlisted for text inspection.");
    err.status = 403;
    err.code = "repo_file_type_blocked";
    throw err;
  }
  const maxChars = clampNumber(options.max_chars, 12000, 1000, 50000);
  const content = await fs.readFile(resolved, "utf8");
  if (content.includes("\u0000")) {
    const err = new Error("binary-looking file content is blocked.");
    err.status = 403;
    err.code = "repo_binary_blocked";
    throw err;
  }
  return {
    action: "read",
    root,
    path: relative.replaceAll(path.sep, "/"),
    size: stat.size,
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  };
}

async function searchRepoFiles(options) {
  const query = String(options.query || "").trim();
  if (!query) {
    const err = new Error("query is required for action=search.");
    err.status = 400;
    err.code = "repo_search_missing_query";
    throw err;
  }
  const { root, resolved, relative } = resolveRepoInspectPath(options.path || ".");
  const maxEntries = clampNumber(options.max_entries, 100, 1, 500);
  const maxChars = clampNumber(options.max_chars, 12000, 1000, 50000);
  const matches = [];
  let scannedFiles = 0;

  async function visit(current) {
    if (matches.length >= maxEntries) return;
    const stat = await fs.stat(current);
    if (stat.isDirectory()) {
      const children = await fs.readdir(current, { withFileTypes: true });
      for (const child of children) {
        const fullPath = path.join(current, child.name);
        const childRelative = path.relative(root, fullPath);
        if (hasDeniedSegment(childRelative) || hasDeniedFileName(fullPath)) continue;
        await visit(fullPath);
        if (matches.length >= maxEntries) break;
      }
      return;
    }
    if (!stat.isFile() || !isLikelyTextPath(current) || stat.size > 1_000_000) return;
    scannedFiles += 1;
    const content = await fs.readFile(current, "utf8");
    const index = content.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return;
    const lineNumber = content.slice(0, index).split(/\r?\n/).length;
    const snippetStart = Math.max(0, index - 160);
    const snippet = content.slice(snippetStart, index + Math.min(query.length + 320, maxChars)).replace(/\s+/g, " ").trim();
    matches.push({
      path: path.relative(root, current).replaceAll(path.sep, "/"),
      line: lineNumber,
      snippet,
    });
  }

  await visit(resolved);
  return {
    action: "search",
    root,
    path: relative.replaceAll(path.sep, "/"),
    query,
    scanned_files: scannedFiles,
    count: matches.length,
    truncated: matches.length >= maxEntries,
    matches,
  };
}

export async function inspectRepoReadOnly(args = {}) {
  const action = String(args.action || "list").trim().toLowerCase();
  if (action === "list") return listRepoEntries(args.path || ".", args);
  if (action === "read") return readRepoFile(args.path, args);
  if (action === "search") return searchRepoFiles(args);
  const err = new Error("action must be one of: list, read, search.");
  err.status = 400;
  err.code = "repo_inspect_bad_action";
  throw err;
}

export function buildGptToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // GET /gpt/tools
  router.get("/gpt/tools", requireBackendApiKey, async (req, res) => {
    try {
      const callerType = resolveCallerType(req);
      const tools = await fetchTools(callerType);
      return res.status(200).json({ ok: true, caller_type: callerType, count: tools.length, tools });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tools_list_failed", message: err.message } });
    }
  });

  // POST /gpt/tools/call
  router.post("/gpt/tools/call", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body || {};
      // Accept both "tool_args" (preferred — avoids OpenAI reserved-keyword conflict) and legacy "arguments"
      const args = body.tool_args ?? body.arguments ?? {};
      const { name } = body;
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_name", message: "name is required." } });
      }
      if (RESERVED_TOOL_KEYS.has(name)) {
        return res.status(400).json({ ok: false, error: { code: "reserved_tool", message: `'${name}' is a meta-operation; call it directly via its schema path.` } });
      }

      const callerType = resolveCallerType(req);
      const result = await dispatchTool(callerType, name, args, req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "tool_call_failed", message: err.message }
      });
    }
  });

  return router;
}
