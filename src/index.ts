#!/usr/bin/env node
/**
 * mcp-decision-intelligence — MCP server entry point.
 *
 * Exposes selected offline Decision Intelligence previews over stdio MCP.
 *
 * Wire into Claude Desktop:
 *
 *   Build from source, then use the absolute path to dist/index.js:
 *   {
 *     "mcpServers": {
 *       "decision-intelligence": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/mcp-decision-intelligence/dist/index.js"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";

import { PreviewUnavailableError } from "./logic.js";
import { registerTools, tools } from "./tools.js";

const VERSION = "0.1.0";
const MAX_ARGUMENT_BYTES = 128 * 1024;

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
  if (Buffer.byteLength(JSON.stringify(request.params.arguments ?? {}), "utf8") > MAX_ARGUMENT_BYTES) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code: "input_too_large", message: "Tool arguments exceed 128 KiB" }) }],
    };
  }
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code: "unknown_tool", message: "Unknown tool" }) }],
    };
  }
  try {
    const result = tool.handler(request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const failure = err instanceof PreviewUnavailableError
      ? { code: err.code, message: err.message }
      : err instanceof ZodError
        ? {
            code: "invalid_arguments",
            issues: err.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
          }
        : { code: "tool_error", message: "The tool could not process this input" };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(failure) }],
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
