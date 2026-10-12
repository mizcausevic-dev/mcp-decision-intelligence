/**
 * Pure, offline previews of selected Decision Intelligence rules. The Python
 * and Rust services remain the source of truth. These functions neither
 * authenticate decisions nor authorize runtime actions.
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
  validation_scope: "selected_v0.1_fields_and_conditional_rules";
  full_schema_validated: false;
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

const DECISION_STATUSES = new Set([
  "approved", "approved-with-conditions", "rejected", "rejected-with-remediation",
  "pending", "withdrawn", "expired",
]);
const BUYER_TYPES = new Set([
  "organization", "agency", "school-district", "school", "hospital",
  "health-system", "research-institution", "auditor", "individual",
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

  if (!DECISION_STATUSES.has(status)) {
    issues.push({
      severity: "error", field: "decision.status", kind: "unsupported_status",
      message: `decision.status is not a v0.1 status: ${status}`,
    });
  }
  if (!BUYER_TYPES.has(card.buyer.type)) {
    issues.push({
      severity: "error", field: "buyer.type", kind: "unsupported_buyer_type",
      message: `buyer.type is not a v0.1 buyer type: ${card.buyer.type}`,
    });
  }
  if (card.decision_id.length > 128) {
    issues.push({
      severity: "error", field: "decision_id", kind: "decision_id_too_long",
      message: "decision_id must be at most 128 characters",
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
    validation_scope: "selected_v0.1_fields_and_conditional_rules",
    full_schema_validated: false,
    issues,
    status,
    vendor: card.subject.vendor_name,
    conditions_count: conditions.length,
    is_public: pub?.is_public === true,
  };
}

// ---------------------------------------------------------------------------
// Illustrative deny-only PolicyBundle preview from a Decision Card.
// ---------------------------------------------------------------------------

export interface PolicyBundlePreview {
  preview_only: true;
  enforceable: false;
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

export class PreviewUnavailableError extends Error {
  readonly code = "trusted_attestation_required";
}

export function previewPolicyBundle(card: DecisionCardInput): PolicyBundlePreview {
  const status = card.decision.status;
  const vendor = card.subject.vendor_name;
  const source = `decision-card:${card.decision_id}`;

  // The live service requires a trusted buyer attestation, a bound vendor,
  // expiry and action scope before constructing an approving policy. This
  // offline process has no way to verify those prerequisites.
  if (status === "approved" || status === "approved-with-conditions") {
    throw new PreviewUnavailableError(
      "Approving policy previews require the live service's trusted buyer attestation and scope checks",
    );
  }

  if (REJECT_STATUSES.has(status)) {
    return {
      preview_only: true,
      enforceable: false,
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

  // Unknown status -> deny-all.
  return previewPolicyBundle({ ...card, decision: { status: "rejected" } });
}

// ---------------------------------------------------------------------------
// Incident remediation triage for directly named documents only.
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
  triage_scope: "direct_document_ids_only";
  graph_correlation_performed: false;
  steps: RemediationStep[];
  summary: string;
}

export function planRemediation(card: IncidentCard): RemediationPlan {
  if (card.affected_documents.length === 0) {
    throw new RangeError("incident.affected_documents must contain at least one document id");
  }
  if (
    card.affected_documents.length > 64 ||
    card.summary.length > 512 ||
    card.incident_id.length > 128 ||
    card.affected_documents.some((id) => id.length > 128)
  ) {
    throw new RangeError("incident exceeds the local triage input limits");
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
      rationale: rationaleFor(action, id),
    };
  });

  return {
    incident_id: card.incident_id,
    triage_scope: "direct_document_ids_only",
    graph_correlation_performed: false,
    steps,
    summary: `${steps.length} step(s) recommended; severity=${card.severity}`,
  };
}

function rationaleFor(action: RemediationStep["action"], id: string): string {
  switch (action) {
    case "recheck_policy":
      return `Review the policy associated with ${id}.`;
    case "request_review":
      return `Request a fresh procurement review for ${id}.`;
    case "revalidate":
      return `Re-fetch and re-validate ${id} with its owning service.`;
    case "page":
      return "Recommend paging the on-call owner.";
  }
}

// ---------------------------------------------------------------------------
// Data contract structural compatibility subset.
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
  owners?: Array<{ team: string; contact?: string }>;
  primary_key?: string[];
}

export interface CompatibilityReport {
  compatible: boolean;
  validation_scope: "selected_structural_rules";
  full_registry_validated: false;
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
  for (const [label, contract] of [["previous", previous], ["proposed", proposed]] as const) {
    const seen = new Set<string>();
    for (const field of contract.fields) {
      if (seen.has(field.name)) {
        issues.push({
          severity: "error", field: field.name, kind: "duplicate_field_name",
          message: `${label} contract declares field "${field.name}" more than once`,
        });
      }
      seen.add(field.name);
    }
  }
  if (!proposed.owners?.length) {
    issues.push({
      severity: "error", field: null, kind: "owner_missing",
      message: "proposed contract must declare at least one owner",
    });
  }
  if (!isSemverGreater(proposed.version, previous.version)) {
    issues.push({
      severity: "error",
      field: null,
      kind: "version_not_increasing",
      message: `new version "${proposed.version}" must be strictly greater than "${previous.version}"`,
    });
  }

  const prevPK = previous.primary_key ?? [];
  const newPK = proposed.primary_key ?? [];
  if (prevPK.length !== newPK.length || prevPK.some((key, index) => key !== newPK[index])) {
    issues.push({
      severity: "error",
      field: null,
      kind: "primary_key_changed",
      message: `primary_key changed: ${JSON.stringify(prevPK)} -> ${JSON.stringify(newPK)}`,
    });
  }

  const prevFields = new Map(previous.fields.map((f) => [f.name, f]));
  const newFields = new Map(proposed.fields.map((f) => [f.name, f]));

  // Both modes reject a newly required field and a changed field type.
  // The owning registry treats omitted `required` as true.
  for (const [name, next] of newFields) {
    const prev = prevFields.get(name);
    if (!prev && next.required !== false) {
      issues.push({
        severity: "error", field: name, kind: "field_required_added",
        message: `required field "${name}" added; old rows or consumers may lack it`,
      });
    } else if (prev && next.type !== prev.type) {
      issues.push({
        severity: "error", field: name, kind: "field_type_changed",
        message: `field "${name}" type changed: ${prev.type} -> ${next.type}`,
      });
    }
  }

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
      if (prev.required === false && next.required !== false) {
        issues.push({
          severity: "error",
          field: name,
          kind: "field_required_added",
          message: `field "${name}" was optional, now required`,
        });
      }
      if (next.enum && (!prev.enum || prev.enum.some((value) => !next.enum!.includes(value)))) {
        issues.push({
          severity: "error", field: name, kind: "field_enum_shrunk",
          message: prev.enum
            ? `field "${name}" enum removed previously allowed values`
            : `field "${name}" now restricts values to an enum`,
        });
      }
    }
  }

  if (mode === "forward" || mode === "full") {
    for (const [name, prev] of prevFields) {
      const next = newFields.get(name);
      if (!next) {
        if (prev.required !== false) {
          issues.push({
            severity: "error", field: name, kind: "field_required_removed",
            message: `required field "${name}" was removed; old readers may require it`,
          });
        }
        continue;
      }
      if (prev.required !== false && next.required === false) {
        issues.push({
          severity: "error", field: name, kind: "field_required_removed",
          message: `field "${name}" is now optional; new rows may omit it`,
        });
      }
      if (prev.enum && (!next.enum || next.enum.some((value) => !prev.enum!.includes(value)))) {
        issues.push({
          severity: "error", field: name, kind: "field_enum_expanded",
          message: `field "${name}" may now contain values rejected by the old enum`,
        });
      }
    }
  }

  return {
    compatible: issues.every((i) => i.severity !== "error"),
    validation_scope: "selected_structural_rules",
    full_registry_validated: false,
    mode,
    issues,
  };
}

function isSemverGreater(a: string, b: string): boolean {
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!semver.test(a) || !semver.test(b)) return false;
  const pa = a.split(".").map((n) => BigInt(n));
  const pb = b.split(".").map((n) => BigInt(n));
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0n;
    const bv = pb[i] ?? 0n;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
