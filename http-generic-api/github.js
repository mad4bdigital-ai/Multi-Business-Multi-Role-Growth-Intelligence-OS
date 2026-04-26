import { GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH } from "./config.js";

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    const err = new Error("Missing required environment variable: GITHUB_TOKEN");
    err.code = "missing_github_token";
    err.status = 500;
    throw err;
  }
  return GITHUB_TOKEN;
}

function assertGithubParam(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${fieldName} is required.`);
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return normalized;
}

function parseGithubChunkInteger(value, fieldName, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const err = new Error(
      `${fieldName} must be an integer between ${min} and ${max}.`
    );
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return parsed;
}

function decodeGithubBase64ToBuffer(value) {
  return Buffer.from(String(value || "").replace(/\s+/g, ""), "base64");
}

function encodeStringToBase64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function encodeGitHubContentPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

async function proxyGitHubJson({
  method = "GET",
  pathname,
  searchParams,
  body,
  accept = "application/vnd.github+json"
}) {
  const token = requireGithubToken();
  const url = new URL(`${GITHUB_API_BASE_URL}${pathname}`);

  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function githubErrorResponse(res, upstream, codeBase, fallbackMessage) {
  return res.status(upstream.status || 502).json({
    ok: false,
    error: {
      code:
        upstream.status === 404
          ? `${codeBase}_not_found`
          : `${codeBase}_failed`,
      message:
        upstream.payload?.message ||
        fallbackMessage ||
        `GitHub request failed with status ${upstream.status}.`
    }
  });
}

export async function fetchGitHubBlobPayload({ owner, repo, fileSha }) {
  const upstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(fileSha)}`
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub blob fetch failed with status ${upstream.status}.`
    );
    err.code =
      upstream.status === 404 ? "github_blob_not_found" : "github_blob_fetch_failed";
    err.status = upstream.status === 404 ? 404 : 502;
    throw err;
  }

  if (String(upstream.payload?.encoding || "").trim().toLowerCase() !== "base64") {
    const err = new Error("GitHub blob response encoding is not base64.");
    err.code = "github_blob_encoding_unsupported";
    err.status = 502;
    throw err;
  }

  return upstream.payload;
}

export async function fetchGitHubContentFile({ owner, repo, path, branch }) {
  const normalizedOwner = assertGithubParam(owner, "owner");
  const normalizedRepo = assertGithubParam(repo, "repo");
  const normalizedPath = assertGithubParam(path, "path");

  const upstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(normalizedOwner)}` +
      `/${encodeURIComponent(normalizedRepo)}` +
      `/contents/${encodeGitHubContentPath(normalizedPath)}`,
    searchParams: {
      ref: branch
    }
  });

  if (!upstream.ok) {
    if (upstream.status === 404) return null;
    const err = new Error(
      upstream.payload?.message ||
      `GitHub content fetch failed with status ${upstream.status}.`
    );
    err.code = "github_content_fetch_failed";
    err.status = upstream.status || 502;
    throw err;
  }

  if (Array.isArray(upstream.payload) || upstream.payload?.type !== "file") {
    const err = new Error(`GitHub content path is not a file: ${normalizedPath}`);
    err.code = "github_content_not_file";
    err.status = 409;
    throw err;
  }

  return upstream.payload;
}

export async function githubPutContents({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const path = assertGithubParam(input.path, "path");
  const message = assertGithubParam(input.message, "message");
  const branch = String(input.branch || "").trim() || undefined;
  const existingSha = String(input.sha || "").trim();
  const content =
    input.content_base64 !== undefined
      ? String(input.content_base64 || "").replace(/\s+/g, "")
      : encodeStringToBase64(input.content);

  if (!content) {
    const err = new Error("content or content_base64 is required.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const upstream = await proxyGitHubJson({
    method: "PUT",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/contents/${encodeGitHubContentPath(path)}`,
    body: {
      message,
      content,
      ...(branch ? { branch } : {}),
      ...(existingSha ? { sha: existingSha } : {}),
      ...(input.committer ? { committer: input.committer } : {}),
      ...(input.author ? { author: input.author } : {})
    }
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub content write failed with status ${upstream.status}.`
    );
    err.code = "github_put_contents_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    statusCode: upstream.status,
    owner,
    repo,
    branch: branch || "",
    path,
    content_sha: upstream.payload?.content?.sha || "",
    commit_sha: upstream.payload?.commit?.sha || "",
    commit_html_url: upstream.payload?.commit?.html_url || "",
    content_html_url: upstream.payload?.content?.html_url || ""
  };
}

export async function githubApplyFileUpdates({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const branch = String(input.branch || "").trim() || undefined;
  const message = assertGithubParam(input.message, "message");
  const files = Array.isArray(input.files) ? input.files : [];

  if (!files.length) {
    const err = new Error("files must be a non-empty array.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const results = [];

  for (const file of files) {
    const path = assertGithubParam(file.path, "files[].path");
    const existing = await fetchGitHubContentFile({ owner, repo, path, branch });
    const writeResult = await githubPutContents({
      input: {
        owner,
        repo,
        branch,
        path,
        message: file.message || message,
        sha: file.sha || existing?.sha || "",
        content: file.content,
        content_base64: file.content_base64,
        committer: input.committer,
        author: input.author
      }
    });

    results.push({
      ...writeResult,
      operation: existing ? "update" : "create",
      previous_sha: existing?.sha || ""
    });
  }

  return {
    ok: true,
    owner,
    repo,
    branch: branch || "",
    files_changed: results.length,
    results,
    final_commit_sha: results[results.length - 1]?.commit_sha || ""
  };
}

export async function githubGitBlobChunkRead({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const fileSha = assertGithubParam(
    input.file_sha || input.fileSha,
    "file_sha"
  );

  const start = parseGithubChunkInteger(
    input.byte_offset ?? input.start,
    "byte_offset",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const length = parseGithubChunkInteger(
    input.length,
    "length",
    1,
    GITHUB_BLOB_CHUNK_MAX_LENGTH
  );

  const blob = await fetchGitHubBlobPayload({ owner, repo, fileSha });
  const blobBuffer = decodeGithubBase64ToBuffer(blob.content);
  const totalSize = blobBuffer.length;

  if (start > totalSize) {
    return {
      ok: false,
      statusCode: 416,
      error: {
        code: "range_not_satisfiable",
        message: "start exceeds blob size."
      }
    };
  }

  const endExclusive = Math.min(start + length, totalSize);
  const chunkBuffer = blobBuffer.subarray(start, endExclusive);

  return {
    ok: true,
    statusCode: 200,
    owner,
    repo,
    file_sha: fileSha,
    byte_offset: start,
    start,
    length: chunkBuffer.length,
    end: endExclusive,
    total_size: totalSize,
    encoding: "base64",
    content: chunkBuffer.toString("base64"),
    has_more: endExclusive < totalSize
  };
}
