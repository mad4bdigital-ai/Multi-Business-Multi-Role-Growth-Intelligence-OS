/**
 * Unit tests for jobRunner queue behavior
 * Run: node test-job-runner.mjs
 */

import { configureJobRunner } from "./jobRunner.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

function createJobRepository(seedJob) {
  const store = new Map([[seedJob.job_id, { ...seedJob }]]);
  return {
    get(jobId) {
      return store.get(String(jobId || "").trim()) || null;
    },
    set(job) {
      store.set(job.job_id, job);
      return job;
    }
  };
}

const baseJob = {
  job_id: "job_123",
  status: "queued",
  attempt_count: 0,
  max_attempts: 1,
  request_payload: {},
  parent_action_key: "site_migration_controller",
  endpoint_key: "site_migrate"
};

section("jobRunner — enqueueJob");

{
  const calls = [];
  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(baseJob),
      async executeSiteMigrationJob() {
        return { success: true, statusCode: 200, payload: { ok: true } };
      },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: {
        async add(name, job, opts) {
          calls.push({ name, job, opts });
          return { id: "bull_1" };
        }
      }
    }
  );

  const result = await runner.enqueueJob(baseJob.job_id);
  assert("enqueueJob reports success", result?.ok === true, JSON.stringify(result));
  assert("enqueueJob calls queue with execute job name", calls[0]?.name === "execute", JSON.stringify(calls[0]));
  assert("enqueueJob forwards stable BullMQ options", calls[0]?.opts?.jobId === baseJob.job_id && calls[0]?.opts?.attempts === 1, JSON.stringify(calls[0]?.opts));
}

{
  const err = new Error("Redis unavailable");
  err.code = "ECONNREFUSED";

  const runner = configureJobRunner(
    {
      jobRepository: createJobRepository(baseJob),
      async executeSiteMigrationJob() {
        return { success: true, statusCode: 200, payload: { ok: true } };
      },
      async performUniversalServerWriteback() {},
      async logRetryWriteback() {}
    },
    {
      queueApi: {
        async add() {
          throw err;
        }
      }
    }
  );

  const result = await runner.enqueueJob(baseJob.job_id);
  assert("enqueueJob reports queue failure", result?.ok === false, JSON.stringify(result));
  assert("enqueueJob preserves queue error code", result?.error?.code === "ECONNREFUSED", JSON.stringify(result));
  assert("enqueueJob preserves queue error message", result?.error?.message === "Redis unavailable", JSON.stringify(result));
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL JOB RUNNER TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
