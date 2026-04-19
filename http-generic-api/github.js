// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH } from "./config.js";

export async function fetchGitHubBlobPayload({ owner, repo, fileSha }) {
  const token = requireGithubToken();
  const url =
    `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(fileSha)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const err = new Error(
      payload?.message || `GitHub blob fetch failed with status ${response.status}.`
    );
    err.code =
      response.status === 404 ? "github_blob_not_found" : "github_blob_fetch_failed";
    err.status = response.status === 404 ? 404 : 502;
    throw err;
  }

  if (String(payload?.encoding || "").trim().toLowerCase() !== "base64") {
    const err = new Error("GitHub blob response encoding is not base64.");
    err.code = "github_blob_encoding_unsupported";
    err.status = 502;
    throw err;
  }

  return payload;
}

export async function githubGitBlobChunkRead({ input = {} }) {
  const owner = assertNonEmptyString(input.owner, "owner");
  const repo = assertNonEmptyString(input.repo, "repo");
  const fileSha = assertNonEmptyString(
    input.file_sha || input.fileSha,
    "file_sha"
  );

  const start = parseBoundedInteger(
    input.start,
    "start",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const length = parseBoundedInteger(
    input.length,
    "length",
    1,
    GITHUB_BLOB_CHUNK_MAX_LENGTH
  );

  const blob = await fetchGitHubBlobPayload({
    owner,
    repo,
    fileSha
  });

  const blobBuffer = decodeBase64ToBuffer(blob.content);
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
    start,
    length: chunkBuffer.length,
    end: endExclusive,
    total_size: totalSize,
    encoding: "base64",
    content: chunkBuffer.toString("base64"),
    has_more: endExclusive < totalSize
  };
}
