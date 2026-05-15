import { describe, expect, it } from "vitest";

import {
  checkContractCompatibility,
  planRemediation,
  previewPolicyBundle,
  validateDecisionCard,
} from "../src/logic.js";

const baseCard = {
  decision_card_version: "0.1",
  decision_id: "DEC-001",
  issued_at: "2026-05-15T00:00:00Z",
  buyer: { name: "Springfield USD", type: "school-district" },
  decision: { status: "approved" },
  subject: { vendor_name: "AcmeTutor" },
  rationale: "Looks fine.",
};

describe("validateDecisionCard", () => {
  it("accepts an approved card", () => {
    const r = validateDecisionCard(baseCard);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.status).toBe("approved");
  });

  it("rejects approved-with-conditions when conditions[] is empty", () => {
    const r = validateDecisionCard({
      ...baseCard,
      decision: { status: "approved-with-conditions" },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === "conditions_required")).toBe(true);
  });

  it("rejects withdrawn without withdrawal block", () => {
    const r = validateDecisionCard({
      ...baseCard,
      decision: { status: "withdrawn" },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.kind === "withdrawal_required")).toBe(true);
  });

  it("rejects publication.is_public=true without publication_uri", () => {
    const r = validateDecisionCard({
      ...baseCard,
      publication: { is_public: true },
    });
    expect(r.issues.some((i) => i.kind === "publication_uri_required")).toBe(true);
  });

  it("rejects unsupported version", () => {
    const r = validateDecisionCard({ ...baseCard, decision_card_version: "0.9" });
    expect(r.issues.some((i) => i.kind === "unsupported_version")).toBe(true);
  });
});

describe("previewPolicyBundle", () => {
  it("approved -> single allow-all policy", () => {
    const b = previewPolicyBundle(baseCard);
    expect(b.policies).toHaveLength(1);
    expect(b.policies[0]?.default_effect).toBe("allow");
  });

  it("rejected -> single deny-all policy", () => {
    const b = previewPolicyBundle({ ...baseCard, decision: { status: "rejected" } });
    expect(b.policies[0]?.default_effect).toBe("deny");
  });

  it("approved-with-conditions yields one policy per condition", () => {
    const b = previewPolicyBundle({
      ...baseCard,
      decision: { status: "approved-with-conditions" },
      conditions: [
        { id: "dpa-signed", description: "DPA on file" },
        { id: "bias-audit", description: "Bias audit refreshed" },
      ],
    });
    expect(b.policies).toHaveLength(2);
  });

  it("fail-safe deny when status is approved-with-conditions but conditions is empty", () => {
    const b = previewPolicyBundle({
      ...baseCard,
      decision: { status: "approved-with-conditions" },
      conditions: [],
    });
    expect(b.policies[0]?.default_effect).toBe("deny");
  });
});

describe("planRemediation", () => {
  it("rejects an empty affected_documents", () => {
    expect(() =>
      planRemediation({
        incident_id: "INC-1",
        summary: "test",
        severity: "medium",
        affected_documents: [],
      }),
    ).toThrow();
  });

  it("decision: ids -> recheck_policy", () => {
    const plan = planRemediation({
      incident_id: "INC-1",
      summary: "policy gap",
      severity: "high",
      affected_documents: ["decision:DEC-001"],
    });
    expect(plan.steps[0]?.action).toBe("recheck_policy");
    expect(plan.steps[0]?.urgency).toBe("high");
  });

  it("vendor: ids -> request_review", () => {
    const plan = planRemediation({
      incident_id: "INC-2",
      summary: "vendor concern",
      severity: "medium",
      affected_documents: ["vendor:acme"],
    });
    expect(plan.steps[0]?.action).toBe("request_review");
  });

  it("default -> revalidate", () => {
    const plan = planRemediation({
      incident_id: "INC-3",
      summary: "tool drift",
      severity: "low",
      affected_documents: ["tool:lookup"],
    });
    expect(plan.steps[0]?.action).toBe("revalidate");
  });

  it("critical severity bumps urgency to critical", () => {
    const plan = planRemediation({
      incident_id: "INC-4",
      summary: "critical",
      severity: "critical",
      affected_documents: ["tool:lookup", "decision:DEC-001"],
    });
    for (const step of plan.steps) {
      expect(step.urgency).toBe("critical");
    }
  });
});

describe("checkContractCompatibility", () => {
  const prev = {
    dataset_id: "users.daily_active",
    version: "1.0.0",
    primary_key: ["user_id"],
    fields: [
      { name: "user_id", type: "string" as const },
      { name: "ltv", type: "number" as const, required: false },
    ],
  };

  it("identical-minus-minor-bump is compatible", () => {
    const r = checkContractCompatibility(prev, { ...prev, version: "1.1.0" });
    expect(r.compatible).toBe(true);
  });

  it("removing a field breaks backward", () => {
    const r = checkContractCompatibility(prev, {
      ...prev,
      version: "2.0.0",
      fields: prev.fields.filter((f) => f.name !== "ltv"),
    });
    expect(r.compatible).toBe(false);
    expect(r.issues.some((i) => i.kind === "field_removed")).toBe(true);
  });

  it("primary_key change is breaking", () => {
    const r = checkContractCompatibility(prev, {
      ...prev,
      version: "2.0.0",
      primary_key: ["user_id", "active_date"],
    });
    expect(r.issues.some((i) => i.kind === "primary_key_changed")).toBe(true);
  });

  it("non-increasing version is breaking", () => {
    const r = checkContractCompatibility(prev, prev);
    expect(r.issues.some((i) => i.kind === "version_not_increasing")).toBe(true);
  });

  it("adding required field breaks forward", () => {
    const r = checkContractCompatibility(
      prev,
      {
        ...prev,
        version: "2.0.0",
        fields: [...prev.fields, { name: "country", type: "string" as const }],
      },
      "forward",
    );
    expect(r.issues.some((i) => i.kind === "field_required_added")).toBe(true);
  });

  it("dataset_id mismatch throws", () => {
    expect(() =>
      checkContractCompatibility(prev, { ...prev, dataset_id: "other", version: "2.0.0" }),
    ).toThrow();
  });
});
