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

Welcome to Growth Intelligence Platform. Your privacy is critically important to us.

## 1. Information We Collect
We collect information you provide directly to us when you use our platform, including account details, connected system configurations, and operational logs generated during workflow execution.

## 2. How We Use Information
We use the information we collect to:
- Provide, maintain, and improve our services
- Execute governed workflows and API actions on your behalf
- Monitor system health, detect anomalies, and prevent unauthorized access

## 3. Data Storage and Security
We implement robust, industry-standard security measures, including credential encryption and strict governance policies, to protect your data from unauthorized access or disclosure.

## 4. Third-Party Services
Our platform integrates with various third-party services (e.g., Google Workspace, GitHub, OpenAI). Data shared with these services is strictly governed by the boundaries and permissions you define.

## 5. Contact Us
If you have any questions about this Privacy Policy, please contact our support team.
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

By accessing or using the Growth Intelligence Platform, you agree to be bound by these Terms of Use.

## 1. Acceptable Use
You agree to use the platform solely for lawful purposes and in accordance with your organization's internal governance policies.

## 2. User Responsibilities
You are responsible for maintaining the confidentiality of your credentials and for all activities that occur under your account. You must ensure that any connected APIs or external systems comply with their respective terms of service.

## 3. Intellectual Property
All rights, title, and interest in and to the platform (excluding user-provided data) remain the exclusive property of Growth Intelligence Platform and its licensors.

## 4. Limitation of Liability
In no event shall we be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the platform.

## 5. Modifications
We reserve the right to modify these Terms at any time. Continued use of the platform constitutes your acceptance of the revised Terms.
      `.trim()
    });
  });

  return router;
}
