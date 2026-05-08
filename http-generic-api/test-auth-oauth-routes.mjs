/**
 * test-auth-oauth-routes.mjs
 *
 * Fast validation checks for the GPT Action OAuth bridge.
 *
 * Run: node test-auth-oauth-routes.mjs
 */

process.env.JWT_SECRET = "oauth_route_test_secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

import express from "express";
import jwt from "jsonwebtoken";

const { buildAuthRoutes } = await import("./routes/authRoutes.js");

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

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function postForm(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, body: await readJson(response) };
}

async function getText(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    text: await response.text(),
  };
}

const app = express();
app.use(express.json());
app.use("/auth", buildAuthRoutes({}));

const { server, baseUrl } = await startServer(app);

try {
  const redirectUri = "https://chatgpt.com/aip/test-gpt/oauth/callback";
  const state = "state-123";
  const encodedRedirect = encodeURIComponent(redirectUri);

  section("authorize popup");

  {
    const result = await getText(baseUrl, `/auth/oauth/authorize?redirect_uri=${encodedRedirect}&state=${state}&screen_hint=signup&activation_mode=managed&device_id=my-laptop&workspace_name=Acme%20Growth&sign_in_options=google,email,register`);
    assert("authorize returns html", result.status === 200, `${result.status}`);
    assert("authorize is not cacheable", result.cacheControl.includes("no-store"), result.cacheControl);
    assert("authorize includes app name", result.text.includes("Growth Intelligence Platform"));
    assert("authorize renders Google Sign-In", result.text.includes("accounts.google.com/gsi/client"));
    assert("authorize includes existing-account option", result.text.includes("Existing account"));
    assert("authorize includes new-workspace option", result.text.includes("New workspace"));
    assert("authorize carries activation mode", result.text.includes('"activation_mode":"managed"'));
    assert("authorize carries device id", result.text.includes('"device_id":"my-laptop"'));
    assert("authorize preselects signup panel", result.text.includes('const INITIAL_PANEL = "register"'));
    assert("authorize includes privacy policy link", result.text.includes('href="/privacy-policy"'));
    assert("authorize includes configured Google client", result.text.includes(process.env.GOOGLE_CLIENT_ID));
  }

  {
    const result = await getText(baseUrl, "/auth/oauth/authorize?redirect_uri=file%3A%2F%2Fbad");
    assert("authorize rejects unsafe redirect scheme", result.status === 400, `${result.status}`);
  }

  section("code issuance and token exchange");

  const userToken = jwt.sign(
    { user_id: "user-1", email: "user@example.com", tenant_id: "tenant-1" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  const activationContext = {
    activation_mode: "dedicated",
    device_id: "tenant-pc",
    workspace_name: "Tenant Workspace",
    screen_hint: "signin",
    sign_in_options: ["email", "register"],
  };
  const codeResult = await postJson(baseUrl, "/auth/oauth/code", { token: userToken, redirect_uri: redirectUri, state, activation_context: activationContext });
  assert("code endpoint accepts signed user token", codeResult.status === 200, `${codeResult.status}`);
  assert("code response includes code", typeof codeResult.body.code === "string" && codeResult.body.code.length > 40);
  assert("code response redirects with state", String(codeResult.body.redirect_to || "").includes(`state=${state}`), codeResult.body.redirect_to);
  assert("code response redirects with code", String(codeResult.body.redirect_to || "").includes("code="), codeResult.body.redirect_to);
  assert("code response preserves activation mode", codeResult.body.activation_context?.activation_mode === "dedicated", JSON.stringify(codeResult.body.activation_context));
  assert("code response preserves sign-in options", Array.isArray(codeResult.body.activation_context?.sign_in_options) && codeResult.body.activation_context.sign_in_options.includes("email"), JSON.stringify(codeResult.body.activation_context));

  const exchange = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: redirectUri,
  });
  assert("token endpoint exchanges authorization code", exchange.status === 200, `${exchange.status}`);
  assert("token endpoint returns bearer token", exchange.body.token_type === "Bearer", JSON.stringify(exchange.body));
  assert("token endpoint returns original user JWT", exchange.body.access_token === userToken);
  assert("token endpoint returns tenant scope", exchange.body.scope === "tenant", JSON.stringify(exchange.body));
  assert("token endpoint returns activation context", exchange.body.activation_context?.device_id === "tenant-pc", JSON.stringify(exchange.body));

  const mismatch = await postForm(baseUrl, "/auth/oauth/token", {
    grant_type: "authorization_code",
    code: codeResult.body.code,
    redirect_uri: "https://chatgpt.com/aip/other/oauth/callback",
  });
  assert("token endpoint rejects redirect mismatch", mismatch.status === 400, `${mismatch.status}`);
  assert("redirect mismatch reports invalid_grant", mismatch.body.error === "invalid_grant", JSON.stringify(mismatch.body));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\nAuth OAuth route tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
