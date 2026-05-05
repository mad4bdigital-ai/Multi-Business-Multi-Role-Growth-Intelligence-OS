import assert from "node:assert/strict";
import { createBackendApiKeyMiddleware } from "./runtimeGuards.js";

function callMiddleware(headers = {}, env = { BACKEND_API_KEY: "secret" }) {
  const middleware = createBackendApiKeyMiddleware(env);
  let nextCalled = false;
  let responseStatus = null;
  let responseBody = null;
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = {
    headers: lowerHeaders,
    header(name) {
      return lowerHeaders[String(name).toLowerCase()];
    }
  };
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, responseStatus, responseBody };
}

assert.equal(
  callMiddleware({ Authorization: "Bearer secret" }).nextCalled,
  true,
  "accepts Authorization bearer token"
);

assert.equal(
  callMiddleware({ "x-api-key": "secret" }).nextCalled,
  true,
  "accepts x-api-key token"
);

{
  const result = callMiddleware({});
  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 401);
  assert.equal(result.responseBody.ok, false);
  assert.equal(result.responseBody.error.code, "missing_backend_api_key");
}

{
  const result = callMiddleware({ Authorization: "Bearer wrong" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 403);
  assert.equal(result.responseBody.ok, false);
  assert.equal(result.responseBody.error.code, "invalid_backend_api_key");
}

console.log("runtime guard tests passed");
