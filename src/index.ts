#!/usr/bin/env node
/**
 * DarkMatter MCP server.
 *
 * Exposes Context Passport tools (commit, verify, replay, export) over the
 * Model Context Protocol. Any MCP-compatible client (Claude Code, Cursor,
 * Cline, Continue, ChatGPT Desktop, Zed, etc.) can install this server and
 * its tools become available to the AI agent in that client.
 *
 * The server emits records in Context Passport v1.0 format (CC0 open standard,
 * see https://contextpassport.com). Records are stored locally by default
 * at ~/.darkmatter/mcp/<session_id>/chain.jsonl and can optionally be
 * forwarded to a DarkMatter receiving server (set DARKMATTER_API_KEY).
 *
 * Transport: stdio. Add to your MCP client config:
 *   {
 *     "mcpServers": {
 *       "darkmatter": { "command": "npx", "args": ["-y", "@darkmatter/mcp-server"] }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  commit,
  verify,
  replay,
  exportBundle,
  listSessions,
} from "./tools.js";

const VERSION = "0.1.0";

const TOOLS = [
  {
    name: "darkmatter_commit",
    description:
      "Commit a Context Passport record of an agent decision or action. Returns a verifiable record id and verify_url. Use this when the agent makes a decision worth recording for later audit or verification.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Optional. Groups passports into a chain. Defaults to 'default'." },
        input: { description: "What the agent received (string or object)." },
        output: { description: "What the agent produced (string or object)." },
        memory: { type: "object", description: "Optional. Persistent state / tool results." },
        variables: { type: "object", description: "Optional. Named values for downstream agents." },
        agent_id: { type: "string", description: "Optional. Identifier for the calling agent." },
        agent_name: { type: "string", description: "Optional. Human-readable agent name." },
        role: { type: "string", description: "Optional. Semantic role (researcher, writer, reviewer, etc)." },
        provider: { type: "string", description: "Optional. LLM provider (anthropic, openai, mistral, etc)." },
        model: { type: "string", description: "Optional. Model name." },
        event_type: {
          type: "string",
          description: "Optional. One of: commit, fork, checkpoint, spawn, retry, timeout, error, override, consent, escalate, redact, audit. Defaults to 'commit'.",
        },
        trace_id: { type: "string", description: "Optional. Groups commits into a pipeline run." },
      },
    },
  },
  {
    name: "darkmatter_verify",
    description:
      "Verify the integrity of the Context Passport chain for a session. Returns true if the hash chain is intact and no records have been tampered with.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Optional. Defaults to 'default'." },
        id: { type: "string", description: "Optional. Verify up to this passport id only." },
      },
    },
  },
  {
    name: "darkmatter_replay",
    description:
      "Walk the Context Passport chain for a session and return the full payload at each step in chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Optional. Defaults to 'default'." },
        id: { type: "string", description: "Optional. Replay up to this passport id only." },
      },
    },
  },
  {
    name: "darkmatter_export",
    description:
      "Export a portable JSON bundle of the entire chain for a session. The bundle is self-contained and can be verified by any third party without contacting DarkMatter.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Optional. Defaults to 'default'." },
      },
    },
  },
  {
    name: "darkmatter_list_sessions",
    description: "List all session ids that have at least one committed Context Passport in local storage.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  {
    name: "darkmatter-mcp",
    version: VERSION,
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case "darkmatter_commit":         result = commit(args as never);           break;
      case "darkmatter_verify":         result = verify(args as never);           break;
      case "darkmatter_replay":         result = replay(args as never);           break;
      case "darkmatter_export":         result = exportBundle(args as never);     break;
      case "darkmatter_list_sessions":  result = listSessions();                  break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error invoking ${name}: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error(`DarkMatter MCP server v${VERSION} ready on stdio`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
