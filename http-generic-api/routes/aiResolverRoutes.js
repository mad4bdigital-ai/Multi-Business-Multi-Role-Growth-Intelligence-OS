import { Router } from "express";
import {
  formatIntentMaturationForPrompt as defaultFormatIntentMaturationForPrompt,
  resolveAiIntentMaturation as defaultResolveAiIntentMaturation
} from "../services/intentMaturationResolver.js";

export function buildAiResolverRoutes(deps) {
  const {
    requireBackendApiKey,
    generateImplementationPlan,
    generateTaskManifest,
    resolveAiIntentMaturation = defaultResolveAiIntentMaturation,
    formatIntentMaturationForPrompt = defaultFormatIntentMaturationForPrompt
  } = deps;

  const router = Router();

  router.post("/ai/implementation-plan", requireBackendApiKey, async (req, res) => {
    try {
      const intentMaturation = resolveAiIntentMaturation(req.body || {}, "implementation_plan");
      if (intentMaturation.blocked_reason) {
        return res.status(400).json({
          ok: false,
          code: "intent_maturation_blocked",
          error: intentMaturation.blocked_reason,
          intent_maturation: intentMaturation
        });
      }

      const result = await generateImplementationPlan({
        ...(req.body || {}),
        systemContext: [
          req.body?.systemContext || "",
          formatIntentMaturationForPrompt(intentMaturation)
        ].filter(Boolean).join("\n\n")
      });
      return res.status(200).json({
        ok: true,
        type: "implementation_plan",
        intent_maturation: intentMaturation,
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
      const intentMaturation = resolveAiIntentMaturation(req.body || {}, "task_manifest");
      if (intentMaturation.blocked_reason) {
        return res.status(400).json({
          ok: false,
          code: "intent_maturation_blocked",
          error: intentMaturation.blocked_reason,
          intent_maturation: intentMaturation
        });
      }

      const result = await generateTaskManifest({
        ...(req.body || {}),
        systemContext: [
          req.body?.systemContext || "",
          formatIntentMaturationForPrompt(intentMaturation)
        ].filter(Boolean).join("\n\n")
      });
      return res.status(200).json({
        ok: true,
        type: "task_manifest",
        intent_maturation: intentMaturation,
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
