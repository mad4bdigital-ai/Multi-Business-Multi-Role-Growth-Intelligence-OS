/**
 * googleAuthTokenResolver.js
 *
 * Module-level Google OAuth2 access token cache.
 * Supports four credential sources. Default priority is:
 *   1. GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON file
 *   2. GOOGLE_SA_JSON — inline service account JSON (env var, base64 or raw)
 *   3. Application Default Credentials — Cloud Run managed service account
 *   4. GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET — user OAuth2
 *
 * Set GOOGLE_AUTH_MODE=refresh_token for user-owned Drive/Sheets inputs. That
 * mode uses refresh-token OAuth first, then falls back to service-account auth.
 *
 * Exports:
 *   getGoogleAccessTokenSync()  — sync; reads from cache, triggers background refresh if stale
 *   getGoogleAccessToken()      — async; awaits a fresh fetch if cache is empty/stale
 *
 * The cache is pre-warmed at import time and auto-refreshed every 50 minutes.
 * If no credentials are configured and ADC is unavailable, both exports return ""
 * and log a single warning.
 */

import { google } from "googleapis";

// Workspace scopes used by the managed service account for platform-owned
// Drive/Sheets registry and bootstrap files.
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

// All scopes used across user-authorized Google API actions.
const GOOGLE_SCOPES = [
  // Workspace
  ...GOOGLE_WORKSPACE_SCOPES,
  // Analytics (full read/write/admin suite)
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/analytics.manage.users",
  "https://www.googleapis.com/auth/analytics.manage.users.readonly",
  "https://www.googleapis.com/auth/analytics.provision",
  // Search Ads 360
  "https://www.googleapis.com/auth/doubleclicksearch",
  // Search Console (full — not readonly)
  "https://www.googleapis.com/auth/webmasters",
  // Tag Manager (full suite)
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containers.readonly",
  "https://www.googleapis.com/auth/tagmanager.manage.accounts",
  "https://www.googleapis.com/auth/tagmanager.manage.users",
  "https://www.googleapis.com/auth/tagmanager.delete.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  // Google Ads
  "https://www.googleapis.com/auth/adwords",
];

let _cachedToken = "";
let _tokenExpiresAt = 0;
let _fetchInProgress = false;
let _noCredentialsWarned = false;
let _tokenSourceLogged = false;

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

export function getGoogleAuthCredentialSourcesForEnv(env = process.env) {
  const credFile = env.GOOGLE_APPLICATION_CREDENTIALS;
  const saJson = parseSaJson(env.GOOGLE_SA_JSON);
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const authMode = String(env.GOOGLE_AUTH_MODE || "").trim().toLowerCase();
  const sources = [];

  if (authMode === "refresh_token" && refreshToken) {
    sources.push("refresh_token");
  }

  if (credFile || saJson) {
    sources.push("explicit_service_account");
  } else {
    sources.push("managed_service_account_adc");
  }

  if (refreshToken && !sources.includes("refresh_token")) {
    sources.push("refresh_token");
  }
  return sources;
}

async function fetchGoogleToken() {
  if (_fetchInProgress) return;
  _fetchInProgress = true;
  try {
    const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const saJson = parseSaJson(process.env.GOOGLE_SA_JSON);
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const sourceOrder = getGoogleAuthCredentialSourcesForEnv(process.env);
    const attempts = [];

    if (sourceOrder.includes("explicit_service_account")) {
      const opts = { scopes: GOOGLE_SCOPES };
      if (saJson) opts.credentials = saJson;
      else opts.keyFilename = credFile;
      attempts.push({
        source: "explicit service account",
        run: async () => {
          const auth = new google.auth.GoogleAuth(opts);
          const client = await auth.getClient();
          return await client.getAccessToken();
        }
      });
    }

    if (sourceOrder.includes("managed_service_account_adc")) {
      attempts.push({
        source: "managed service account ADC",
        run: async () => {
          const auth = new google.auth.GoogleAuth({ scopes: GOOGLE_WORKSPACE_SCOPES });
          const client = await auth.getClient();
          return await client.getAccessToken();
        }
      });
    }

    if (sourceOrder.includes("refresh_token")) {
      attempts.push({
        source: "refresh token",
        run: async () => {
          const oauth2 = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
          );
          oauth2.setCredentials({ refresh_token: refreshToken });
          return await oauth2.getAccessToken();
        }
      });
    }

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const resp = await attempt.run();
        const token = typeof resp === "string" ? resp : resp?.token;
        if (token) {
          _cachedToken = token;
          _tokenExpiresAt = Date.now() + 55 * 60_000;
          if (!_tokenSourceLogged) {
            _tokenSourceLogged = true;
            console.log(`[googleAuth] Access token obtained via ${attempt.source}.`);
          }
          return;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!_noCredentialsWarned) {
      _noCredentialsWarned = true;
      console.warn(
        "[googleAuth] Could not obtain a Google access token from service account ADC or configured OAuth credentials.\n" +
        "  On Cloud Run, ensure the service has a managed service account with access to the required Drive/Sheets files.\n" +
        "  For user-owned Drive/Sheets inputs, set GOOGLE_AUTH_MODE=refresh_token with GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.\n" +
        "  Locally, set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SA_JSON, or GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET." +
        (lastError?.message ? ` Last error: ${lastError.message}` : "")
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

if (String(process.env.GOOGLE_AUTH_DISABLE_PREWARM || "").trim().toLowerCase() !== "true") {
  // Pre-warm on module load (non-blocking — server continues starting).
  fetchGoogleToken().catch(() => {});

  // Refresh every 50 minutes (Google tokens last 60 min).
  setInterval(() => fetchGoogleToken().catch(() => {}), 50 * 60_000).unref();
}
