import { Router } from "express";

export function buildLegalRoutes(deps) {
  const router = Router();

  router.get("/privacy-policy", (req, res) => {
    res.json({
      ok: true,
      title: "Privacy Policy",
      content: `
# Privacy Policy
*Effective Date: ${new Date().toISOString().split('T')[0]}*

Welcome to the Growth Intelligence Platform. Your privacy and data security are governed by our system architecture and data policies.

## 1. Information We Collect
We collect operational execution logs, platform telemetry, brand registry configurations, and the required credentials to interface with connected endpoints. This includes data necessary for managing multi-business and multi-role environments.

## 2. How We Use Information
The collected information is used exclusively to:
- Resolve AI execution paths and generate implementation plans.
- Execute governed task manifests and automate integrations across your connected workflows.
- Detect infrastructure drift and perform automated validation and repair operations.
- Enforce strict HTTP execution governance and registry eligibility.

## 3. Data Storage and Security
System state and configuration data are persisted across designated authoritative surfaces (e.g., MySQL databases and Google Sheets). Execution traces are retained for operational auditability. Sensitive credentials are encrypted and accessed solely for authorized endpoint resolution.

## 4. Third-Party Integrations
The platform extensively integrates with third-party providers including Google Workspace (Drive, Sheets), GitHub, hosting platforms (e.g., Hostinger), and AI model providers. Data processed through these connectors is subject to the boundaries defined by your platform administrators and the respective third-party privacy policies.

## 5. Contact Us
For questions or concerns regarding data governance, please contact your platform administrator or our support team.
      `.trim()
    });
  });

  router.get("/terms-of-use", (req, res) => {
    res.json({
      ok: true,
      title: "Terms of Use",
      content: `
# Terms of Use
*Effective Date: ${new Date().toISOString().split('T')[0]}*

By accessing or executing workflows on the Growth Intelligence Platform, you agree to these Terms of Use.

## 1. Acceptable Use and Governance
You agree to operate within your assigned actor roles and execution boundaries. You must strictly adhere to the HTTP Execution Governance policies, registry constraints, and endpoint execution eligibility rules defined in the system.

## 2. AI and Automated Execution
The platform utilizes AI resolvers to generate implementation plans and execute automated task manifests. You are responsible for reviewing, validating, and authorizing these automated changes where mandated by your organizational execution policies.

## 3. Connected Systems
You represent that you hold the necessary authorization for all external APIs, repositories (e.g., GitHub), and hosting environments (e.g., Hostinger, WordPress) connected to the platform. Bypassing transport governance, schema validations, or registry routing layers is strictly prohibited.

## 4. Intellectual Property
The Growth Intelligence Platform's architecture, AI resolvers, and operational codebase remain our exclusive intellectual property. All business assets, content, and data defined within your Brand Registry remain yours.

## 5. Limitation of Liability
The platform is provided to automate complex operational workflows. We make no guarantees regarding uninterrupted system availability or zero-drift operations. We are not liable for execution failures, third-party API rate limits, or consequences arising from misconfigured governance rules.
      `.trim()
    });
  });

  return router;
}
