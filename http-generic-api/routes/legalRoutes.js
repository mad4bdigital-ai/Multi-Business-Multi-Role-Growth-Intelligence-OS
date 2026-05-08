import { Router } from "express";

const EFFECTIVE_DATE = "2026-05-05";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requestHost(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "mad4b.com");
  return host.split(":")[0].toLowerCase();
}

function privacyPolicyHtml(req) {
  const host = escapeHtml(requestHost(req));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Privacy Policy | Growth Intelligence Platform</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#f7f8fb;color:#1f2937;line-height:1.6}
    header{background:#ffffff;border-bottom:1px solid #dde3ea;padding:28px 24px}
    main{max-width:820px;margin:0 auto;padding:32px 24px 56px}
    h1{font-size:30px;line-height:1.2;margin:0 0 8px;color:#111827}
    h2{font-size:18px;margin:30px 0 10px;color:#111827}
    p,li{font-size:15px}
    ul{padding-left:22px}
    .meta{color:#607085;font-size:14px;margin:0}
    .panel{background:#ffffff;border:1px solid #dde3ea;border-radius:8px;padding:24px;margin-top:24px}
    .host{display:inline-block;background:#eef4ff;border:1px solid #c7d7fe;color:#1e3a8a;border-radius:999px;padding:4px 10px;font-size:13px;margin-top:10px}
    footer{border-top:1px solid #dde3ea;color:#607085;font-size:13px;padding:20px 24px;text-align:center}
    a{color:#1d4ed8}
  </style>
</head>
<body>
  <header>
    <main style="padding:0;max-width:820px">
      <h1>Privacy Policy</h1>
      <p class="meta">Growth Intelligence Platform | Effective ${EFFECTIVE_DATE}</p>
      <span class="host">Applies to ${host}</span>
    </main>
  </header>
  <main>
    <section class="panel">
      <p>
        This Privacy Policy explains how the Growth Intelligence Platform handles information
        when you use our API, Custom GPT actions, admin tooling, and connected workflow services.
      </p>

      <h2>Information We Process</h2>
      <ul>
        <li>Account and authentication data, such as email address, user identifiers, role assignments, and session tokens.</li>
        <li>Operational records, including request envelopes, execution logs, audit events, telemetry, job status, and error diagnostics.</li>
        <li>Business configuration data, including tenant, brand, registry, workflow, route, entitlement, and connected-system metadata.</li>
        <li>Prompt and response history when session-context, auditability, troubleshooting, or governed activation requires it.</li>
        <li>Connector data needed to operate integrations such as Google Workspace, GitHub, hosting providers, databases, and automation services.</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>Authenticate users and enforce admin, service, tenant, and role-based access boundaries.</li>
        <li>Run governed platform workflows, Custom GPT actions, validation checks, and integration dispatch.</li>
        <li>Maintain session continuity, activation evidence, system health, auditability, and incident investigation history.</li>
        <li>Improve reliability, security, and operational correctness of the platform.</li>
      </ul>

      <h2>Connected Services</h2>
      <p>
        The platform can connect to third-party services selected by your administrators, including
        Google Workspace, GitHub, hosting providers, databases, analytics providers, and AI model providers.
        Those services may process data under their own privacy notices and contractual terms.
      </p>

      <h2>Security And Access</h2>
      <p>
        Access is controlled through backend service credentials, user sign-in, role assignment, registry
        authority, and endpoint-specific governance. Sensitive credentials are intended to remain in managed
        secrets or environment configuration and are not exposed in normal responses.
      </p>

      <h2>Retention</h2>
      <p>
        We retain operational records for auditability, troubleshooting, activation continuity, governance,
        and legal or security requirements. Retention periods may vary by workspace, tenant, and connected service.
      </p>

      <h2>Your Choices</h2>
      <p>
        Contact your platform administrator to request access, correction, export, or deletion of personal
        information where applicable. Some operational logs may be retained when required for security,
        compliance, dispute resolution, or platform integrity.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, contact the platform owner at
        <a href="mailto:mad4b.digital@gmail.com">mad4b.digital@gmail.com</a>.
      </p>
    </section>
  </main>
  <footer>
    Growth Intelligence Platform | <a href="/status.html">System status</a>
  </footer>
</body>
</html>`;
}

function sendPrivacyPolicy(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(privacyPolicyHtml(req));
}

function termsOfUseHtml(req) {
  const host = escapeHtml(requestHost(req));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Terms of Use | Growth Intelligence Platform</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#f7f8fb;color:#1f2937;line-height:1.6}
    header{background:#ffffff;border-bottom:1px solid #dde3ea;padding:28px 24px}
    main{max-width:820px;margin:0 auto;padding:32px 24px 56px}
    h1{font-size:30px;line-height:1.2;margin:0 0 8px;color:#111827}
    h2{font-size:18px;margin:30px 0 10px;color:#111827}
    p,li{font-size:15px}
    ul{padding-left:22px}
    .meta{color:#607085;font-size:14px;margin:0}
    .panel{background:#ffffff;border:1px solid #dde3ea;border-radius:8px;padding:24px;margin-top:24px}
    .host{display:inline-block;background:#eef4ff;border:1px solid #c7d7fe;color:#1e3a8a;border-radius:999px;padding:4px 10px;font-size:13px;margin-top:10px}
    footer{border-top:1px solid #dde3ea;color:#607085;font-size:13px;padding:20px 24px;text-align:center}
    a{color:#1d4ed8}
  </style>
</head>
<body>
  <header>
    <main style="padding:0;max-width:820px">
      <h1>Terms of Use</h1>
      <p class="meta">Growth Intelligence Platform | Effective ${EFFECTIVE_DATE}</p>
      <span class="host">Applies to ${host}</span>
    </main>
  </header>
  <main>
    <section class="panel">
      <p>
        By accessing or executing workflows on the Growth Intelligence Platform, you agree
        to these Terms of Use.
      </p>

      <h2>Acceptable Use And Governance</h2>
      <p>
        You agree to operate within assigned actor roles, tenant boundaries, endpoint policies,
        registry constraints, and execution eligibility rules.
      </p>

      <h2>AI And Automated Execution</h2>
      <p>
        The platform uses AI resolvers and automation to generate plans, dispatch actions,
        and execute governed workflows. You are responsible for reviewing, validating, and
        authorizing automated changes where policy or law requires it.
      </p>

      <h2>Connected Systems</h2>
      <p>
        You represent that you have the necessary authorization for all external APIs,
        repositories, hosting environments, analytics properties, documents, and workflow
        systems connected to the platform.
      </p>

      <h2>Data And Privacy</h2>
      <p>
        Data handling is described in the <a href="/privacy-policy">Privacy Policy</a>.
        You must not use the platform to access or process data you are not authorized to use.
      </p>

      <h2>Limitation Of Liability</h2>
      <p>
        The platform is provided to automate complex operational workflows. We do not guarantee
        uninterrupted availability, zero-drift operations, or third-party API availability.
      </p>

      <h2>Contact</h2>
      <p>
        For terms questions, contact the platform owner at
        <a href="mailto:mad4b.digital@gmail.com">mad4b.digital@gmail.com</a>.
      </p>
    </section>
  </main>
  <footer>
    Growth Intelligence Platform | <a href="/privacy-policy">Privacy Policy</a>
  </footer>
</body>
</html>`;
}

function sendTermsOfUse(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(termsOfUseHtml(req));
}

export function buildLegalRoutes(deps) {
  const router = Router();

  router.get("/privacy-policy", sendPrivacyPolicy);
  router.get("/privacy-policy.html", sendPrivacyPolicy);
  router.get("/privacy", sendPrivacyPolicy);
  router.get("/privacy.html", sendPrivacyPolicy);

  router.get("/terms-of-use", sendTermsOfUse);
  router.get("/terms-of-use.html", sendTermsOfUse);
  router.get("/terms", sendTermsOfUse);
  router.get("/terms.html", sendTermsOfUse);

  return router;
}
