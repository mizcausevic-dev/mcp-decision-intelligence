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

  it("every tool has an object schema and explicit extra-property behavior", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.inputSchema.additionalProperties).toBe("boolean");
      expect(t.description.length).toBeGreaterThan(30);
    }
    expect(tools.find((t) => t.name === "validate_decision_card")?.inputSchema.additionalProperties).toBe(true);
    const compatibility = tools.find((t) => t.name === "check_contract_compatibility")!;
    const contract = ((compatibility.inputSchema.properties as Record<string, unknown>).proposed as {
      properties: Record<string, unknown>;
    }).properties;
    expect(contract.version).toMatchObject({ type: "string", maxLength: 64, pattern: expect.any(String) });
    expect(contract.owners).toMatchObject({ type: "array", minItems: 1 });
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

  it("preview_policy_bundle blocks unverified approval", () => {
    const tool = tools.find((t) => t.name === "preview_policy_bundle")!;
    expect(() => tool.handler(card)).toThrow("trusted buyer attestation");
  });

  it("preview_policy_bundle returns non-enforceable deny for rejected cards", () => {
    const tool = tools.find((t) => t.name === "preview_policy_bundle")!;
    const r = tool.handler({ ...card, decision: { status: "rejected" } }) as {
      preview_only: boolean; enforceable: boolean; policies: Array<{ default_effect: string }>;
    };
    expect(r.preview_only).toBe(true);
    expect(r.enforceable).toBe(false);
    expect(r.policies[0]?.default_effect).toBe("deny");
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
      owners: [{ team: "data-platform" }],
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

  it("requires owners and strict semver for contract checks", () => {
    const tool = tools.find((t) => t.name === "check_contract_compatibility")!;
    const contract = { dataset_id: "x", version: "1.0.0", fields: [{ name: "id", type: "string" }] };
    expect(() => tool.handler({ previous: contract, proposed: { ...contract, version: "2.0.0" } })).toThrow();
    expect(() => tool.handler({ previous: { ...contract, owners: [{ team: "team" }] }, proposed: { ...contract, owners: [{ team: "team" }], version: "2.0.0x" } })).toThrow();
  });
});
