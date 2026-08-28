# DarkMatter MCP Server

Universal MCP server that emits [Context Passport](https://contextpassport.com) records for AI agent decisions and actions. Drop into any MCP-compatible client (Claude Code, Cursor, Cline, Continue, ChatGPT Desktop, Zed, Goose, and others) to give your agent a `commit / verify / replay / export` toolset for verifiable, tamper-evident records.

**Built by [DarkMatter](https://darkmatterhub.ai). Implements [Context Passport v2.0](https://github.com/contextpassport/spec), an open CC0 standard. Records emitted by this server use RFC 8785 (JCS) canonicalization and are byte-equivalent across the Python and TypeScript reference SDKs.**

## Install

In your MCP client's config (`claude_desktop_config.json`, Cursor's `mcp.json`, etc.):

```json
{
  "mcpServers": {
    "darkmatter": {
      "command": "npx",
      "args": ["-y", "@darkmatterhub/mcp-server"]
    }
  }
}
```

Restart the client. Five tools become available to your agent:

- `darkmatter_commit` — record an agent decision or action
- `darkmatter_verify` — check that the chain has not been tampered with
- `darkmatter_replay` — walk the full chain in order
- `darkmatter_export` — produce a portable proof bundle
- `darkmatter_list_sessions` — see what sessions exist locally

## Bundles explain themselves

`darkmatter_export` produces a bundle that a stranger can act on. Alongside the
records it carries the format name, a link to the specification, whether the
chain was intact at export time, and the exact command to verify it in Python or
TypeScript, plus what a failure looks like.

That matters because the bundle is the artifact that leaves your machine. It
goes to an auditor, a regulator or a counterparty who has never heard of this
format, and the whole claim is that they can check it without trusting whoever
sent it. A bundle that does not say how is asking to be trusted.

## Local by default, published when you ask

With no configuration the server keeps every record on your own disk. The
chain verifies offline through `darkmatter_verify`, so you can evaluate the
whole idea without an account.

Set an API key to publish records and get a link somebody else can check:

| Variable | Effect |
|---|---|
| `DARKMATTER_API_KEY` | Publishes each record to DarkMatter and returns a `verify_url`. Get one at [darkmatterhub.ai](https://darkmatterhub.ai). |
| `DARKMATTER_SHARE` | Set to `true` to make published records readable by anyone with the link. Off by default, because publishing is not something to do to your records without being asked. |
| `DARKMATTER_API_URL` | Override the API host. Defaults to `https://darkmatterhub.ai`. |
| `DARKMATTER_MCP_STORE_DIR` | Where local records are written. |

`commit` reports which of the two happened, in the `storage` field. If
publishing fails the record is still committed locally and the error is
returned alongside it, so a network problem cannot cost you the record.

> **Changed in 0.3.0.** Earlier versions returned a
> `https://darkmatterhub.ai/r/{id}` link for every commit while making no
> network calls at all, so the link always 404ed. A verification URL is now
> returned only when there is a published record behind it.

## What gets captured

Whatever the agent (or user) explicitly invokes via `darkmatter_commit`. Auto-capture of every tool call without explicit invocation is a separate component (see [Auto-capture](#auto-capture) below).

Example agent flow:

```
User:    Approve the refund for order #1247 and record the decision.
Agent:   Calls refund_order(1247).
Agent:   Calls darkmatter_commit({
           input: "Approve refund for order #1247",
           output: "Approved. $84.00 refunded to original payment method.",
           role: "compliance",
           event_type: "commit"
         })
Result:  { ok: true, passport: {...}, storage: "local", verify_url: null,
           note: "Saved locally and verifiable offline..." }
```

The passport is signed (if a key is configured), hash-chained to the previous commit in the session, and stored locally at `~/.darkmatter/mcp/<session_id>/chain.jsonl`.

## Storage

Default: local-only. Passports never leave the machine.

```
~/.darkmatter/mcp/
├── default/
│   ├── chain.jsonl        # append-only stream of all commits
│   └── latest.json        # most recent passport (used as parent for the next)
└── <other-session-id>/
    └── ...
```

To forward each passport to a DarkMatter receiving server in addition to local storage, set:

```bash
export DARKMATTER_API_KEY="dm_sk_..."
```

The forwarding is best-effort and never blocks the agent's tool call. Local storage remains the source of truth.

## Auto-capture

The MCP server captures only what the agent explicitly invokes. To auto-capture every tool call and turn boundary in a specific dev tool (without the agent having to remember to call `darkmatter_commit`), install one of the dev-tool-specific adapters:

- [darkmatter-hub/claude-code](https://github.com/darkmatter-hub/claude-code) — auto-capture for Claude Code (Anthropic)
- Cursor adapter — planned
- OpenAI Codex adapter — planned
- Aider adapter — community-built welcome

Each adapter hooks into its specific dev tool's event lifecycle and routes events through this MCP server's `darkmatter_commit` tool. One canonical endpoint, many capture surfaces.

## Verification

Records are valid Context Passport v2.0 artifacts. Verify with any conformant implementation:

```bash
pip install context-passport context-passport-conformance
context-passport-conformance --level signed     # 9/9 vectors, no --vectors-dir needed
```

The conformance package ships its vectors inside the wheel, so this is a one-line check against the public reference suite.

Or use the offline reference verifier directly on the JSONL file:

```python
import json
from context_passport import verify_chain

with open("~/.darkmatter/mcp/default/chain.jsonl") as f:
    chain = [json.loads(line) for line in f]

print(verify_chain(chain))  # True if intact, False if tampered
```

## Why MCP

MCP (Model Context Protocol) is becoming the universal interop layer for AI tools. Writing this server once means it works in every MCP-compatible client without per-client integration code. See the [Context Passport for MCP proposal](https://github.com/contextpassport/spec/blob/main/proposals/context-passport-for-mcp.md) for the broader architectural rationale.

## License

Apache-2.0. See `LICENSE`.

The Context Passport schema this server implements is released separately under CC0 1.0 at [github.com/contextpassport/spec](https://github.com/contextpassport/spec).

## Related repositories

- [github.com/contextpassport/spec](https://github.com/contextpassport/spec) — the open standard
- [github.com/contextpassport/python](https://github.com/contextpassport/python) — Python reference SDK
- [github.com/contextpassport/typescript](https://github.com/contextpassport/typescript) — TypeScript reference SDK
- [github.com/darkmatter-hub/claude-code](https://github.com/darkmatter-hub/claude-code) — auto-capture for Claude Code
- [github.com/darkmatter-hub/darkmatter](https://github.com/darkmatter-hub/darkmatter) — DarkMatter receiving server
