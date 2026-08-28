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

const API_URL = process.env.DARKMATTER_API_URL ?? "https://darkmatterhub.ai";
const API_KEY = process.env.DARKMATTER_API_KEY;
// Publishing makes the record readable by anyone holding the link. That is the
// point of a proof URL, but it is not something to do to a user's records
// without being asked, so it is opt-in.
const SHARE = process.env.DARKMATTER_SHARE === "true";

// Remote chain heads, per session. The local chain and the hosted chain are
// separate structures: locally the parent is the previous passport, remotely it
// is the previous commit id returned by the API. Held in memory only, which is
// sufficient because an MCP server runs for the lifetime of the client session.
const remoteHead = new Map<string, string>();

interface PublishResult {
  published: boolean;
  verify_url: string | null;
  verify_public?: boolean;
  error?: string;
}

/**
 * Send the record to DarkMatter, if a key is configured.
 *
 * Versions up to 0.2.0 returned `https://darkmatterhub.ai/r/{id}` for every
 * commit while making no network calls at all, so the link was guaranteed to
 * 404: the record only ever existed on the caller's disk. A verification URL
 * that does not resolve is worse than no URL, because the whole product claim
 * is that the record can be checked by someone else. Now the URL is returned
 * only when there is something at the other end of it.
 */
async function publish(
  sessionId: string,
  passport: Passport,
  args: CommitArgs,
): Promise<PublishResult> {
  if (!API_KEY) return { published: false, verify_url: null };

  try {
    const response = await fetch(`${API_URL}/api/commit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        payload: passport.payload,
        eventType: args.event_type ?? "commit",
        traceId: args.trace_id ?? sessionId,
        parentId: remoteHead.get(sessionId) ?? undefined,
        agent: {
          role: args.role ?? null,
          provider: args.provider ?? null,
          model: args.model ?? null,
        },
        share: SHARE,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        published: false,
        verify_url: null,
        error: `DarkMatter API returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }

    const body = (await response.json()) as {
      id?: string;
      verify_url?: string;
      verify_public?: boolean;
    };
    if (body.id) remoteHead.set(sessionId, body.id);

    return {
      published: true,
      verify_url: body.verify_url ?? null,
      verify_public: body.verify_public,
    };
  } catch (error) {
    // A publishing failure must not lose the record. It is already committed
    // to the local chain by the time this runs, so the commit still succeeds
    // and the caller is told why there is no link.
    return {
      published: false,
      verify_url: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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

export async function commit(args: CommitArgs): Promise<{
  ok: true;
  passport: Passport;
  storage: "local" | "darkmatter";
  verify_url: string | null;
  verify_public?: boolean;
  chain_position: number;
  note?: string;
  publish_error?: string;
}> {
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

  const result = await publish(sessionId, passport, args);
  const chainPosition = store.readChain(sessionId).length;

  if (result.published) {
    return {
      ok: true,
      passport,
      storage: "darkmatter",
      verify_url: result.verify_url,
      verify_public: result.verify_public,
      chain_position: chainPosition,
      note:
        result.verify_public === false
          ? "Record is private. Set DARKMATTER_SHARE=true, or publish it from the dashboard, before sharing this link."
          : undefined,
    };
  }

  return {
    ok: true,
    passport,
    storage: "local",
    verify_url: null,
    chain_position: chainPosition,
    note: API_KEY
      ? "Saved locally. Publishing to DarkMatter failed, so there is no shareable link for this record."
      : "Saved locally and verifiable offline with darkmatter_verify. To publish a record and get a link a third party can check, create a free key at https://darkmatterhub.ai/signup and set DARKMATTER_API_KEY.",
    publish_error: result.error,
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
  bundle: Record<string, unknown>;
} {
  const sessionId = args.session_id ?? "default";
  const base = store.exportChain(sessionId);
  const chain = store.readChain(sessionId);

  // A bundle is the one artifact that leaves the building. Somebody hands it to
  // an auditor, a regulator or a counterparty who has never heard of this
  // format, and until now it arrived as an unexplained blob: session id,
  // timestamp, exporter, an array of objects. Nothing said what it was, that it
  // could be checked at all, or how to check it without trusting whoever sent
  // it.
  //
  // That last part is the entire claim of the format, so the bundle now carries
  // it. Everything below is static text and one verify() call; no network, no
  // account, nothing that can fail at export time.
  return {
    ok: true,
    bundle: {
      format: "context-passport-bundle",
      format_version: "1.0",
      spec: "https://github.com/contextpassport/spec",
      record_schema: "https://contextpassport.com/schema/v2.json",
      ...base,
      chain_intact: verifyChain(chain),
      how_to_verify: {
        summary:
          "Every record commits to the hash of the one before it. Editing any record changes its hash and breaks verification of every record after it. You can confirm that yourself, offline, without trusting whoever gave you this file.",
        python: [
          "pip install context-passport",
          "python -c \"import json,sys; from context_passport import verify_chain; print(verify_chain(json.load(open('bundle.json'))['passports']))\"",
        ],
        typescript: [
          "npm install @contextpassport/core",
          "node -e \"const {verifyChain}=require('@contextpassport/core');console.log(verifyChain(require('./bundle.json').passports))\"",
        ],
        expect:
          "true if the chain is intact. Change one character in any payload and run it again: it returns false, and the record it disagrees with is the one that was altered.",
      },
    },
  };
}

export function listSessions(): { ok: true; sessions: string[] } {
  return { ok: true, sessions: store.listSessions() };
}
