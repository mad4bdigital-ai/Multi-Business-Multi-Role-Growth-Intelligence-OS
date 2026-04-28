import { redis } from "./queue.js";
import { REGISTRY_CACHE_TTL_SECONDS } from "./config.js";

const KEY_PREFIX = "registry:";

function key(sheetName) {
  return KEY_PREFIX + String(sheetName || "").trim();
}

export async function cacheGet(sheetName) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key(sheetName));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`REGISTRY_CACHE_GET_WARN [${sheetName}]:`, err?.message);
    return null;
  }
}

export async function cacheSet(sheetName, rows) {
  if (!redis) return;
  try {
    await redis.set(key(sheetName), JSON.stringify(rows), "EX", REGISTRY_CACHE_TTL_SECONDS);
  } catch (err) {
    console.warn(`REGISTRY_CACHE_SET_WARN [${sheetName}]:`, err?.message);
  }
}

export async function cacheInvalidate(sheetName) {
  if (!redis) return;
  try {
    await redis.del(key(sheetName));
  } catch (err) {
    console.warn(`REGISTRY_CACHE_INVALIDATE_WARN [${sheetName}]:`, err?.message);
  }
}
