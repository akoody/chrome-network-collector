import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { tokenMatches } from "../src/auth-token.js";
import { NdjsonCaptureStore } from "../src/capture/ndjson-capture-store.js";
import { loadConfig } from "../src/config.js";

test("config defaults to loopback and a random token", () => {
  const a = loadConfig({});
  const b = loadConfig({});
  assert.equal(a.host, "127.0.0.1");
  assert.equal(a.port, 8787);
  assert.notEqual(a.authToken, b.authToken);
  assert.equal(loadConfig({ COLLECTOR_TOKEN: " fixed " }).authToken, "fixed");
});

test("config rejects invalid numbers instead of falling back silently", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT/);
  assert.throws(() => loadConfig({ MAX_DURATION_MS: "abc" }), /MAX_DURATION_MS/);
});

test("token check accepts only the exact token", () => {
  assert.equal(tokenMatches("secret-token", "secret-token"), true);
  assert.equal(tokenMatches("secret-toke", "secret-token"), false);
  assert.equal(tokenMatches("", "secret-token"), false);
  assert.equal(tokenMatches(undefined, "secret-token"), false);
  assert.equal(tokenMatches(["secret-token"], "secret-token"), false);
});

test("capture store writes one JSON record per line in order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collector-"));
  const store = new NdjsonCaptureStore(directory);
  await store.initialize();

  const writer = await store.create("job-1");
  const sizes = await Promise.all([1, 2, 3].map((n) => writer.append({ n } as never)));
  await writer.close();

  const lines = (await readFile(writer.outputFile, "utf8")).trim().split("\n");
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.deepEqual(sizes, lines.map((line) => Buffer.byteLength(`${line}\n`)));
  await assert.rejects(writer.append({ n: 4 } as never), /already closed/);
});

test("capture store refuses to overwrite an existing capture", async () => {
  const store = new NdjsonCaptureStore(await mkdtemp(join(tmpdir(), "collector-")));
  await store.initialize();
  await (await store.create("same")).close();
  await assert.rejects(store.create("same"), /EEXIST/);
});
