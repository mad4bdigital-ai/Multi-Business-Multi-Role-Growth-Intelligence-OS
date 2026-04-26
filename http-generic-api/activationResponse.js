import { classifyActivation } from "./activationClassification.js";
import { buildActivationProgress } from "./activationProgress.js";
import { buildActivationRecoveryPolicy } from "./activationRecoveryPolicy.js";
import { buildActivationOperatorView } from "./activationOperatorView.js";
import { checkActivationConsistency } from "./activationConsistencyCheck.js";

export function buildActivationEnvelope(evidence = {}) {
  const runtime_classification = classifyActivation(evidence);
  const progress = buildActivationProgress(runtime_classification.evidence);
  const recovery = buildActivationRecoveryPolicy(runtime_classification);
  const operator_view = buildActivationOperatorView(runtime_classification, progress, recovery);
  const consistency = checkActivationConsistency(runtime_classification.evidence);

  return {
    runtime_classification: {
      ...runtime_classification,
      progress,
      ...consistency
    },
    recovery,
    operator_view
  };
}
