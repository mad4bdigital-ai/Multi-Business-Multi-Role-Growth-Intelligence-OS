// appAdapters/github.js — GitHub OAuth2 adapter.
// Supports both OAuth tokens and Personal Access Tokens (stored as api_key in creds).

const GH_API = "https://api.github.com";

async function ghReq(method, path, token, body) {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const githubAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "list_repos",   auto_approve: true  },
      { action_key: "read_file",    auto_approve: true  },
      { action_key: "list_issues",  auto_approve: true  },
      { action_key: "write_file",   auto_approve: false },
      { action_key: "create_issue", auto_approve: false },
      { action_key: "create_pr",    auto_approve: false },
    ];
  },

  buildAuthUrl(config, state) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id",    config.client_id);
    url.searchParams.set("redirect_uri", config.redirect_uri);
    url.searchParams.set("scope",        "repo read:user read:org");
    url.searchParams.set("state",        state);
    return url.toString();
  },

  async exchangeCode(code, config) {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.client_id, client_secret: config.client_secret, code, redirect_uri: config.redirect_uri }),
    });
    if (!res.ok) throw new Error(`GitHub token exchange failed: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(`GitHub token error: ${data.error_description || data.error}`);
    // GitHub OAuth tokens don't expire by default
    return { access_token: data.access_token, scope: data.scope };
  },

  async refreshAccessToken() {
    throw new Error("GitHub OAuth tokens do not expire and cannot be refreshed");
  },

  async testConnection(creds) {
    const token = creds.access_token || creds.api_key;
    const me = await ghReq("GET", "/user", token);
    return {
      ok:               true,
      account_label:    me.login || null,
      account_metadata: { id: me.id, name: me.name, avatar_url: me.avatar_url, login: me.login },
    };
  },

  async call(action_key, args, creds) {
    const token = creds.access_token || creds.api_key;

    switch (action_key) {

      case "list_repos": {
        const { org, per_page = 30, type = "all" } = args;
        const path = org ? `/orgs/${org}/repos?per_page=${per_page}&type=${type}`
                         : `/user/repos?per_page=${per_page}&type=${type}`;
        const data = await ghReq("GET", path, token);
        return { ok: true, result: data };
      }

      case "read_file": {
        const { owner, repo, path: filePath, ref } = args;
        if (!owner || !repo || !filePath) throw new Error("owner, repo, path required");
        const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const data = await ghReq("GET", `/repos/${owner}/${repo}/contents/${filePath}${qs}`, token);
        // Decode base64 content
        const content = data.content ? Buffer.from(data.content, "base64").toString("utf8") : null;
        return { ok: true, result: { ...data, decoded_content: content } };
      }

      case "write_file": {
        const { owner, repo, path: filePath, content, message, branch, sha } = args;
        if (!owner || !repo || !filePath || !content || !message) throw new Error("owner, repo, path, content, message required");
        const encoded = Buffer.from(content).toString("base64");
        const data = await ghReq("PUT", `/repos/${owner}/${repo}/contents/${filePath}`, token, {
          message,
          content: encoded,
          ...(branch ? { branch } : {}),
          ...(sha    ? { sha    } : {}),
        });
        return { ok: true, result: data };
      }

      case "list_issues": {
        const { owner, repo, state = "open", per_page = 20, labels } = args;
        if (!owner || !repo) throw new Error("owner and repo required");
        let path = `/repos/${owner}/${repo}/issues?state=${state}&per_page=${per_page}`;
        if (labels) path += `&labels=${encodeURIComponent(labels)}`;
        const data = await ghReq("GET", path, token);
        return { ok: true, result: data };
      }

      case "create_issue": {
        const { owner, repo, title, body, labels, assignees } = args;
        if (!owner || !repo || !title) throw new Error("owner, repo, title required");
        const data = await ghReq("POST", `/repos/${owner}/${repo}/issues`, token, {
          title,
          ...(body      ? { body      } : {}),
          ...(labels    ? { labels    } : {}),
          ...(assignees ? { assignees } : {}),
        });
        return { ok: true, result: data };
      }

      case "create_pr": {
        const { owner, repo, title, head, base, body, draft = false } = args;
        if (!owner || !repo || !title || !head || !base) throw new Error("owner, repo, title, head, base required");
        const data = await ghReq("POST", `/repos/${owner}/${repo}/pulls`, token, {
          title, head, base, draft,
          ...(body ? { body } : {}),
        });
        return { ok: true, result: data };
      }

      default:
        throw new Error(`github: unknown action '${action_key}'`);
    }
  },
};
