import { getPool } from "./db.js";

export async function validateMonitoringSurfaceReadiness() {
  try {
    await getPool().query("SELECT 1 FROM telemetry_spans LIMIT 1");
    return { ready: true, surface: "telemetry_spans" };
  } catch (err) {
    return { ready: false, surface: "telemetry_spans", reason: err.message };
  }
}
