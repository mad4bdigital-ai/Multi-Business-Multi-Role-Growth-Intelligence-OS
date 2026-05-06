// appAdapters/slack.js — Slack OAuth2 v2 adapter.

const SLACK_API = "https://slack.com/api";

async function slackReq(method, token, body = {}) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack API HTTP error ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

export const slackAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "list_channels",  auto_approve: true  },
      { action_key: "read_channel",   auto_approve: true  },
      { action_key: "send_message",   auto_approve: false },
      { action_key: "upload_file",    auto_approve: false },
      { action_key: "list_users",     auto_approve: true  },
    ];
  },

  buildAuthUrl(config, state) {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id",    config.client_id);
    url.searchParams.set("redirect_uri", config.redirect_uri);
    url.searchParams.set("scope",        "channels:read chat:write files:read users:read channels:history");
    url.searchParams.set("state",        state);
    return url.toString();
  },

  async exchangeCode(code, config) {
    const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     config.client_id,
        client_secret: config.client_secret,
        code,
        redirect_uri:  config.redirect_uri,
      }),
    });
    if (!res.ok) throw new Error(`Slack token exchange failed: ${await res.text()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack OAuth error: ${data.error}`);
    return {
      access_token: data.access_token,
      scope:        data.scope,
      team_id:      data.team?.id,
      team_name:    data.team?.name,
      bot_user_id:  data.bot_user_id,
    };
  },

  async refreshAccessToken() {
    throw new Error("Slack tokens do not expire and cannot be refreshed");
  },

  async testConnection(creds) {
    const data = await slackReq("auth.test", creds.access_token, {});
    return {
      ok:               true,
      account_label:    `${data.user} @ ${data.team}`,
      account_metadata: { user_id: data.user_id, team_id: data.team_id, team: data.team, url: data.url },
    };
  },

  async call(action_key, args, creds) {
    const token = creds.access_token;

    switch (action_key) {

      case "list_channels": {
        const { limit = 100, types = "public_channel" } = args;
        const data = await slackReq("conversations.list", token, { limit, types });
        return { ok: true, result: data.channels };
      }

      case "read_channel": {
        const { channel, limit = 50, oldest, latest } = args;
        if (!channel) throw new Error("channel required");
        const data = await slackReq("conversations.history", token, {
          channel, limit,
          ...(oldest ? { oldest } : {}),
          ...(latest ? { latest } : {}),
        });
        return { ok: true, result: { messages: data.messages, has_more: data.has_more } };
      }

      case "send_message": {
        const { channel, text, blocks, thread_ts } = args;
        if (!channel || !text) throw new Error("channel and text required");
        const data = await slackReq("chat.postMessage", token, {
          channel, text,
          ...(blocks    ? { blocks    } : {}),
          ...(thread_ts ? { thread_ts } : {}),
        });
        return { ok: true, result: { ts: data.ts, channel: data.channel } };
      }

      case "upload_file": {
        const { channel, content, filename, title } = args;
        if (!channel || !content || !filename) throw new Error("channel, content, filename required");
        // Use files.getUploadURLExternal (new API) for files >1MB; simple upload for small content
        const data = await slackReq("files.upload", token, {
          channels: channel, content, filename,
          ...(title ? { title } : {}),
        });
        return { ok: true, result: data.file };
      }

      case "list_users": {
        const { limit = 100 } = args;
        const data = await slackReq("users.list", token, { limit });
        return { ok: true, result: data.members };
      }

      default:
        throw new Error(`slack: unknown action '${action_key}'`);
    }
  },
};
