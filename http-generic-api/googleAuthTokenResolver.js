/**
 * googleAuthTokenResolver.js
 *
 * Module-level Google OAuth2 access token cache.
 * Supports three credential sources (in priority order):
 *   1. GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON file
 *   2. GOOGLE_SA_JSON — inline service account JSON (env var, base64 or raw)
 *   3. GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET — user OAuth2
 *
 * Exports:
 *   getGoogleAccessTokenSync()  — sync; reads from cache, triggers background refresh if stale
 *   getGoogleAccessToken()      — async; awaits a fresh fetch if cache is empty/stale
 *
 * The cache is pre-warmed at import time and auto-refreshed every 50 minutes.
 * If no credentials are configured, both exports return "" and log a single warning.
 */

import { google } from "googleapis";

// All scopes used across the platform's Google API actions.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/doubleclicksearch",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers.readonly",
];

let _cachedToken = "";
let _tokenExpiresAt = 0;
let _fetchInProgress = false;
let _noCredentialsWarned = false;

function parseSaJson(raw) {
  if (!raw) return null;
  try {
    // Accept raw JSON or base64-encoded JSON
    const s = raw.trim();
    const decoded = s.startsWith("{") ? s : Buffer.from(s, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function fetchGoogleToken() {
  if (_fetchInProgress) return;
  _fetchInProgress = true;
  try {
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const saJson = parseSaJson(process.env.GOOGLE_SA_JSON);
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (credFile || saJson) {
      const opts = { scopes: GOOGLE_SCOPES };
      if (saJson) opts.credentials = saJson;
      else opts.keyFilename = credFile;

      const auth = new google.auth.GoogleAuth(opts);
      const client = await auth.getClient();
      const resp = await client.getAccessToken();
      if (resp?.token) {
        _cachedToken = resp.token;
        _tokenExpiresAt = Date.now() + 55 * 60_000;
        console.log("[googleAuth] Access token obtained via service account.");
      }
    } else if (refreshToken) {
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      oauth2.setCredentials({ refresh_token: refreshToken });
      const resp = await oauth2.getAccessToken();
      if (resp?.token) {
        _cachedToken = resp.token;
        _tokenExpiresAt = Date.now() + 55 * 60_000;
        console.log("[googleAuth] Access token obtained via refresh token.");
      }
    } else if (!_noCredentialsWarned) {
      _noCredentialsWarned = true;
      console.warn(
        "[googleAuth] No Google credentials configured — Google API calls will be unauthenticated.\n" +
        "  Set one of: GOOGLE_APPLICATION_CREDENTIALS (SA file), GOOGLE_SA_JSON (inline JSON),\n" +
        "  or GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET."
      );
    }
  } catch (err) {
    console.warn("[googleAuth] Token fetch failed:", err.message);
  } finally {
    _fetchInProgress = false;
  }
}

export function getGoogleAccessTokenSync() {
  if (_cachedToken && _tokenExpiresAt > Date.now() + 60_000) {
    return _cachedToken;
  }
  // Return stale token if available while triggering background refresh.
  fetchGoogleToken().catch(() => {});
  return _cachedToken || "";
}

export async function getGoogleAccessToken() {
  if (_cachedToken && _tokenExpiresAt > Date.now() + 60_000) {
    return _cachedToken;
  }
  await fetchGoogleToken();
  return _cachedToken || "";
}

// Pre-warm on module load (non-blocking — server continues starting).
fetchGoogleToken().catch(() => {});

// Refresh every 50 minutes (Google tokens last 60 min).
setInterval(() => fetchGoogleToken().catch(() => {}), 50 * 60_000).unref();
