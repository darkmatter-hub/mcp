/**
 * Local store for the chain state across MCP tool invocations.
 *
 * The MCP server is stateless per-call but a Context Passport chain has
 * sequence: every new passport's parent_id is the previous passport's id.
 * This store persists the latest passport id and integrity_hash per session
 * so the next call can chain correctly.
 *
 * Default location: ~/.darkmatter/mcp/<session_id>/
 *   chain.jsonl   - append-only JSONL of every passport committed
 *   latest.json   - the most recent passport (used as parent for the next)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Passport } from "@contextpassport/core";

const ROOT =
  process.env.DARKMATTER_MCP_STORE_DIR ??
  path.join(os.homedir(), ".darkmatter", "mcp");

function sessionDir(sessionId: string): string {
  const dir = path.join(ROOT, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLatest(sessionId: string): Passport | null {
  const file = path.join(sessionDir(sessionId), "latest.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Passport;
  } catch {
    return null;
  }
}

export function append(sessionId: string, passport: Passport): void {
  const dir = sessionDir(sessionId);
  fs.appendFileSync(
    path.join(dir, "chain.jsonl"),
    JSON.stringify(passport) + "\n",
    { encoding: "utf-8" },
  );
  fs.writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify(passport, null, 2),
    { encoding: "utf-8" },
  );
}

export function readChain(sessionId: string): Passport[] {
  const file = path.join(sessionDir(sessionId), "chain.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Passport);
}

export function findById(sessionId: string, id: string): Passport | null {
  return readChain(sessionId).find((p) => p.id === id) ?? null;
}

export function listSessions(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function exportChain(sessionId: string): {
  session_id: string;
  exported_at: string;
  exporter: string;
  passports: Passport[];
} {
  return {
    session_id: sessionId,
    exported_at: new Date().toISOString(),
    exporter: "@darkmatter/mcp-server",
    passports: readChain(sessionId),
  };
}
