# mcp-decision-intelligence

[![CI](https://github.com/mizcausevic-dev/mcp-decision-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/mizcausevic-dev/mcp-decision-intelligence/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**MCP server that exposes the Kinetic Gain Decision Intelligence portfolio as Claude-callable tools.** Validate AI Procurement Decision Cards, preview the PolicyBundle they'd produce, plan incident remediation, check data-contract compatibility — all from inside a Claude conversation, all deterministic.

The companion to [`mcp-reliability-toolkit`](https://github.com/mizcausevic-dev/mcp-reliability-toolkit): same registry pattern, different problem space. Together they give Claude read-only "preview" access to the two main pillars of the portfolio.

---

## Tools

| Tool | Mirrors | What it does |
| --- | --- | --- |
| `validate_decision_card` | `procurement-decision-api` POST /decisions/validate | Validates a v0.1 Decision Card against the conditional-rule set (approved-with-conditions ⇒ conditions[], withdrawn ⇒ withdrawal, is_public=true ⇒ publication_uri, etc.) and returns the structured issue list. |
| `preview_policy_bundle` | `policy-as-code-engine` POST /bundles/from-decision-card | Shows the PolicyBundle that would be generated from this Decision Card before the card is signed. Useful for "what runtime gate will this card produce?" |
| `plan_incident_remediation` | `incident-correlation-rs` correlate() | Maps each affected document in an AI Incident Card to an Action + Urgency. `decision:*` → recheck_policy, `vendor:*` → request_review, anything else → revalidate. |
| `check_contract_compatibility` | `data-contract-registry` POST /contracts/check | Runs backward / forward / full compatibility checks on two contract versions; returns the same structured issue list the registry returns (field_removed, field_type_changed, field_required_added, field_enum_shrunk, primary_key_changed, version_not_increasing). |

Each tool advertises a JSON Schema; bad input is rejected with a typed error.

---

## Why a preview, not a proxy

The math + rule logic in each of those tools is **deterministic**. The Python / Rust services themselves are still the source of truth for actually mutating state (registering bundles, drafting cards, planning live remediation). But "what would happen if we did X?" is exactly the question a design-time Claude conversation wants to answer — and it doesn't need a live HTTP round trip to do that.

So this server is a read-only preview layer. Every number Claude shows you was computed by the same logic the services use. There's no LLM-in-the-loop reasoning, no service dependency, no auth surface.

---

## Install

```bash
npm install -g mcp-decision-intelligence
```

```jsonc
// ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "decision-intelligence": {
      "command": "mcp-decision-intelligence"
    }
  }
}
```

Restart Claude Desktop. The four tools above will appear under the tools panel.

### From source

```bash
git clone https://github.com/mizcausevic-dev/mcp-decision-intelligence.git
cd mcp-decision-intelligence
npm install
npm run build
node dist/index.js
```

---

## Example interaction

> *"Here's the Decision Card we're about to sign — preview the policy bundle and tell me which conditions it'll enforce at runtime."*

Claude calls `preview_policy_bundle(card)` and gets back the JSON shape `policy-as-code-engine` would generate. For `approved-with-conditions` with two conditions, that's two `default_effect: "deny"` policies, each with one `allow when conditions_satisfied.{id} == true` rule. The bundle is deny-trumps-allow, so **every** condition must hold for the bundle to allow.

Claude reads the structure and explains it to you. The structure itself is a deterministic function of the card.

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
  logic.ts        # pure functions; same rules as the Python / Rust services
tests/
  logic.test.ts
  tools.test.ts
```

Adding a new tool is one push to the `tools` array in `tools.ts` — zod schema in, handler out, done.

---

## Related

- **[mcp-reliability-toolkit](https://github.com/mizcausevic-dev/mcp-reliability-toolkit)** — sibling MCP server for the Platform Reliability Stack (SLO burn, rate limiter sizing, breaker design, layered-stack composition).
- **[procurement-decision-api](https://github.com/mizcausevic-dev/procurement-decision-api)** · **[policy-as-code-engine](https://github.com/mizcausevic-dev/policy-as-code-engine)** · **[incident-correlation-rs](https://github.com/mizcausevic-dev/incident-correlation-rs)** · **[data-contract-registry](https://github.com/mizcausevic-dev/data-contract-registry)** — the live services this server mirrors.

---

## License

MIT. See [LICENSE](LICENSE).
