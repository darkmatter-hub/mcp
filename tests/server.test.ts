/**
 * Tests for the commit path.
 *
 * The behaviour under test is the one that was wrong up to 0.2.0: the server
 * returned a darkmatterhub.ai/r/{id} link for records it never uploaded, so
 * every such link 404ed. These tests pin down that a verification URL is
 * returned only when a record was actually published, and that a publishing
 * failure never costs the caller the record.
 *
 * tools.ts reads its configuration at module load, so each test imports a
 * fresh copy with a cache-busting query string after setting the environment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

async function loadTools(env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), "dm-mcp-"));
  process.env.DARKMATTER_MCP_STORE_DIR = dir;
  for (const key of ["DARKMATTER_API_KEY", "DARKMATTER_API_URL", "DARKMATTER_SHARE"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  const mod = await import(`../src/tools.ts?case=${counter++}`);
  return { mod, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("without an API key: stored locally, and no verification link is invented", async () => {
  const { mod, cleanup } = await loadTools({});
  try {
    const result = await mod.commit({ session_id: "s-nokey", input: "why", output: "because" });

    assert.equal(result.ok, true);
    assert.equal(result.storage, "local");
    assert.equal(result.verify_url, null, "must not return a link to a record that was never uploaded");
    assert.match(result.note, /DARKMATTER_API_KEY/);
    assert.equal(result.chain_position, 1);
    assert.ok(result.passport.integrity.integrity_hash.startsWith("sha256:"));
  } finally {
    cleanup();
  }
});

test("with an API key: publishes and returns the URL the API reports", async () => {
  const { mod, cleanup } = await loadTools({
    DARKMATTER_API_KEY: "dm_sk_test",
    DARKMATTER_API_URL: "https://api.example.test",
  });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any; auth?: string }> = [];

  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body),
      auth: init.headers?.authorization,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "ctx_remote_1",
        verify_url: "https://darkmatterhub.ai/r/ctx_remote_1",
        verify_public: true,
      }),
    };
  }) as any;

  try {
    const result = await mod.commit({ session_id: "s-pub", input: "why", output: "because", role: "analyst" });

    assert.equal(result.storage, "darkmatter");
    assert.equal(result.verify_url, "https://darkmatterhub.ai/r/ctx_remote_1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/api/commit");
    assert.equal(calls[0].auth, "Bearer dm_sk_test");
    assert.equal(calls[0].body.agent.role, "analyst");
    assert.equal(calls[0].body.share, false, "publishing must not be public unless asked");
    assert.equal(calls[0].body.parentId, undefined, "first commit has no remote parent");

    // Second commit in the same session chains to the first remote id.
    await mod.commit({ session_id: "s-pub", input: "next", output: "step" });
    assert.equal(calls[1].body.parentId, "ctx_remote_1");
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("DARKMATTER_SHARE=true asks the API to publish the record", async () => {
  const { mod, cleanup } = await loadTools({
    DARKMATTER_API_KEY: "dm_sk_test",
    DARKMATTER_SHARE: "true",
  });
  const originalFetch = globalThis.fetch;
  let sentShare: unknown;
  globalThis.fetch = (async (_url: string, init: any) => {
    sentShare = JSON.parse(init.body).share;
    return { ok: true, status: 200, json: async () => ({ id: "x", verify_url: "u", verify_public: true }) };
  }) as any;

  try {
    await mod.commit({ session_id: "s-share", input: "a", output: "b" });
    assert.equal(sentShare, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("a failing API does not cost the caller the record", async () => {
  const { mod, cleanup } = await loadTools({ DARKMATTER_API_KEY: "dm_sk_test" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as any;

  try {
    const result = await mod.commit({ session_id: "s-fail", input: "why", output: "because" });

    assert.equal(result.ok, true, "the commit still succeeds");
    assert.equal(result.storage, "local");
    assert.equal(result.verify_url, null);
    assert.equal(result.chain_position, 1, "the record is in the local chain");
    assert.match(result.publish_error, /ENOTFOUND/);
    assert.match(result.note, /failed/i);

    // And the local chain still verifies.
    assert.equal(mod.verify({ session_id: "s-fail" }).verified, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("an API error status is reported rather than swallowed", async () => {
  const { mod, cleanup } = await loadTools({ DARKMATTER_API_KEY: "dm_sk_bad" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error":"Invalid API key format"}',
  })) as any;

  try {
    const result = await mod.commit({ session_id: "s-401", input: "a", output: "b" });
    assert.equal(result.storage, "local");
    assert.equal(result.verify_url, null);
    assert.match(result.publish_error, /401/);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("an exported bundle explains itself to somebody who has never seen one", async () => {
  // The bundle is the one artifact that leaves the building: somebody hands it
  // to an auditor, a regulator or a counterparty who has never heard of this
  // format. It used to arrive as session id, timestamp, exporter and an array
  // of objects, with nothing saying what it was or that it could be checked.
  //
  // Since the whole claim of the format is that a stranger can verify it
  // without trusting the sender, the bundle has to say so and say how.
  const { mod, cleanup } = await loadTools({});
  try {
    await mod.commit({ session_id: "s-bundle", input: "a", output: "b" });
    await mod.commit({ session_id: "s-bundle", input: "c", output: "d" });
    const { bundle } = mod.exportBundle({ session_id: "s-bundle" });

    assert.equal(bundle.format, "context-passport-bundle");
    assert.equal(bundle.spec, "https://github.com/contextpassport/spec");
    assert.ok(bundle.record_schema, "a reader must be able to find the record schema");
    assert.equal(bundle.chain_intact, true);
    assert.equal(bundle.passports.length, 2);

    const how = bundle.how_to_verify;
    assert.ok(how && how.summary, "the bundle must say what verification proves");
    assert.ok(Array.isArray(how.python) && how.python.length >= 2);
    assert.ok(Array.isArray(how.typescript) && how.typescript.length >= 2);

    // The instructions name real packages. Shipping a command that does not
    // run is the failure this whole file exists to prevent.
    assert.ok(how.python.join(" ").includes("context-passport"));
    assert.ok(how.typescript.join(" ").includes("@contextpassport/core"));
    assert.ok(how.expect && /false/i.test(how.expect),
      "the bundle should tell the reader what a failure looks like, not only a pass");
  } finally {
    cleanup();
  }
});
