/**
 * Pure logic functions — each one mirrors a piece of the Decision Intelligence
 * portfolio's behavior so Claude's tool calls produce deterministic outputs
 * with no LLM-in-the-loop reasoning. The Python / Rust services themselves
 * are the source of truth; this file is the read-only "preview" of what
 * they'd compute given the same inputs.
 */

// ---------------------------------------------------------------------------
// Decision Card validation (mirrors procurement-decision-api's conditional rules)
// ---------------------------------------------------------------------------

export interface DecisionCardInput {
  decision_card_version: string;
  decision_id: string;
  issued_at: string;
  buyer: { name: string; type: string };
  decision: { status: string };
  subject: { vendor_name: string };
  rationale: string;
  conditions?: Array<{ id: string; description: string }>;
  withdrawal?: { at: string; reason: string };
  publication?: { is_public?: boolean; publication_uri?: string };
}

export interface ValidationIssue {
  severity: "error" | "warning";
  field: string | null;
  kind: string;
  message: string;
}

export interface DecisionCardReport {
  valid: boolean;
  issues: ValidationIssue[];
  status: string;
  vendor: string;
  conditions_count: number;
  is_public: boolean;
}

const CONDITION_REQUIRED = new Set([
  "approved-with-conditions",
  "rejected-with-remediation",
]);

export function validateDecisionCard(card: DecisionCardInput): DecisionCardReport {
  const issues: ValidationIssue[] = [];
  const status = card.decision.status;
  const conditions = card.conditions ?? [];

  if (card.decision_card_version !== "0.1") {
    issues.push({
      severity: "error",
      field: "decision_card_version",
      kind: "unsupported_version",
      message: `decision_card_version must be "0.1"; got ${card.decision_card_version}`,
    });
  }

  if (CONDITION_REQUIRED.has(status) && conditions.length === 0) {
    issues.push({
      severity: "error",
      field: "conditions",
      kind: "conditions_required",
      message: `decision.status=${status} requires at least one entry in conditions[]`,
    });
  }

  if (status === "withdrawn" && !card.withdrawal) {
    issues.push({
      severity: "error",
      field: "withdrawal",
      kind: "withdrawal_required",
      message: "decision.status=withdrawn requires a withdrawal block (at + reason)",
    });
  }

  const pub = card.publication;
  if (pub?.is_public === true && !pub.publication_uri) {
    issues.push({
      severity: "error",
      field: "publication.publication_uri",
      kind: "publication_uri_required",
      message: "publication.is_public=true requires publication.publication_uri",
    });
  }

  return {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
    status,
    vendor: card.subject.vendor_name,
    conditions_count: conditions.length,
    is_public: pub?.is_public === true,
  };
}

// ---------------------------------------------------------------------------
// PolicyBundle preview from a Decision Card (mirrors
// policy-as-code-engine.policy_bundle_from_decision_card)
// ---------------------------------------------------------------------------

export interface PolicyBundlePreview {
  bundle_id: string;
  policies: Array<{
    id: string;
    description: string;
    default_effect: "allow" | "deny";
    rules: Array<{
      id: string;
      effect: "allow" | "deny";
      when_kind: string;
    }>;
  }>;
  source: string;
}

const REJECT_STATUSES = new Set([
  "rejected",
  "rejected-with-remediation",
  "withdrawn",
  "expired",
  "pending",
]);

export function previewPolicyBundle(card: DecisionCardInput): PolicyBundlePreview {
  const status = card.decision.status;
  const vendor = card.subject.vendor_name;
  const source = `decision-card:${card.decision_id}`;

  if (REJECT_STATUSES.has(status)) {
    return {
      bundle_id: `decision-card-${card.decision_id}`,
      source,
      policies: [
        {
          id: `${card.decision_id}__${status}`,
          description: `Vendor "${vendor}" is ${status}; all requests denied.`,
          default_effect: "deny",
          rules: [{ id: `${status}-deny`, effect: "deny", when_kind: "always" }],
        },
      ],
    };
  }

  if (status === "approved") {
    return {
      bundle_id: `decision-card-${card.decision_id}`,
      source,
      policies: [
        {
          id: `${card.decision_id}__approved`,
          description: `Vendor "${vendor}" is approved; all requests permitted.`,
          default_effect: "allow",
          rules: [{ id: "approved-allow", effect: "allow", when_kind: "always" }],
        },
      ],
    };
  }

  if (status === "approved-with-conditions") {
    const conditions = card.conditions ?? [];
    if (conditions.length === 0) {
      // Fail safe — same shape as a rejection.
      return previewPolicyBundle({
        ...card,
        decision: { status: "rejected" },
      });
    }
    return {
      bundle_id: `decision-card-${card.decision_id}`,
      source,
      policies: conditions.map((c) => ({
        id: `${card.decision_id}__condition__${c.id}`,
        description: c.description,
        default_effect: "deny" as const,
        rules: [{ id: `${c.id}-satisfied`, effect: "allow" as const, when_kind: "eq" }],
      })),
    };
  }

  // Unknown status -> deny-all.
  return previewPolicyBundle({ ...card, decision: { status: "rejected" } });
}

// ---------------------------------------------------------------------------
// Incident remediation plan (mirrors incident-correlation-rs at small scale)
// ---------------------------------------------------------------------------

export interface IncidentCard {
  incident_id: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low";
  affected_documents: string[];
}

export interface RemediationStep {
  document_id: string;
  action:
    | "page"
    | "recheck_policy"
    | "request_review"
    | "revalidate";
  urgency: "critical" | "high" | "normal" | "low";
  rationale: string;
}

export interface RemediationPlan {
  incident_id: string;
  steps: RemediationStep[];
  summary: string;
}

export function planRemediation(card: IncidentCard): RemediationPlan {
  if (card.affected_documents.length === 0) {
    throw new RangeError("incident.affected_documents must contain at least one document id");
  }
  const baseUrgency = (severity: IncidentCard["severity"]): RemediationStep["urgency"] => {
    switch (severity) {
      case "critical":
        return "critical";
      case "high":
        return "high";
      case "medium":
        return "normal";
      default:
        return "low";
    }
  };

  const steps = card.affected_documents.map((id): RemediationStep => {
    const action: RemediationStep["action"] = id.startsWith("decision:")
      ? "recheck_policy"
      : id.startsWith("vendor:")
        ? "request_review"
        : "revalidate";
    const urgency = card.severity === "critical" ? "critical" : baseUrgency(card.severity);
    return {
      document_id: id,
      action,
      urgency,
      rationale: rationaleFor(action, id, card.summary),
    };
  });

  return {
    incident_id: card.incident_id,
    steps,
    summary: `${steps.length} step(s) recommended; severity=${card.severity}`,
  };
}

function rationaleFor(action: RemediationStep["action"], id: string, summary: string): string {
  switch (action) {
    case "recheck_policy":
      return `Re-evaluate the PolicyBundle generated from ${id}. Incident: ${summary}`;
    case "request_review":
      return `Bring forward a fresh procurement review for ${id}. Incident: ${summary}`;
    case "revalidate":
      return `Re-fetch + re-validate ${id} via aeo-validator-service. Incident: ${summary}`;
    case "page":
      return `Page the on-call. Incident: ${summary}`;
  }
}

// ---------------------------------------------------------------------------
// Data contract compatibility (mirrors data-contract-registry rules at preview scale)
// ---------------------------------------------------------------------------

export interface DataField {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "timestamp" | "json";
  required?: boolean;
  enum?: Array<string | number | boolean>;
}

export interface DataContract {
  dataset_id: string;
  version: string;
  fields: DataField[];
  primary_key?: string[];
}

export interface CompatibilityReport {
  compatible: boolean;
  mode: "backward" | "forward" | "full";
  issues: ValidationIssue[];
}

export function checkContractCompatibility(
  previous: DataContract,
  proposed: DataContract,
  mode: "backward" | "forward" | "full" = "backward",
): CompatibilityReport {
  if (previous.dataset_id !== proposed.dataset_id) {
    throw new RangeError(
      `dataset_id mismatch: previous=${previous.dataset_id} proposed=${proposed.dataset_id}`,
    );
  }

  const issues: ValidationIssue[] = [];
  if (!isSemverGreater(proposed.version, previous.version)) {
    issues.push({
      severity: "error",
      field: null,
      kind: "version_not_increasing",
      message: `new version "${proposed.version}" must be strictly greater than "${previous.version}"`,
    });
  }

  const prevPK = (previous.primary_key ?? []).join(",");
  const newPK = (proposed.primary_key ?? []).join(",");
  if (prevPK !== newPK) {
    issues.push({
      severity: "error",
      field: null,
      kind: "primary_key_changed",
      message: `primary_key changed: [${prevPK}] -> [${newPK}]`,
    });
  }

  const prevFields = new Map(previous.fields.map((f) => [f.name, f]));
  const newFields = new Map(proposed.fields.map((f) => [f.name, f]));

  if (mode === "backward" || mode === "full") {
    for (const [name, prev] of prevFields) {
      const next = newFields.get(name);
      if (!next) {
        issues.push({
          severity: "error",
          field: name,
          kind: "field_removed",
          message: `field "${name}" was removed`,
        });
        continue;
      }
      if (next.type !== prev.type) {
        issues.push({
          severity: "error",
          field: name,
          kind: "field_type_changed",
          message: `field "${name}" type changed: ${prev.type} -> ${next.type}`,
        });
      }
      if (prev.required === false && next.required !== false) {
        issues.push({
          severity: "error",
          field: name,
          kind: "field_required_added",
          message: `field "${name}" was optional, now required`,
        });
      }
      if (prev.enum && next.enum) {
        const shrunk = prev.enum.filter((v) => !next.enum!.includes(v));
        if (shrunk.length > 0) {
          issues.push({
            severity: "error",
            field: name,
            kind: "field_enum_shrunk",
            message: `field "${name}" enum shrunk; removed values ${JSON.stringify(shrunk)}`,
          });
        }
      }
    }
  }

  if (mode === "forward" || mode === "full") {
    for (const [name, next] of newFields) {
      if (!prevFields.has(name) && next.required !== false) {
        issues.push({
          severity: "error",
          field: name,
          kind: "field_required_added",
          message: `required field "${name}" added; old consumers can't populate it`,
        });
      }
    }
  }

  return {
    compatible: issues.every((i) => i.severity !== "error"),
    mode,
    issues,
  };
}

function isSemverGreater(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
