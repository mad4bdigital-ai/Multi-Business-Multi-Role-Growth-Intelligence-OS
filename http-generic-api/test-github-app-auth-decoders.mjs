/**
 * test-github-app-auth-decoders.mjs
 *
 * Focused offline coverage for GitHub App private-key decoder formats.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { decodeGitHubAppPrivateKey } from "./githubAppAuth.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const expectedPem = pem.trim();
const escapedPem = pem.replace(/\n/g, "\\n");
const b64Pem = Buffer.from(pem, "utf8").toString("base64");
const doubleB64Pem = Buffer.from(b64Pem, "utf8").toString("base64");
const jsonWrapped = JSON.stringify({ private_key: escapedPem });
const jsonWrappedB64 = Buffer.from(jsonWrapped, "utf8").toString("base64");

function assertDecodes(label, value) {
  assert.equal(decodeGitHubAppPrivateKey(value).trim(), expectedPem, label);
}

assertDecodes("raw PEM decodes", pem);
assertDecodes("escaped PEM decodes", escapedPem);
assertDecodes("base64 PEM decodes", b64Pem);
assertDecodes("double-base64 PEM decodes", doubleB64Pem);
assertDecodes("JSON-wrapped private_key decodes", jsonWrapped);
assertDecodes("base64 JSON-wrapped private_key decodes", jsonWrappedB64);
assertDecodes("base64 env assignment decodes", `GITHUB_APP_PRIVATE_KEY_B64=${b64Pem}`);
assertDecodes("exported base64 env assignment decodes", `export GITHUB_APP_PRIVATE_KEY_B64="${b64Pem}"`);
assertDecodes("raw PEM env assignment decodes", `GITHUB_APP_PRIVATE_KEY='${escapedPem}'`);

console.log("ALL GITHUB APP DECODER FORMAT TESTS PASS");
