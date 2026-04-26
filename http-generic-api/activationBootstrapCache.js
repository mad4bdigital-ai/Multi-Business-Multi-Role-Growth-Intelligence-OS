import { redis, REDIS_ENABLED } from "./queue.js";

const MEMORY = new Map();

function nowMs() {
  return Date.now();
}

function ttlToExpiryMs(ttlSeconds) {
  return nowMs() + Math.max(1, Number(ttlSeconds || 0)) * 1000;
}

async function redisGetJson(key) {
  if (!REDIS_ENABLED || !redis) return null;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSetJson(key, value, ttlSeconds) {
  if (!REDIS_ENABLED || !redis) return false;
  await redis.set(key, JSON.stringify(value), "EX", Math.max(1, Number(ttlSeconds || 1)));
  return true;
}

export async function getCachedValue(key) {
  const mem = MEMORY.get(key);
  if (mem && mem.expires_at > nowMs()) return mem.value;
  if (mem) MEMORY.delete(key);

  const cached = await redisGetJson(key);
  if (!cached) return null;
  if (cached.expires_at && cached.expires_at <= nowMs()) return null;
  return cached.value ?? null;
}

export async function setCachedValue(key, value, ttlSeconds) {
  const payload = { value, expires_at: ttlToExpiryMs(ttlSeconds) };
  MEMORY.set(key, payload);
  await redisSetJson(key, payload, ttlSeconds);
  return value;
}

export async function getActivationBackoffUntil(key) {
  const value = await getCachedValue(key);
  return Number(value || 0);
}

export async function setActivationBackoffUntil(key, untilEpochMs, ttlSeconds) {
  return setCachedValue(key, Number(untilEpochMs || 0), ttlSeconds);
}

export function makeActivationWorkbookCacheKey() {
  return "activation:workbook:id";
}

export function makeActivationBootstrapRowCacheKey() {
  return "activation:bootstrap:row:activate_system";
}

export function makeActivationSheetsBackoffKey() {
  return "activation:sheets:backoff";
}
