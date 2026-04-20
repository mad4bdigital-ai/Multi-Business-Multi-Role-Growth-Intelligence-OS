/**
 * Connector contract tests for github.js and hostinger.js
 * Run: node test-connectors.mjs
 */

import { hostingerSshRuntimeRead, matchesHostingerSshTarget } from "./hostinger.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

async function importGithubModule(tag) {
  return import(new URL(`./github.js?case=${tag}`, import.meta.url).href);
}

section("hostinger.js — matchesHostingerSshTarget");

const hostingerRow = {
  hosting_provider: "Hostinger",
  hosting_account_key: "hostinger_main",
  account_identifier: "acct_123",
  resolver_target_keys_json: '["site_alpha","site_beta"]',
  brand_sites_json: '[{"site":"https://example.com"}]'
};

assert(
  "matches by hosting_account_key",
  matchesHostingerSshTarget(hostingerRow, { hosting_account_key: "hostinger_main" }) === true
);
assert(
  "matches by account_identifier",
  matchesHostingerSshTarget(hostingerRow, { account_identifier: "acct_123" }) === true
);
assert(
  "matches by resolver target_key",
  matchesHostingerSshTarget(hostingerRow, { target_key: "site_beta" }) === true
);
assert(
  "matches by normalized site_url",
  matchesHostingerSshTarget(hostingerRow, { site_url: "https://EXAMPLE.com" }) === true
);
assert(
  "does not match non-hostinger provider rows",
  matchesHostingerSshTarget({ ...hostingerRow, hosting_provider: "aws" }, { hosting_account_key: "hostinger_main" }) === false
);
assert(
  "does not match unrelated inputs",
  matchesHostingerSshTarget(hostingerRow, { target_key: "site_gamma" }) === false
);

{
  const result = await hostingerSshRuntimeRead(
    { input: { target_key: "site_beta" } },
    {
      REGISTRY_SPREADSHEET_ID: "sheet_123",
      HOSTING_ACCOUNT_REGISTRY_RANGE: "Hosting Account Registry!A:Z",
      HOSTING_ACCOUNT_REGISTRY_SHEET: "Hosting Account Registry",
      async getGoogleClientsForSpreadsheet() {
        return {
          sheets: {
            spreadsheets: {
              values: {
                async get() {
                  return {
                    data: {
                      values: [
                        [
                          "hosting_provider",
                          "hosting_account_key",
                          "account_identifier",
                          "resolver_target_keys_json",
                          "brand_sites_json",
                          "ssh_available",
                          "wp_cli_available",
                          "shared_access_enabled",
                          "resolver_execution_ready"
                        ],
                        [
                          "Hostinger",
                          "hostinger_main",
                          "acct_123",
                          '["site_alpha","site_beta"]',
                          '[{"site":"https://example.com"}]',
                          "TRUE",
                          "FALSE",
                          "TRUE",
                          "TRUE"
                        ]
                      ]
                    }
                  };
                }
              }
            }
          }
        };
      }
    }
  );

  assert("hostinger runtime read resolves matching row", result.ok === true, JSON.stringify(result));
  assert("hostinger runtime read preserves authoritative source", result.authoritative_source === "Hosting Account Registry", JSON.stringify(result));
  assert("hostinger runtime read normalizes booleans", result.ssh_available === true && result.wp_cli_available === false, JSON.stringify(result));
}

section("github.js — githubGitBlobChunkRead");

process.env.GITHUB_TOKEN = "test_token";
const fetchCalls = [];
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), init });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        encoding: "base64",
        content: Buffer.from("abcdef", "utf8").toString("base64")
      });
    }
  };
};

{
  const { githubGitBlobChunkRead } = await importGithubModule("byte-offset");
  const result = await githubGitBlobChunkRead({
    input: {
      owner: "octo",
      repo: "repo",
      file_sha: "abc123",
      byte_offset: 1,
      length: 3
    }
  });

  assert("accepts byte_offset alias", result.ok === true, JSON.stringify(result));
  assert("returns byte_offset field", result.byte_offset === 1, JSON.stringify(result));
  assert("returns expected base64 chunk", result.content === Buffer.from("bcd", "utf8").toString("base64"), result.content);
  assert("preserves reported chunk length", result.length === 3, `got ${result.length}`);
  assert("github fetch sends bearer auth header", fetchCalls[0]?.init?.headers?.Authorization === "Bearer test_token", JSON.stringify(fetchCalls[0]));
}

{
  const { githubGitBlobChunkRead } = await importGithubModule("range-check");
  const result = await githubGitBlobChunkRead({
    input: {
      owner: "octo",
      repo: "repo",
      file_sha: "abc123",
      byte_offset: 20,
      length: 2
    }
  });

  assert("returns 416 for oversized byte_offset", result.statusCode === 416, JSON.stringify(result));
  assert("returns range_not_satisfiable error code", result.error?.code === "range_not_satisfiable", JSON.stringify(result));
}

delete process.env.GITHUB_TOKEN;

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL CONNECTOR TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
