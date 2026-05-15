import { beforeAll, describe, expect, it } from "vitest";

import { registerTools, tools } from "../src/tools.js";

beforeAll(() => {
  registerTools();
});

describe("MCP tool registry", () => {
  it("registers the four expected tools", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_contract_compatibility",
      "plan_incident_remediation",
      "preview_policy_bundle",
      "validate_decision_card",
    ]);
  });

  it("every tool has an object schema with no extra properties", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(30);
    }
  });

  const card = {
    decision_card_version: "0.1",
    decision_id: "DEC-001",
    issued_at: "2026-05-15T00:00:00Z",
    buyer: { name: "Springfield USD", type: "school-district" },
    decision: { status: "approved" },
    subject: { vendor_name: "AcmeTutor" },
    rationale: "Looks fine.",
  };

  it("validate_decision_card runs", () => {
    const tool = tools.find((t) => t.name === "validate_decision_card")!;
    const r = tool.handler(card) as { valid: boolean };
    expect(r.valid).toBe(true);
  });

  it("preview_policy_bundle runs", () => {
    const tool = tools.find((t) => t.name === "preview_policy_bundle")!;
    const r = tool.handler(card) as { policies: unknown[] };
    expect(r.policies).toHaveLength(1);
  });

  it("plan_incident_remediation runs", () => {
    const tool = tools.find((t) => t.name === "plan_incident_remediation")!;
    const r = tool.handler({
      incident_id: "INC-1",
      summary: "test",
      severity: "medium",
      affected_documents: ["decision:DEC-001"],
    }) as { steps: unknown[] };
    expect(r.steps).toHaveLength(1);
  });

  it("check_contract_compatibility runs", () => {
    const tool = tools.find((t) => t.name === "check_contract_compatibility")!;
    const contract = {
      dataset_id: "x",
      version: "1.0.0",
      fields: [{ name: "id", type: "string" }],
    };
    const r = tool.handler({
      previous: contract,
      proposed: { ...contract, version: "1.1.0" },
    }) as { compatible: boolean };
    expect(r.compatible).toBe(true);
  });

  it("rejects malformed input", () => {
    const tool = tools.find((t) => t.name === "validate_decision_card")!;
    expect(() => tool.handler({ decision_card_version: "0.1" })).toThrow();
  });
});
