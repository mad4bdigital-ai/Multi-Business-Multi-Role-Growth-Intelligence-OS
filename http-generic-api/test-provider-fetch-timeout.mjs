import assert from "node:assert/strict";
import {
  executeUpstreamAttempt,
  fetchProviderWithTimeout,
  resolveProviderTimeoutMs
} from "./execution.js";

function captureDebugLogs() {
  const entries = [];
  return {
    entries,
    debugLog(label, value) {
      entries.push({ label, value });
    }
  };
}

function response({ status = 200, body = { ok: true } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? "application/json" : "";
      },
      forEach(fn) {
        fn("application/json", "content-type");
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

const cappedTimeoutMs = resolveProviderTimeoutMs({
  requestPayload: { provider_timeout_ms: 5000 },
  maxTimeoutSeconds: 1
});
assert.equal(cappedTimeoutMs, 1000);

{
  const { entries, debugLog } = captureDebugLogs();
  const result = await executeUpstreamAttempt({
    requestUrl: "https://provider.example/ok",
    requestInit: { method: "GET" },
    requestPayload: {
      parent_action_key: "example_api",
      endpoint_key: "example_endpoint",
      provider_timeout_ms: 100
    },
    resolvedProviderDomain: "provider.example",
    debugLog,
    fetchImpl: async () => response({ status: 201, body: { created: true } })
  });

  assert.equal(result.upstream.status, 201);
  assert.deepEqual(result.data, { created: true });
  assert.ok(entries.some(entry => entry.label === "PROVIDER_FETCH_START:"));
  assert.ok(entries.some(entry => entry.label === "PROVIDER_RESPONSE_STATUS:" && entry.value === 201));
  assert.ok(entries.some(entry => entry.label === "PROVIDER_FETCH_END:"));
}

{
  const { entries, debugLog } = captureDebugLogs();
  const result = await executeUpstreamAttempt({
    requestUrl: "https://provider.example/slow",
    requestInit: { method: "GET" },
    requestPayload: {
      parent_action_key: "example_api",
      endpoint_key: "slow_endpoint",
      provider_timeout_ms: 5
    },
    resolvedProviderDomain: "provider.example",
    debugLog,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      setTimeout(() => resolve(response()), 50);
    })
  });

  assert.equal(result.shortCircuitResponse.status, 504);
  assert.equal(result.shortCircuitResponse.body.code, "provider_timeout");
  assert.equal(result.shortCircuitResponse.body.error.code, "provider_timeout");
  assert.equal(result.shortCircuitResponse.body.error.details.endpoint_key, "slow_endpoint");
  assert.ok(entries.some(entry => entry.label === "PROVIDER_FETCH_START:"));
  assert.ok(entries.some(entry => entry.label === "PROVIDER_FETCH_TIMEOUT:"));
}

{
  const { entries, debugLog } = captureDebugLogs();
  await assert.rejects(
    () => fetchProviderWithTimeout({
      requestUrl: "https://provider.example/error",
      requestInit: { method: "GET" },
      requestPayload: { provider_timeout_ms: 100 },
      debugLog,
      fetchImpl: async () => {
        throw new Error("socket hang up");
      }
    }),
    /socket hang up/
  );
  assert.ok(entries.some(entry => entry.label === "PROVIDER_FETCH_ERROR:"));
}

console.log("provider fetch timeout tests passed");
