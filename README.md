# DarkMatter MCP Server

Universal MCP server that emits [Context Passport](https://contextpassport.com) records for AI agent decisions and actions. Drop into any MCP-compatible client (Claude Code, Cursor, Cline, Continue, ChatGPT Desktop, Zed, Goose, and others) to give your agent a `commit / verify / replay / export` toolset for verifiable, tamper-evident records.

**Built by [DarkMatter](https://darkmatterhub.ai). Implements [Context Passport v1.0](https://github.com/contextpassport/spec), an open CC0 standard.**

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
Result:  { ok: true, passport: {...}, verify_url: "https://darkmatterhub.ai/r/ctx_..." }
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

Records are valid Context Passport v1.0 artifacts. Verify with any conformant implementation:

```bash
pip install context-passport context-passport-conformance
context-passport-conformance --vectors-dir <your-chain-dir>
```

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
