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
  decision_id: z.string().min(1),
  issued_at: z.string().min(1),
  buyer: z.object({
    name: z.string().min(1),
    type: z.string().min(1),
  }),
  decision: z.object({
    status: z.string().min(1),
  }),
  subject: z.object({
    vendor_name: z.string().min(1),
  }),
  rationale: z.string().min(1),
  conditions: z
    .array(z.object({ id: z.string().min(1), description: z.string().min(1) }))
    .optional(),
  withdrawal: z
    .object({
      at: z.string().min(1),
      reason: z.string().min(1),
    })
    .optional(),
  publication: z
    .object({
      is_public: z.boolean().optional(),
      publication_uri: z.string().optional(),
    })
    .optional(),
});

const IncidentSchema = z.object({
  incident_id: z.string().min(1),
  summary: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  affected_documents: z.array(z.string().min(1)).min(1),
});

const DataFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "integer", "number", "boolean", "timestamp", "json"]),
  required: z.boolean().optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const DataContractSchema = z.object({
  dataset_id: z.string().min(1),
  version: z.string().min(1),
  fields: z.array(DataFieldSchema).min(1),
  primary_key: z.array(z.string().min(1)).optional(),
});

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
      "Validate an AI Procurement Decision Card against the v0.1 schema + conditional rules. " +
      "Returns the same structured issue list `procurement-decision-api`'s /decisions/validate " +
      "would return, without calling the service.",
    inputSchema: zodToJsonSchema(DecisionCardSchema),
    handler: (args) => validateDecisionCard(DecisionCardSchema.parse(args)),
  });

  tools.push({
    name: "preview_policy_bundle",
    description:
      "Preview the PolicyBundle that `policy-as-code-engine`'s POST /bundles/from-decision-card " +
      "would generate from this Decision Card. Useful for showing operators what runtime gate " +
      "will apply *before* the card is signed.",
    inputSchema: zodToJsonSchema(DecisionCardSchema),
    handler: (args) => previewPolicyBundle(DecisionCardSchema.parse(args)),
  });

  tools.push({
    name: "plan_incident_remediation",
    description:
      "Given an AI Incident Card with one or more affected documents, return the action + " +
      "urgency for each document. Mirrors `incident-correlation-rs.correlate()` at single-hop " +
      "scale — for full graph walks call the Rust service.",
    inputSchema: zodToJsonSchema(IncidentSchema),
    handler: (args) => planRemediation(IncidentSchema.parse(args)),
  });

  tools.push({
    name: "check_contract_compatibility",
    description:
      "Run the same compatibility checks `data-contract-registry`'s POST /contracts/check would " +
      "run. Supports backward / forward / full modes. Returns a structured issue list with " +
      "field_removed / field_type_changed / field_required_added / field_enum_shrunk / " +
      "primary_key_changed / version_not_increasing kinds.",
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
    additionalProperties: false,
  };
}

function zodTypeToJsonSchema(type: z.ZodTypeAny): Record<string, unknown> {
  if (type instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(type.unwrap() as z.ZodTypeAny);
  }
  const description = type._def.description;
  if (type instanceof z.ZodString) {
    return { type: "string", ...(description ? { description } : {}) };
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
