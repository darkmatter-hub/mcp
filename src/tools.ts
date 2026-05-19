/**
 * MCP tool implementations.
 *
 * Each function here is exposed to the AI agent as an MCP tool. The
 * agent decides when to call them. Auto-capture across every agent
 * action (without explicit invocation) is the job of a separate hook
 * bundle adapter (e.g., darkmatter-hub/claude-code).
 */

import { makePassport, verifyChain, type Passport } from "@contextpassport/core";
import * as store from "./store.js";

const SERVER_AGENT_ID = "mcp:@darkmatter/mcp-server";
const SERVER_AGENT_NAME = "DarkMatter MCP Server";

interface CommitArgs {
  session_id?: string;
  input?: unknown;
  output?: unknown;
  memory?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  agent_id?: string;
  agent_name?: string;
  role?: string;
  provider?: string;
  model?: string;
  event_type?: string;
  trace_id?: string;
}

export function commit(args: CommitArgs): {
  ok: true;
  passport: Passport;
  verify_url: string;
  chain_position: number;
} {
  const sessionId = args.session_id ?? "default";
  const parent = store.getLatest(sessionId);
  const passport = makePassport({
    agentId: args.agent_id ?? SERVER_AGENT_ID,
    agentName: args.agent_name ?? SERVER_AGENT_NAME,
    payload: {
      input: args.input ?? null,
      output: args.output ?? null,
      memory: args.memory ?? null,
      variables: args.variables ?? null,
    },
    parent,
    role: args.role ?? null,
    provider: args.provider ?? null,
    model: args.model ?? null,
    eventType: args.event_type ?? "commit",
    traceId: args.trace_id ?? null,
  });
  store.append(sessionId, passport);
  return {
    ok: true,
    passport,
    verify_url: `https://darkmatterhub.ai/r/${passport.id}`,
    chain_position: store.readChain(sessionId).length,
  };
}

export function verify(args: { session_id?: string; id?: string }): {
  ok: boolean;
  verified: boolean;
  chain_length: number;
  message?: string;
} {
  const sessionId = args.session_id ?? "default";
  const chain = store.readChain(sessionId);
  if (chain.length === 0) {
    return { ok: true, verified: false, chain_length: 0, message: "no records in this session" };
  }
  if (args.id) {
    const idx = chain.findIndex((p) => p.id === args.id);
    if (idx === -1) {
      return { ok: false, verified: false, chain_length: chain.length, message: `id not found: ${args.id}` };
    }
    const partial = chain.slice(0, idx + 1);
    return { ok: true, verified: verifyChain(partial), chain_length: partial.length };
  }
  return { ok: true, verified: verifyChain(chain), chain_length: chain.length };
}

export function replay(args: { session_id?: string; id?: string }): {
  ok: boolean;
  chain_intact: boolean;
  total_steps: number;
  passports: Passport[];
} {
  const sessionId = args.session_id ?? "default";
  let chain = store.readChain(sessionId);
  if (args.id) {
    const idx = chain.findIndex((p) => p.id === args.id);
    if (idx >= 0) chain = chain.slice(0, idx + 1);
  }
  return {
    ok: true,
    chain_intact: verifyChain(chain),
    total_steps: chain.length,
    passports: chain,
  };
}

export function exportBundle(args: { session_id?: string }): {
  ok: true;
  bundle: ReturnType<typeof store.exportChain>;
} {
  const sessionId = args.session_id ?? "default";
  return { ok: true, bundle: store.exportChain(sessionId) };
}

export function listSessions(): { ok: true; sessions: string[] } {
  return { ok: true, sessions: store.listSessions() };
}
