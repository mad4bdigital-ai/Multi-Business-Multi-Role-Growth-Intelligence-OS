export function computeExecutionScore({ status, http_status, error_code, duration_seconds, response_body } = {}) {
  let score = 100;
  if (status !== "success") score -= 40;
  if (http_status >= 500) score -= 30;
  else if (http_status >= 400) score -= 20;
  if (error_code) score -= 10;
  if (duration_seconds > 60) score -= 20;
  else if (duration_seconds > 30) score -= 10;
  return Math.min(100, Math.max(0, score));
}

export function classifyRecoveryStatus({ score_before, score_after, threshold_recovered = 70, threshold_degraded = 40 } = {}) {
  if (score_after >= threshold_recovered && score_after >= score_before) return "recovered";
  if (score_after >= threshold_recovered) return "stable";
  if (score_after >= threshold_degraded) return "degraded";
  return "failed";
}

export function computeScoringBlock(executionResult = {}, scoreBefore = 0) {
  const score_before = scoreBefore ?? 0;
  const score_after = computeExecutionScore(executionResult);
  const performance_delta = score_after - score_before;
  const recovery_status = classifyRecoveryStatus({ score_before, score_after });
  return { score_before, score_after, performance_delta, recovery_status };
}
