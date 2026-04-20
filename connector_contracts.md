# Connector Contracts
**Authority document — updated when public connector APIs change**

This document defines the explicit public API surface for each provider connector module in `http-generic-api/`. Internal helpers are not exported unless required by callers outside the module.

---

## github.js

### Public exports

#### `githubGitBlobChunkRead({ input })`
- **Purpose:** Read a GitHub blob by SHA, with chunked range support.
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `github_git_blob_chunk_read`)
- **Input:** `input.owner`, `input.repo`, `input.file_sha`, `input.byte_offset`, `input.length`
- **Returns:** `{ ok, chunk, byte_offset, length, total_size, sha }` or error object
- **Auth:** `GITHUB_TOKEN` environment variable

#### `fetchGitHubBlobPayload({ owner, repo, fileSha })`
- **Purpose:** Low-level fetch of a single GitHub blob by SHA.
- **Caller:** Internal helper, also exported for direct use if needed.
- **Returns:** `{ ok, content, encoding, sha, size }` or error object
- **Note:** This is the raw fetch primitive. Prefer `githubGitBlobChunkRead` for ranged access.

### Internal (not exported)
All helper utilities (base64 decoding, byte range slicing, error shaping) are private.

---

## hostinger.js

### Public exports

#### `hostingerSshRuntimeRead({ input })`
- **Purpose:** Read runtime state from a Hostinger SSH target (site inventory lookup).
- **Caller:** `jobRunner.js` — `dispatchEndpointKeyExecution` (endpoint key: `hostinger_ssh_runtime_read`)
- **Input:** `input.target_key` or `input.brand` to identify the hosting account row
- **Returns:** Governed runtime read result or error object

#### `matchesHostingerSshTarget(rowObj, input)`
- **Purpose:** Determines whether a registry row matches the given input criteria.
- **Caller:** Internal to `hostingerSshRuntimeRead`; exported for use in registry resolution helpers.

### Internal (not exported)
SSH transport logic, credential resolution internals.

---

## Dispatch entrypoint

Both connectors are invoked exclusively via `dispatchEndpointKeyExecution` in `jobRunner.js`:

```js
case "github_git_blob_chunk_read":
  return await githubGitBlobChunkRead({ input: requestPayload });

case "hostinger_ssh_runtime_read":
  return await hostingerSshRuntimeRead({ input: requestPayload });
```

No connector is called directly from route handlers or the main server entrypoint. All connector access goes through the dispatch layer.

---

## Contract rules

1. Each connector exports only what has a real caller or explicit contract purpose.
2. Internal helpers remain unexported unless another module requires them.
3. Dispatch is always by `endpoint_key` string — no connector is hard-wired to a route.
4. Auth credentials are read from environment variables inside the connector, not injected by callers.
5. Error returns are structured objects with `ok: false, error: { code, message }` — not thrown exceptions, except for configuration errors.
