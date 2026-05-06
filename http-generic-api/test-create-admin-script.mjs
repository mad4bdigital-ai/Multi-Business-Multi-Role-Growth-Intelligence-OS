import assert from "node:assert/strict";
import {
  buildProvisioningInput,
  parseArgs,
  provisionAdminUser
} from "./scripts/create-admin.mjs";

function assertThrowsCode(label, fn, code) {
  try {
    fn();
    assert.fail(`${label} should throw`);
  } catch (error) {
    assert.equal(error.code, code, label);
  }
}

{
  const parsed = parseArgs([
    "--email",
    "Admin@Mad4B.com",
    "--display-name",
    "Admin User",
    "--tenant-id",
    "tenant-1",
    "--password-env",
    "ADMIN_SECRET",
    "--apply",
    "--json"
  ]);

  assert.equal(parsed.email, "Admin@Mad4B.com");
  assert.equal(parsed.displayName, "Admin User");
  assert.equal(parsed.tenantId, "tenant-1");
  assert.equal(parsed.passwordEnv, "ADMIN_SECRET");
  assert.equal(parsed.apply, true);
  assert.equal(parsed.json, true);
}

assertThrowsCode(
  "passwords are forbidden on the command line",
  () => parseArgs(["--password", "super-secret-value"]),
  "password_cli_forbidden"
);

{
  const input = buildProvisioningInput({
    argv: ["--email", "Admin@Mad4B.com", "--display-name", "Admin User"],
    env: {},
    uuid: () => "tenant-generated"
  });

  assert.equal(input.apply, false);
  assert.equal(input.email, "admin@mad4b.com");
  assert.equal(input.displayName, "Admin User");
  assert.equal(input.tenantId, "tenant-generated");
  assert.equal(input.passwordSource, "missing");
}

assertThrowsCode(
  "apply requires password env or password hash env",
  () => buildProvisioningInput({
    argv: ["--email", "admin@mad4b.com", "--display-name", "Admin User", "--apply"],
    env: {},
    uuid: () => "tenant-1"
  }),
  "missing_admin_password_secret"
);

assertThrowsCode(
  "short admin password is rejected",
  () => buildProvisioningInput({
    argv: ["--email", "admin@mad4b.com", "--display-name", "Admin User", "--apply"],
    env: { ADMIN_INITIAL_PASSWORD: "short" },
    uuid: () => "tenant-1"
  }),
  "weak_admin_password"
);

{
  const input = buildProvisioningInput({
    argv: ["--email", "admin@mad4b.com", "--display-name", "Admin User"],
    env: {},
    uuid: () => "tenant-1"
  });

  const result = await provisionAdminUser({ input });
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.input.email, "admin@mad4b.com");
  assert.equal(result.input.password_source, "missing");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
}

{
  const queries = [];
  const connection = {
    async beginTransaction() {
      queries.push({ type: "begin" });
    },
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM `users`")) return [[]];
      if (sql.includes("FROM `user_credentials`")) return [[]];
      if (sql.includes("FROM `actor_profiles`")) return [[]];
      if (sql.includes("FROM `role_assignments`")) return [[]];
      return [{ affectedRows: 1 }];
    },
    async commit() {
      queries.push({ type: "commit" });
    },
    async rollback() {
      queries.push({ type: "rollback" });
    },
    release() {
      queries.push({ type: "release" });
    }
  };

  const pool = {
    async getConnection() {
      return connection;
    }
  };

  const input = buildProvisioningInput({
    argv: [
      "--email",
      "admin@mad4b.com",
      "--display-name",
      "Admin User",
      "--tenant-id",
      "tenant-1",
      "--apply"
    ],
    env: { ADMIN_INITIAL_PASSWORD_HASH: "$2b$12$reviewedhash" },
    uuid: () => "unused"
  });

  const ids = ["user-1", "profile-1", "assignment-1"];
  const result = await provisionAdminUser({
    input,
    pool,
    uuid: () => ids.shift()
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, false);
  assert.equal(result.user_id, "user-1");
  assert.equal(result.created.user, true);
  assert.equal(result.created.credentials, true);
  assert.equal(result.created.actor_profile, true);
  assert.equal(result.created.role_assignment, true);
  assert.equal(queries.some((entry) => entry.type === "commit"), true);
  assert.equal(queries.some((entry) => entry.type === "rollback"), false);
  assert.equal(JSON.stringify(queries).includes("ADMIN_INITIAL_PASSWORD"), false);
}

console.log("create-admin script tests passed");
