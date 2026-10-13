/**
 * MCP tool definitions.
 *
 * Same registry pattern as `mcp-reliability-toolkit`: each tool has a name,
 * a human-facing description, a JSON Schema input, and a pure handler that
 * calls into `logic.ts`. Handlers throw on bad input; the entry point catches
 * and turns the throw into an MCP `isError` response.
 */

import { z } from "zod";

import {
  checkContractCompatibility,
  planRemediation,
  previewPolicyBundle,
  validateDecisionCard,
} from "./logic.js";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => unknown;
}

export const tools: ToolHandler[] = [];

// ---------------------------------------------------------------------------
// Zod schemas (validated, used to drive the JSON Schema)
// ---------------------------------------------------------------------------

const DecisionCardSchema = z.object({
  decision_card_version: z.string(),
  decision_id: z.string().min(1).max(128),
  issued_at: z.string().min(1).max(64),
  buyer: z.object({
    name: z.string().min(1).max(256),
    type: z.string().min(1).max(64),
  }).passthrough(),
  decision: z.object({
    status: z.string().min(1).max(64),
  }).passthrough(),
  subject: z.object({
    vendor_name: z.string().min(1).max(256),
  }).passthrough(),
  rationale: z.string().min(1).max(4096),
  conditions: z
    .array(z.object({ id: z.string().min(1).max(128), description: z.string().min(1).max(1024) }).passthrough())
    .max(32)
    .optional(),
  withdrawal: z
    .object({
      at: z.string().min(1).max(64),
      reason: z.string().min(1).max(1024),
    }).passthrough()
    .optional(),
  publication: z
    .object({
      is_public: z.boolean().optional(),
      publication_uri: z.string().max(2048).optional(),
    }).passthrough()
    .optional(),
}).passthrough();

const IncidentSchema = z.object({
  incident_id: z.string().min(1).max(128),
  summary: z.string().min(1).max(512),
  severity: z.enum(["critical", "high", "medium", "low"]),
  affected_documents: z.array(z.string().min(1).max(128)).min(1).max(64),
});

const DataFieldSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(["string", "integer", "number", "boolean", "timestamp", "json"]),
  required: z.boolean().optional(),
  enum: z.array(z.union([z.string().max(256), z.number(), z.boolean()])).max(100).optional(),
}).passthrough();

const OwnerSchema = z.object({
  team: z.string().min(1).max(256),
  contact: z.string().max(256).optional(),
}).passthrough();

const DataContractSchema = z.object({
  dataset_id: z.string().min(1).max(128),
  version: z.string().max(64).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  fields: z.array(DataFieldSchema).min(1).max(200),
  owners: z.array(OwnerSchema).min(1).max(20),
  primary_key: z.array(z.string().min(1).max(128)).max(20).optional(),
}).passthrough();

const CompatibilitySchema = z.object({
  previous: DataContractSchema,
  proposed: DataContractSchema,
  mode: z.enum(["backward", "forward", "full"]).optional(),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTools(): void {
  tools.length = 0;

  tools.push({
    name: "validate_decision_card",
    description:
      "Check selected v0.1 Decision Card fields and three conditional rules offline. " +
      "The result marks its limited scope; it does not validate the full schema or " +
      "replace procurement-decision-api's authoritative validation. If the unified " +
      "mcp-kinetic-gain server is available, use its decision_card_validate for Suite schema checks.",
    inputSchema: zodToJsonSchema(DecisionCardSchema),
    handler: (args) => validateDecisionCard(DecisionCardSchema.parse(args)),
  });

  tools.push({
    name: "preview_policy_bundle",
    description:
      "Show an illustrative, non-enforceable deny policy for rejected, withdrawn, expired, " +
      "or pending Decision Cards. Approvals fail closed: only the live policy service can " +
      "verify buyer attestation and resource/action scope. For Suite card inputs, prefer the " +
      "unified mcp-kinetic-gain decision_card_to_policy_bundle tool.",
    inputSchema: zodToJsonSchema(DecisionCardSchema),
    handler: (args) => previewPolicyBundle(DecisionCardSchema.parse(args)),
  });

  tools.push({
    name: "plan_incident_remediation",
    description:
      "Offline triage for distinct, directly named affected documents only. Returns suggested " +
      "action and urgency; does not validate graph nodes or perform the Rust " +
      "service's graph correlation, paging, or audit delivery. For Suite Incident Card " +
      "inputs, prefer mcp-kinetic-gain incident_remediation_plan.",
    inputSchema: zodToJsonSchema(IncidentSchema),
    handler: (args) => planRemediation(IncidentSchema.parse(args)),
  });

  tools.push({
    name: "check_contract_compatibility",
    description:
      "Run an offline structural subset of the data-contract-registry compatibility " +
      "checks in backward, forward, or full mode. A compatible result covers only " +
      "selected rules, not full registry validation or promotion; the live service remains authoritative.",
    inputSchema: zodToJsonSchema(CompatibilitySchema),
    handler: (args) => {
      const parsed = CompatibilitySchema.parse(args);
      return checkContractCompatibility(parsed.previous, parsed.proposed, parsed.mode);
    },
  });
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema (minimal, sufficient for MCP). Same approach as
// `mcp-reliability-toolkit` so the two servers stay structurally identical.
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const shape = schema.shape;
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    if (!field) continue;
    properties[key] = zodTypeToJsonSchema(field);
    if (!field.isOptional()) {
      required.push(key);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: schema._def.unknownKeys === "passthrough",
  };
}

function zodTypeToJsonSchema(type: z.ZodTypeAny): Record<string, unknown> {
  if (type instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(type.unwrap() as z.ZodTypeAny);
  }
  const description = type._def.description;
  if (type instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: "string", ...(description ? { description } : {}) };
    for (const check of type._def.checks) {
      if (check.kind === "min") result.minLength = check.value;
      if (check.kind === "max") result.maxLength = check.value;
      if (check.kind === "regex") result.pattern = check.regex.source;
    }
    return result;
  }
  if (type instanceof z.ZodNumber) {
    return { type: "number", ...(description ? { description } : {}) };
  }
  if (type instanceof z.ZodBoolean) {
    return { type: "boolean", ...(description ? { description } : {}) };
  }
  if (type instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: (type as z.ZodEnum<[string, ...string[]]>).options,
      ...(description ? { description } : {}),
    };
  }
  if (type instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodTypeToJsonSchema(type.element as z.ZodTypeAny),
      ...(type._def.minLength ? { minItems: type._def.minLength.value } : {}),
      ...(type._def.maxLength ? { maxItems: type._def.maxLength.value } : {}),
      ...(description ? { description } : {}),
    };
  }
  if (type instanceof z.ZodUnion) {
    return {
      oneOf: (type as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options.map(zodTypeToJsonSchema),
    };
  }
  if (type instanceof z.ZodObject) {
    return zodToJsonSchema(type as z.ZodObject<z.ZodRawShape>);
  }
  return { ...(description ? { description } : {}) };
}
