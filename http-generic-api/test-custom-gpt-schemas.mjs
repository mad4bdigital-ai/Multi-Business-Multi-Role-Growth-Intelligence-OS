/**
 * test-custom-gpt-schemas.mjs
 *
 * Contract checks for the active Custom GPT OpenAPI action schemas.
 * These tests stay local and deterministic: no network, DB, or credentials.
 *
 * Run: node test-custom-gpt-schemas.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACTIVE_SCHEMAS = {
  "openapi.custom-gpt.auth-dispatcher.yaml": {
    serverUrl: "https://auth.mad4b.com",
    securityScheme: "backendBearerAuth",
    maxOperations: 30,
    requiredOperations: ["listAdminTools", "callAdminTool", "repairLocalConnector"],
  },
  "openapi.tenant-gpt.auth.yaml": {
    serverUrl: "https://auth.mad4b.com",
    securityScheme: "userBearerAuth",
    maxOperations: 30,
    requiredOperations: ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"],
  },
  "openapi.gpt-action.local-connector.yaml": {
    serverUrl: "https://connector.mad4b.com",
    securityScheme: "backendBearerAuth",
    maxOperations: 30,
    requiredOperations: ["connectorHealth", "connectorShell", "connectorCf"],
  },
};

const OBSOLETE_SCHEMAS = [
  "openapi.custom-gpt.runtime.yaml",
  "openapi.custom-gpt.identity.yaml",
  "openapi.custom-gpt.customers.yaml",
  "openapi.custom-gpt.systems.yaml",
  "openapi.custom-gpt.logic.yaml",
  "openapi.custom-gpt.observability.yaml",
  "openapi.custom-gpt.developer.yaml",
  "openapi.custom-gpt.admin-cli.yaml",
  "openapi.custom-gpt.ops.yaml",
];

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const MAX_DESCRIPTION_LENGTH = 300;

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function loadSchema(file) {
  return yaml.load(readFileSync(resolve(__dirname, file), "utf8"));
}

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, pathItem, method, operation });
    }
  }
  return operations;
}

function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

function effectiveSchema(doc, schema) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) return effectiveSchema(doc, resolveLocalRef(doc, schema.$ref));
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  return schema;
}

function walkDescriptions(value, path = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkDescriptions(item, `${path}[${index}]`, out));
    return out;
  }
  if (typeof value.description === "string" && value.description.length > MAX_DESCRIPTION_LENGTH) {
    out.push({ path: `${path}.description`, length: value.description.length });
  }
  for (const [key, child] of Object.entries(value)) {
    walkDescriptions(child, `${path}.${key}`, out);
  }
  return out;
}

function parameterKey(parameter) {
  return `${parameter?.in || ""}:${parameter?.name || ""}`;
}

function assertToolArgsContract(doc, operationId) {
  const operation = collectOperations(doc).find((op) => op.operation.operationId === operationId)?.operation;
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  assert(`${operationId} body requires name`, Array.isArray(schema?.required) && schema.required.includes("name"));
  assert(`${operationId} body exposes tool_args`, Boolean(schema?.properties?.tool_args));
  assert(`${operationId} body does not expose legacy arguments`, !schema?.properties?.arguments);
}

function assertNonConsequentialOperation(doc, operationId) {
  const operation = collectOperations(doc).find((op) => op.operation.operationId === operationId)?.operation;
  assert(`${operationId} is non-consequential`, operation?.["x-openai-isConsequential"] === false);
}

section("schema inventory");
for (const file of Object.keys(ACTIVE_SCHEMAS)) {
  assert(`${file} exists`, existsSync(resolve(__dirname, file)));
}
for (const file of OBSOLETE_SCHEMAS) {
  assert(`${file} is deleted`, !existsSync(resolve(__dirname, file)));
}

for (const [file, expected] of Object.entries(ACTIVE_SCHEMAS)) {
  const doc = loadSchema(file);
  const label = basename(file);
  const operations = collectOperations(doc);

  section(label);

  assert("uses OpenAPI 3.1", doc.openapi === "3.1.0", `got ${doc.openapi}`);
  assert("has exactly one server", Array.isArray(doc.servers) && doc.servers.length === 1);
  assert("server URL matches live host", doc.servers?.[0]?.url === expected.serverUrl, `got ${doc.servers?.[0]?.url}`);
  assert(`operation count <= ${expected.maxOperations}`, operations.length <= expected.maxOperations, `got ${operations.length}`);
  assert("has at least one operation", operations.length > 0);
  assert("does not expose root path operation", !operations.some((operation) => operation.pathKey === "/"));

  const securitySchemes = Object.keys(doc.components?.securitySchemes || {});
  assert("exposes expected security scheme", securitySchemes.includes(expected.securityScheme), `got ${securitySchemes.join(", ")}`);

  const operationIds = new Set(operations.map((op) => op.operation.operationId).filter(Boolean));
  for (const operationId of expected.requiredOperations) {
    assert(`exposes ${operationId}`, operationIds.has(operationId));
  }

  const longDescriptions = walkDescriptions(doc);
  assert("all descriptions are <= 300 chars", longDescriptions.length === 0,
    longDescriptions.map((item) => `${item.path}:${item.length}`).join(", "));

  for (const { pathKey, pathItem, method, operation } of operations) {
    const opLabel = `${method.toUpperCase()} ${pathKey} ${operation.operationId || ""}`.trim();
    assert(`${opLabel} path is absolute`, pathKey.startsWith("/"), pathKey);
    const combinedParameters = [
      ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
      ...(Array.isArray(operation.parameters) ? operation.parameters : []),
    ];
    const seen = new Set();
    const duplicates = [];
    for (const parameter of combinedParameters) {
      const key = parameterKey(parameter);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    assert(`${opLabel} has no duplicate parameters`, duplicates.length === 0, duplicates.join(", "));

    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    if (requestSchema) {
      const schema = effectiveSchema(doc, requestSchema);
      assert(`${opLabel} request body schema is object`, schema?.type === "object", JSON.stringify(requestSchema));
    }
  }
}

section("dispatcher contracts");
{
  const adminDoc = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const tenantDoc = loadSchema("openapi.tenant-gpt.auth.yaml");

  assertToolArgsContract(adminDoc, "callAdminTool");
  assertToolArgsContract(tenantDoc, "callTool");

  for (const operationId of ["callSystemTool", "callAdminSystemTool", "callAdminTool", "repairLocalConnector"]) {
    assertNonConsequentialOperation(adminDoc, operationId);
  }

  const adminOps = collectOperations(adminDoc);
  assert("admin dispatcher includes GPT tool catalog route",
    adminOps.some((op) => op.pathKey === "/gpt/tools" && op.method === "get"));
  assert("admin dispatcher includes GPT tool call route",
    adminOps.some((op) => op.pathKey === "/gpt/tools/call" && op.method === "post"));
  assert("admin dispatcher hides direct admin control route",
    !adminOps.some((op) => op.operation.operationId === "executeAdminControl"));

  const tenantPostOps = collectOperations(tenantDoc).filter((op) => op.method === "post");
  assert("tenant dispatcher POST operations are non-consequential",
    tenantPostOps.every((op) => op.operation["x-openai-isConsequential"] === false),
    tenantPostOps.filter((op) => op.operation["x-openai-isConsequential"] !== false).map((op) => op.pathKey).join(", "));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CUSTOM GPT SCHEMA TESTS PASS");
