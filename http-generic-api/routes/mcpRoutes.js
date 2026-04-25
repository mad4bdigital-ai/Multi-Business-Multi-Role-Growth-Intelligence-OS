import { Router } from "express";

export function buildMcpRoutes(deps) {
  const {
    requireMcpToken,
    requireMcpAcceptHeader,
    mcpInitialize,
    mcpToolsList,
    mcpToolsCall
  } = deps;

  const router = Router();

  // --- MCP Protocol Endpoints (PR-4) ---
  router.post("/mcp/initialize", requireMcpToken, requireMcpAcceptHeader, mcpInitialize);
  router.get("/mcp/tools/list", requireMcpToken, requireMcpAcceptHeader, mcpToolsList);
  router.post("/mcp/tools/call", requireMcpToken, requireMcpAcceptHeader, mcpToolsCall);

  return router;
}
