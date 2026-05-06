// appAdapters/notion.js — Notion OAuth2 adapter.
// Notion uses Basic Auth for token exchange (client_id:client_secret as base64).

const NOTION_API  = "https://api.notion.com/v1";
const NOTION_VER  = "2022-06-28";

function notionHeaders(token) {
  return {
    Authorization:       `Bearer ${token}`,
    "Notion-Version":    NOTION_VER,
    "Content-Type":      "application/json",
  };
}

async function notionReq(method, path, token, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: notionHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const notionAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "read_page",       auto_approve: true  },
      { action_key: "list_databases",  auto_approve: true  },
      { action_key: "query_database",  auto_approve: true  },
      { action_key: "create_page",     auto_approve: false },
      { action_key: "update_page",     auto_approve: false },
      { action_key: "search",          auto_approve: true  },
    ];
  },

  buildAuthUrl(config, state) {
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.searchParams.set("client_id",      config.client_id);
    url.searchParams.set("redirect_uri",   config.redirect_uri);
    url.searchParams.set("response_type",  "code");
    url.searchParams.set("owner",          "user");
    url.searchParams.set("state",          state);
    return url.toString();
  },

  async exchangeCode(code, config) {
    const basic = Buffer.from(`${config.client_id}:${config.client_secret}`).toString("base64");
    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization:  `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: config.redirect_uri }),
    });
    if (!res.ok) throw new Error(`Notion token exchange failed: ${await res.text()}`);
    const data = await res.json();
    // Notion tokens don't expire (no refresh_token)
    return { access_token: data.access_token, scope: data.scope };
  },

  async refreshAccessToken() {
    // Notion tokens don't expire — nothing to refresh
    throw new Error("Notion does not support token refresh");
  },

  async testConnection(creds) {
    const me = await notionReq("GET", "/users/me", creds.access_token);
    return {
      ok:               true,
      account_label:    me.person?.email || me.name || null,
      account_metadata: { id: me.id, name: me.name, avatar_url: me.avatar_url },
    };
  },

  async call(action_key, args, creds) {
    const token = creds.access_token;

    switch (action_key) {

      case "read_page": {
        const { page_id } = args;
        if (!page_id) throw new Error("page_id required");
        const [page, blocks] = await Promise.all([
          notionReq("GET", `/pages/${page_id}`, token),
          notionReq("GET", `/blocks/${page_id}/children`, token),
        ]);
        return { ok: true, result: { page, blocks: blocks.results } };
      }

      case "list_databases": {
        const data = await notionReq("POST", "/search", token, {
          filter: { property: "object", value: "database" },
          page_size: args.page_size || 20,
        });
        return { ok: true, result: data };
      }

      case "query_database": {
        const { database_id, filter, sorts, page_size = 20 } = args;
        if (!database_id) throw new Error("database_id required");
        const data = await notionReq("POST", `/databases/${database_id}/query`, token, {
          ...(filter ? { filter } : {}),
          ...(sorts  ? { sorts  } : {}),
          page_size,
        });
        return { ok: true, result: data };
      }

      case "create_page": {
        const { parent_id, parent_type = "database_id", title, properties, children } = args;
        if (!parent_id) throw new Error("parent_id required");
        const body = {
          parent:     { [parent_type]: parent_id },
          properties: properties || (title ? { title: { title: [{ text: { content: title } }] } } : {}),
          ...(children ? { children } : {}),
        };
        const data = await notionReq("POST", "/pages", token, body);
        return { ok: true, result: data };
      }

      case "update_page": {
        const { page_id, properties, archived } = args;
        if (!page_id) throw new Error("page_id required");
        const data = await notionReq("PATCH", `/pages/${page_id}`, token, {
          ...(properties ? { properties } : {}),
          ...(archived !== undefined ? { archived } : {}),
        });
        return { ok: true, result: data };
      }

      case "search": {
        const { query, filter, page_size = 20 } = args;
        const data = await notionReq("POST", "/search", token, {
          ...(query  ? { query  } : {}),
          ...(filter ? { filter } : {}),
          page_size,
        });
        return { ok: true, result: data };
      }

      default:
        throw new Error(`notion: unknown action '${action_key}'`);
    }
  },
};
