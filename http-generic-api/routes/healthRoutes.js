import { Router } from "express";

export function buildHealthRoutes(deps) {
  const {
    jobRepository,
    normalizeJobStatus,
    getWaitingCountSafe,
    getRedisRuntimeStatus,
    SERVICE_VERSION,
    QUEUE_WORKER_ENABLED
  } = deps;

  const router = Router();

  router.get("/health", async (_req, res) => {
    const counts = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
      cancelled: 0
    };
    for (const job of jobRepository.values()) {
      const status = normalizeJobStatus(job.status);
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    }

    const queueHealth = await getWaitingCountSafe();
    const redisHealth = getRedisRuntimeStatus();
    const dependencyStatus = redisHealth.connected && queueHealth.ok ? "healthy" : "degraded";

    res.json({
      ok: true,
      service: "http_generic_api_connector",
      status: dependencyStatus,
      version: SERVICE_VERSION,
      jobs: {
        total: jobRepository.size(),
        queued_buffer_size: queueHealth.count,
        statuses: counts
      },
      dependencies: {
        redis: redisHealth,
        queue: queueHealth.ok
          ? { connected: true }
          : {
              connected: false,
              error: queueHealth.error
            },
        worker: {
          enabled: QUEUE_WORKER_ENABLED
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
