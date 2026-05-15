#!/usr/bin/env node
/**
 * mcp-decision-intelligence — MCP server entry point.
 *
 * Exposes the Kinetic Gain Decision Intelligence portfolio as Claude-callable
 * tools over stdio MCP. The companion to `mcp-reliability-toolkit`: same
 * registry pattern, different problem space.
 *
 * Wire into Claude Desktop:
 *
 *   ~/.config/Claude/claude_desktop_config.json
 *   {
 *     "mcpServers": {
 *       "decision-intelligence": {
 *         "command": "mcp-decision-intelligence"
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { registerTools, tools } from "./tools.js";

const VERSION = "0.1.0";

const server = new Server(
  {
    name: "mcp-decision-intelligence",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    };
  }
  try {
    const result = tool.handler(request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Error in ${tool.name}: ${message}` }],
    };
  }
});

async function main(): Promise<void> {
  registerTools();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("mcp-decision-intelligence failed to start:", err);
  process.exit(1);
});
