import assert from "node:assert/strict";
import {
  setCachedValue,
  getCachedValue
} from "./activationBootstrapCache.js";

await setCachedValue("test:key", { ok: true }, 5);
const value = await getCachedValue("test:key");

assert.equal(value.ok, true);
console.log("activation bootstrap cache test passed");
