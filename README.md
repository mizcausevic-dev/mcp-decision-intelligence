# mcp-decision-intelligence

[![CI](https://github.com/mizcausevic-dev/mcp-decision-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/mizcausevic-dev/mcp-decision-intelligence/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Experimental local MCP server for selected Decision Intelligence previews.** It checks a subset of AI Procurement Decision Card rules, produces illustrative deny-only policy shapes, suggests direct-document incident triage, and checks a subset of data-contract compatibility rules. It does not call or replace the authoritative Python/Rust services.

The companion to [`mcp-reliability-toolkit`](https://github.com/mizcausevic-dev/mcp-reliability-toolkit) uses the same local stdio registry pattern for a different problem space.

---

## Tools

| Tool | Related source | What it does |
| --- | --- | --- |
| `validate_decision_card` | `procurement-decision-api` | Checks selected v0.1 fields and the three conditional rules. Its result says `full_schema_validated: false`; a `valid` result is limited to this subset. |
| `preview_policy_bundle` | `policy-as-code-engine` | Returns an illustrative, non-enforceable deny policy for rejected, withdrawn, expired, or pending cards that pass its selected v0.1 checks. Cards failing those checks return `invalid_decision_card`; approved and conditionally approved cards return `trusted_attestation_required` because this server cannot verify the buyer attestation and scope required by the live service. |
| `plan_incident_remediation` | `incident-correlation-rs` | Suggests one action per distinct, directly named document ID. It does not verify nodes or traverse the Rust service's graph. |
| `check_contract_compatibility` | `data-contract-registry` | Checks a structural subset in backward / forward / full mode. Input requires contract owners; the registry remains authoritative for validation and promotion. |

Each tool advertises a JSON Schema. The server validates arguments and returns machine-readable MCP errors. These local previews do not grant access, sign decisions, register bundles, page operators, or change any service state.

Inputs are capped at 128 KiB per call, with smaller field and list limits. The incident tool accepts at most 64 document IDs, coalesces duplicates in first-seen order, and does not repeat the incident summary in each step.

---

## Trust boundary

The local functions are deterministic, but they cover only selected rules. In particular, the current policy service requires a trusted buyer attestation, `buyer.id`, `subject.vendor_id`, `decision.effective_until`, and a restricted action scope before constructing an approving policy. This MCP server has none of that evidence, so it refuses to return an allow-shaped preview. A deny-shaped preview is illustrative, not an authorization result.

The incident tool does not walk a graph; the contract tool does not validate a full registry document; the Decision Card tool does not validate the full upstream schema. Verify real decisions with the owning service. Use fictional or permissioned redacted examples in a Claude conversation; do not paste private procurement, incident, or contract data into an unapproved client.

If you also have the unified [`mcp-kinetic-gain`](https://github.com/mizcausevic-dev/mcp-kinetic-gain) server, use its `decision_card_validate` for Suite schema validation and its `decision_card_to_policy_bundle` or `incident_remediation_plan` for Suite card inputs. This experimental server accepts different input shapes and is not a drop-in replacement. Its contract tool reports `validation_scope: selected_structural_rules` and `full_registry_validated: false`; even `compatible: true` covers only those selected rules. Use the owning services for authorization, contract promotion, and operational incident response.

---

## Run from source

```bash
git clone https://github.com/mizcausevic-dev/mcp-decision-intelligence.git
cd mcp-decision-intelligence
npm ci
npm run build
```

```jsonc
// Claude Desktop configuration; replace the path with the built file's absolute path.
{
  "mcpServers": {
    "decision-intelligence": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-decision-intelligence/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The public npm registry returned E404 for this package on 2026-10-12; the GitHub `v0.1.0` release and this source checkout are separate artifacts. No npm publication is implied here.

---

## Example interaction

> *"Here is a fictional rejected Decision Card. Show the local deny-only policy illustration and explain its limits."*

Claude calls `preview_policy_bundle(card)` and receives a `preview_only: true`, `enforceable: false` deny-shaped result. For `approved` or `approved-with-conditions`, the tool returns `trusted_attestation_required` instead of an allow policy.

The authoritative policy service must verify the signed card and runtime scope before any approval can be inferred.

---

## Tests

```bash
npm install
npm run typecheck
npm run build
npm test
```

CI matrix runs Node 20 and 22.

---

## Layout

```
src/
  index.ts        # MCP stdio server entry point
  tools.ts        # tool registry: zod schemas, JSON-Schema export, handlers
  logic.ts        # pure selected-rule previews; no authoritative service call
tests/
  logic.test.ts
  tools.test.ts
```

Adding a new tool is one push to the `tools` array in `tools.ts` — zod schema in, handler out, done.

---

## Related

- **[mcp-reliability-toolkit](https://github.com/mizcausevic-dev/mcp-reliability-toolkit)** — sibling MCP server for the Platform Reliability Stack (SLO burn, rate limiter sizing, breaker design, layered-stack composition).
- **[procurement-decision-api](https://github.com/mizcausevic-dev/procurement-decision-api)** · **[policy-as-code-engine](https://github.com/mizcausevic-dev/policy-as-code-engine)** · **[incident-correlation-rs](https://github.com/mizcausevic-dev/incident-correlation-rs)** · **[data-contract-registry](https://github.com/mizcausevic-dev/data-contract-registry)** — the owning implementations for authoritative checks.

---

## License

MIT. See [LICENSE](LICENSE).
