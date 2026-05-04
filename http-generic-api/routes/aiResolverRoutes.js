import { Router } from "express";

export function buildAiResolverRoutes(deps) {
  const {
    requireBackendApiKey,
    generateImplementationPlan,
    generateTaskManifest
  } = deps;

  const router = Router();

  router.post("/ai/implementation-plan", requireBackendApiKey, async (req, res) => {
    try {
      const result = await generateImplementationPlan(req.body || {});
      return res.status(200).json({
        ok: true,
        type: "implementation_plan",
        ...result
      });
    } catch (err) {
      return res.status(err.status || 400).json({
        ok: false,
        code: err.code || "planning_resolver_failed",
        error: err.message
      });
    }
  });

  router.post("/ai/task-manifest", requireBackendApiKey, async (req, res) => {
    try {
      const result = await generateTaskManifest(req.body || {});
      return res.status(200).json({
        ok: true,
        type: "task_manifest",
        ...result
      });
    } catch (err) {
      return res.status(err.status || 400).json({
        ok: false,
        code: err.code || "task_resolver_failed",
        error: err.message
      });
    }
  });

  return router;
}
