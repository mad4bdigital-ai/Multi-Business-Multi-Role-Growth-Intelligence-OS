import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcrypt";
import { getPool } from "../db.js";

const DEFAULT_PASSWORD_ENV = "ADMIN_INITIAL_PASSWORD";
const DEFAULT_PASSWORD_HASH_ENV = "ADMIN_INITIAL_PASSWORD_HASH";

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseArgs(argv = []) {
  const options = {
    apply: false,
    json: false,
    email: "",
    displayName: "",
    tenantId: "",
    passwordEnv: DEFAULT_PASSWORD_ENV,
    passwordHashEnv: DEFAULT_PASSWORD_HASH_ENV
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[i];
    };

    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--email") options.email = next();
    else if (arg === "--display-name") options.displayName = next();
    else if (arg === "--tenant-id") options.tenantId = next();
    else if (arg === "--password-env") options.passwordEnv = next();
    else if (arg === "--password-hash-env") options.passwordHashEnv = next();
    else if (arg === "--password" || arg.startsWith("--password=")) {
      const err = new Error("Do not pass passwords on the command line. Use --password-env or --password-hash-env.");
      err.code = "password_cli_forbidden";
      throw err;
    } else {
      const err = new Error(`Unknown option: ${arg}`);
      err.code = "unknown_option";
      throw err;
    }
  }

  return options;
}

function requireNonEmpty(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    const err = new Error(`${label} is required.`);
    err.code = "missing_required_field";
    throw err;
  }
  return text;
}

function validateEmail(email) {
  const normalized = requireNonEmpty(email, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    const err = new Error("email must be a valid email address.");
    err.code = "invalid_email";
    throw err;
  }
  return normalized;
}

function readSecretEnv(env, name) {
  const envName = String(name || "").trim();
  if (!envName) return "";
  return String(env[envName] || "");
}

export function buildProvisioningInput({ argv = [], env = process.env, uuid = randomUUID } = {}) {
  const options = parseArgs(argv);
  const password = readSecretEnv(env, options.passwordEnv);
  const passwordHash = readSecretEnv(env, options.passwordHashEnv);
  const tenantId = String(options.tenantId || "").trim() || uuid();

  const input = {
    apply: options.apply,
    json: options.json,
    email: validateEmail(options.email || env.ADMIN_EMAIL),
    displayName: requireNonEmpty(options.displayName || env.ADMIN_DISPLAY_NAME, "displayName"),
    tenantId,
    password,
    passwordHash,
    passwordSource: passwordHash ? "hash_env" : password ? "password_env" : "missing"
  };

  if (input.apply && !input.password && !input.passwordHash) {
    const err = new Error(
      `Set ${options.passwordEnv} or ${options.passwordHashEnv} before running with --apply.`
    );
    err.code = "missing_admin_password_secret";
    throw err;
  }

  if (input.password && input.password.length < 12) {
    const err = new Error("Admin password must be at least 12 characters.");
    err.code = "weak_admin_password";
    throw err;
  }

  return input;
}

function publicInput(input) {
  return {
    apply: Boolean(input.apply),
    email: input.email,
    display_name: input.displayName,
    tenant_id: input.tenantId,
    password_source: input.passwordSource
  };
}

function makeDryRunPlan(input) {
  return {
    ok: true,
    dry_run: true,
    would_apply: false,
    input: publicInput(input),
    planned_operations: [
      "upsert active user",
      "upsert platform credential password hash",
      "ensure platform_owner actor profile",
      "ensure admin role assignment"
    ]
  };
}

async function resolvePasswordHash(input) {
  if (input.passwordHash) return input.passwordHash;
  return bcrypt.hash(input.password, 12);
}

export async function provisionAdminUser({ input, pool, uuid = randomUUID } = {}) {
  if (!input?.apply) return makeDryRunPlan(input);

  const effectivePool = pool || getPool();
  const connection = await effectivePool.getConnection();
  const result = {
    ok: true,
    dry_run: false,
    input: publicInput(input),
    user_id: "",
    tenant_id: input.tenantId,
    created: {
      user: false,
      credentials: false,
      actor_profile: false,
      role_assignment: false
    },
    updated: {
      credentials: false
    }
  };

  try {
    await connection.beginTransaction();

    const [existingUsers] = await connection.query(
      "SELECT user_id FROM `users` WHERE email = ? LIMIT 1",
      [input.email]
    );

    let userId;
    if (existingUsers.length > 0) {
      userId = existingUsers[0].user_id;
    } else {
      userId = uuid();
      await connection.query(
        "INSERT INTO `users` (user_id, email, display_name, status) VALUES (?, ?, ?, 'active')",
        [userId, input.email, input.displayName]
      );
      result.created.user = true;
    }
    result.user_id = userId;

    const [existingCreds] = await connection.query(
      "SELECT id FROM `user_credentials` WHERE user_id = ? AND auth_provider = 'platform' LIMIT 1",
      [userId]
    );

    const passwordHash = await resolvePasswordHash(input);
    if (existingCreds.length > 0) {
      await connection.query(
        "UPDATE `user_credentials` SET password_hash = ? WHERE user_id = ? AND auth_provider = 'platform'",
        [passwordHash, userId]
      );
      result.updated.credentials = true;
    } else {
      await connection.query(
        "INSERT INTO `user_credentials` (user_id, auth_provider, password_hash) VALUES (?, 'platform', ?)",
        [userId, passwordHash]
      );
      result.created.credentials = true;
    }

    const [existingActor] = await connection.query(
      "SELECT id FROM `actor_profiles` WHERE user_id = ? AND tenant_id = ? LIMIT 1",
      [userId, input.tenantId]
    );

    if (existingActor.length === 0) {
      await connection.query(
        "INSERT INTO `actor_profiles` (profile_id, user_id, tenant_id, actor_type) VALUES (?, ?, ?, 'platform_owner')",
        [uuid(), userId, input.tenantId]
      );
      result.created.actor_profile = true;
    }

    const [existingRole] = await connection.query(
      "SELECT id FROM `role_assignments` WHERE user_id = ? AND tenant_id = ? AND role = 'admin' LIMIT 1",
      [userId, input.tenantId]
    );

    if (existingRole.length === 0) {
      await connection.query(
        "INSERT INTO `role_assignments` (assignment_id, user_id, tenant_id, role) VALUES (?, ?, ?, 'admin')",
        [uuid(), userId, input.tenantId]
      );
      result.created.role_assignment = true;
    }

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function writeResult(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("--- Growth Intelligence Platform ---");
  console.log("Admin User Provisioning Tool");
  console.log(`Mode: ${result.dry_run ? "dry-run" : "apply"}`);
  console.log(`Email: ${result.input.email}`);
  console.log(`Tenant ID: ${result.input.tenant_id}`);
  if (result.dry_run) {
    console.log("No database writes performed. Re-run with --apply after setting password env.");
  } else {
    console.log(`User ID: ${result.user_id}`);
    console.log("Admin user provisioning completed.");
  }
}

async function main() {
  try {
    const input = buildProvisioningInput({
      argv: process.argv.slice(2),
      env: process.env
    });
    const result = await provisionAdminUser({ input });
    writeResult(result, input.json);
  } catch (error) {
    const body = {
      ok: false,
      error: {
        code: error.code || "admin_provisioning_failed",
        message: error.message || "Admin provisioning failed."
      }
    };
    if (parseBoolean(process.env.ADMIN_PROVISIONING_JSON_ERRORS)) {
      console.error(JSON.stringify(body, null, 2));
    } else {
      console.error(`ERROR: ${body.error.message}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
