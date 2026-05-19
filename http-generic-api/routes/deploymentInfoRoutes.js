import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJsonFile(file) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readDeploymentCommit() {
  const candidates = [
    path.resolve(process.cwd(), "DEPLOYMENT_COMMIT.json"),
    path.resolve(process.cwd(), "http-generic-api", "DEPLOYMENT_COMMIT.json"),
  ];
  for (const file of candidates) {
    const value = await readJsonFile(file);
    if (value) return { ...value, _source_file: file };
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return null;
}

function sourceFor(value, pairs = []) {
  if (!value) return "unavailable";
  for (const [source, candidate] of pairs) {
    if (String(candidate || "").trim() === value) return source;
  }
  return "derived";
}

function looksLikeSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || "").trim());
}

function branchFromRef(refName) {
  const value = String(refName || "").trim();
  if (!value.startsWith("refs/heads/")) return null;
  return value.slice("refs/heads/".length) || null;
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function findGitDir() {
  const candidates = [
    path.resolve(process.cwd(), ".git"),
    path.resolve(process.cwd(), "..", ".git"),
    path.resolve(process.cwd(), "http-generic-api", "..", ".git"),
  ];
  for (const candidate of candidates) {
    const head = await readText(path.join(candidate, "HEAD"));
    if (head) return candidate;
  }
  return null;
}

async function readPackedRef(gitDir, refName) {
  const raw = await readText(path.join(gitDir, "packed-refs"));
  if (!raw) return null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === refName && looksLikeSha(sha)) return sha;
  }
  return null;
}

async function readGitCheckoutInfo() {
  const gitDir = await findGitDir();
  if (!gitDir) return null;
  const headRaw = String(await readText(path.join(gitDir, "HEAD")) || "").trim();
  if (!headRaw) return null;

  if (looksLikeSha(headRaw)) {
    return { branch: null, commit_sha: headRaw, git_source: "git_head_detached", git_dir_detected: true };
  }

  const m = headRaw.match(/^ref:\s*(.+)$/);
  if (!m) return null;
  const refName = m[1].trim();
  const refFile = path.join(gitDir, refName);
  const directSha = String(await readText(refFile) || "").trim();
  const packedSha = directSha ? null : await readPackedRef(gitDir, refName);
  const commitSha = looksLikeSha(directSha) ? directSha : packedSha;
  return {
    branch: branchFromRef(refName),
    commit_sha: commitSha || null,
    git_ref: refName,
    git_source: commitSha ? (directSha ? "git_ref_file" : "git_packed_refs") : "git_ref_unresolved",
    git_dir_detected: true,
  };
}

export function buildDeploymentInfoRoutes() {
  const router = Router();

  router.get("/deployment-info", async (req, res) => {
    const deployment = await readDeploymentCommit();
    const git = await readGitCheckoutInfo();
    const host = String(req.headers.host || "").toLowerCase();
    const isDevHostname = host.startsWith("dev.mad4b.com");
    const branch = firstString(
      deployment?.branch,
      process.env.GITHUB_REF_NAME,
      process.env.DEPLOY_BRANCH,
      process.env.BRANCH_NAME,
      git?.branch,
      isDevHostname ? "dev-autopilot-routing" : null
    );
    const commitSha = firstString(
      deployment?.commit_sha,
      deployment?.commit,
      process.env.GITHUB_SHA,
      process.env.DEPLOY_COMMIT,
      process.env.COMMIT_SHA,
      process.env.REVISION_SHA,
      git?.commit_sha
    );

    res.status(200).json({
      ok: true,
      service: "growth-intelligence-platform",
      hostname: req.headers.host || null,
      branch,
      branch_source: sourceFor(branch, [
        ["DEPLOYMENT_COMMIT.json", deployment?.branch],
        ["GITHUB_REF_NAME", process.env.GITHUB_REF_NAME],
        ["DEPLOY_BRANCH", process.env.DEPLOY_BRANCH],
        ["BRANCH_NAME", process.env.BRANCH_NAME],
        ["git_checkout", git?.branch],
        ["dev_hostname_fallback", isDevHostname ? "dev-autopilot-routing" : null],
      ]),
      commit: commitSha,
      commit_sha: commitSha,
      commit_source: sourceFor(commitSha, [
        ["DEPLOYMENT_COMMIT.json", deployment?.commit_sha || deployment?.commit],
        ["GITHUB_SHA", process.env.GITHUB_SHA],
        ["DEPLOY_COMMIT", process.env.DEPLOY_COMMIT],
        ["COMMIT_SHA", process.env.COMMIT_SHA],
        ["REVISION_SHA", process.env.REVISION_SHA],
        [git?.git_source || "git_checkout", git?.commit_sha],
      ]),
      deployment,
      git: git ? {
        branch: git.branch || null,
        ref: git.git_ref || null,
        source: git.git_source,
        detected: Boolean(git.git_dir_detected),
      } : { detected: false },
      app_env: process.env.APP_ENV || process.env.NODE_ENV || null,
      expected_dev_branch: "dev-autopilot-routing",
      is_dev_hostname: isDevHostname,
      generated_at: new Date().toISOString(),
    });
  });

  return router;
}
