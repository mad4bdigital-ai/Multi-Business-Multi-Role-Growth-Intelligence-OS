import { Router } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(__dirname, "../../local-connector/server.mjs");

let agentSource = null;
function getAgentSource() {
  if (!agentSource) agentSource = readFileSync(AGENT_PATH, "utf8");
  return agentSource;
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  // Public — no auth. Returns the connector agent script for self-install.
  router.get("/connector-agent/server.mjs", (_req, res) => {
    try {
      const src = getAgentSource();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="server.mjs"');
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(src);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "agent_not_found", message: err.message } });
    }
  });

  return router;
}
