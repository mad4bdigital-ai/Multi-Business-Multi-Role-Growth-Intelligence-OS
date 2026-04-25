import { buildHealthRoutes } from "./healthRoutes.js";
import { buildMcpRoutes } from "./mcpRoutes.js";
import { buildGovernanceRoutes } from "./governanceRoutes.js";
import { buildJobRoutes } from "./jobRoutes.js";
import { buildExecuteRoutes } from "./executeRoutes.js";

export function registerRoutes(app, deps) {
  app.use(buildHealthRoutes(deps));
  app.use(buildMcpRoutes(deps));
  app.use(buildGovernanceRoutes(deps));
  app.use(buildJobRoutes(deps));
  app.use(buildExecuteRoutes(deps));
}
