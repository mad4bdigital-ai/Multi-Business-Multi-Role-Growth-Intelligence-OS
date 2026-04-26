export function buildActivationProgress(evidence = {}) {
  const completed = [];

  if (evidence.transport_attempted) completed.push("transport_attempting");
  if (evidence.drive_ok) completed.push("drive_validation");
  if (evidence.sheets_ok) completed.push("sheets_validation");
  if (evidence.bootstrap_row_read && evidence.binding_resolved) completed.push("bootstrap_resolution");
  if (evidence.github_ok) completed.push("github_validation");
  if (evidence.validation_complete) completed.push("final_validation");

  let current_stage = "starting";
  let blocked_stage = "";

  if (!evidence.transport_attempted) {
    current_stage = "transport_attempting";
    blocked_stage = "transport_attempting";
  } else if (!evidence.drive_ok) {
    current_stage = "drive_validation";
    blocked_stage = "drive_validation";
  } else if (!evidence.sheets_ok) {
    current_stage = "sheets_validation";
    blocked_stage = "sheets_validation";
  } else if (!(evidence.bootstrap_row_read && evidence.binding_resolved)) {
    current_stage = "bootstrap_resolution";
    blocked_stage = "bootstrap_resolution";
  } else if (!evidence.github_ok) {
    current_stage = "github_validation";
    blocked_stage = "github_validation";
  } else if (!evidence.validation_complete) {
    current_stage = "final_validation";
    blocked_stage = "final_validation";
  } else {
    current_stage = "complete";
  }

  const allStages = [
    "transport_attempting",
    "drive_validation",
    "sheets_validation",
    "bootstrap_resolution",
    "github_validation",
    "final_validation",
    "complete"
  ];

  return {
    current_stage,
    completed_stages: completed,
    pending_stages: allStages.filter(stage => stage !== current_stage && !completed.includes(stage)),
    blocked_stage
  };
}
