import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

const baseCard = {
  decision_card_version: "0.1",
  decision_id: "DEC-001",
  issued_at: "2026-05-15T00:00:00Z",
  buyer: { name: "Fictional Buyer", type: "organization" },
  decision: { status: "approved" },
  subject: { vendor_name: "Fictional Vendor" },
  rationale: "Synthetic fixture only.",
};

it("initializes over stdio and fails closed for both approval statuses", async () => {
  const client = new Client({ name: "decision-intelligence-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(process.cwd(), "dist/index.js")],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "check_contract_compatibility",
      "plan_incident_remediation",
      "preview_policy_bundle",
      "validate_decision_card",
    ]);

    for (const status of ["approved", "approved-with-conditions"]) {
      const response = await client.callTool({
        name: "preview_policy_bundle",
        arguments: {
          ...baseCard,
          decision: { status },
          ...(status === "approved-with-conditions"
            ? { conditions: [{ id: "synthetic", description: "Synthetic condition" }] }
            : {}),
        },
      });
      expect(response.isError).toBe(true);
      const content = response.content.find((item) => item.type === "text");
      expect(content?.type).toBe("text");
      if (content?.type !== "text") throw new Error("Expected text error result");
      expect(JSON.parse(content.text)).toMatchObject({ code: "trusted_attestation_required" });
      expect(content.text).not.toContain("approved-allow");
    }

    const deny = await client.callTool({
      name: "preview_policy_bundle",
      arguments: { ...baseCard, decision: { status: "rejected" } },
    });
    expect(deny.isError).not.toBe(true);
    const content = deny.content.find((item) => item.type === "text");
    if (content?.type !== "text") throw new Error("Expected text preview result");
    expect(JSON.parse(content.text)).toMatchObject({
      preview_only: true,
      enforceable: false,
      policies: [{ default_effect: "deny" }],
    });

    const unsupported = await client.callTool({
      name: "preview_policy_bundle",
      arguments: { ...baseCard, decision: { status: "impossible-approved" } },
    });
    expect(unsupported.isError).toBe(true);
    const unsupportedContent = unsupported.content.find((item) => item.type === "text");
    if (unsupportedContent?.type !== "text") throw new Error("Expected text status error");
    expect(JSON.parse(unsupportedContent.text)).toMatchObject({ code: "unsupported_status" });
    expect(unsupportedContent.text).not.toContain("rejected");

    const invalid = await client.callTool({
      name: "preview_policy_bundle",
      arguments: {
        ...baseCard,
        decision_card_version: "0.2-private-value",
        decision: { status: "rejected" },
      },
    });
    expect(invalid.isError).toBe(true);
    const invalidCardContent = invalid.content.find((item) => item.type === "text");
    if (invalidCardContent?.type !== "text") throw new Error("Expected text validation error");
    expect(JSON.parse(invalidCardContent.text)).toMatchObject({ code: "invalid_decision_card" });
    expect(invalidCardContent.text).not.toContain("0.2-private-value");

    const repeated = await client.callTool({
      name: "plan_incident_remediation",
      arguments: {
        incident_id: "INC-duplicate",
        summary: "Synthetic input only",
        severity: "low",
        affected_documents: ["decision:DEC-001", "decision:DEC-001"],
      },
    });
    const repeatedContent = repeated.content.find((item) => item.type === "text");
    if (repeatedContent?.type !== "text") throw new Error("Expected text remediation result");
    expect(JSON.parse(repeatedContent.text)).toMatchObject({
      steps: [{ document_id: "decision:DEC-001" }],
      summary: "1 step(s) recommended; severity=low",
    });

    const tooManyDocuments = await client.callTool({
      name: "plan_incident_remediation",
      arguments: {
        incident_id: "INC-oversize",
        summary: "Synthetic input only",
        severity: "low",
        affected_documents: Array.from({ length: 65 }, (_, index) => `tool:${index}`),
      },
    });
    expect(tooManyDocuments.isError).toBe(true);
    const invalidContent = tooManyDocuments.content.find((item) => item.type === "text");
    if (invalidContent?.type !== "text") throw new Error("Expected text validation error");
    expect(JSON.parse(invalidContent.text)).toMatchObject({ code: "invalid_arguments" });

    const oversized = await client.callTool({
      name: "validate_decision_card",
      arguments: { ...baseCard, padding: "x".repeat(130 * 1024) },
    });
    expect(oversized.isError).toBe(true);
    const oversizedContent = oversized.content.find((item) => item.type === "text");
    if (oversizedContent?.type !== "text") throw new Error("Expected text size error");
    expect(JSON.parse(oversizedContent.text)).toMatchObject({ code: "input_too_large" });
  } finally {
    await client.close();
  }
}, 20_000);
