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
const escapedPem = pem.replace(/\n/g, "\\n");
const b64Pem = Buffer.from(pem, "utf8").toString("base64");
const doubleB64Pem = Buffer.from(b64Pem, "utf8").toString("base64");
const jsonWrapped = JSON.stringify({ private_key: escapedPem });
const jsonWrappedB64 = Buffer.from(jsonWrapped, "utf8").toString("base64");

assert.equal(decodeGitHubAppPrivateKey(pem), pem.trim(), "raw PEM decodes");
assert.equal(decodeGitHubAppPrivateKey(escapedPem), pem.trim(), "escaped PEM decodes");
assert.equal(decodeGitHubAppPrivateKey(b64Pem), pem.trim(), "base64 PEM decodes");
assert.equal(decodeGitHubAppPrivateKey(doubleB64Pem), pem.trim(), "double-base64 PEM decodes");
assert.equal(decodeGitHubAppPrivateKey(jsonWrapped), pem.trim(), "JSON-wrapped private_key decodes");
assert.equal(decodeGitHubAppPrivateKey(jsonWrappedB64), pem.trim(), "base64 JSON-wrapped private_key decodes");

console.log("ALL GITHUB APP DECODER FORMAT TESTS PASS");
