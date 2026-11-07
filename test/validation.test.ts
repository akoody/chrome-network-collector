import assert from "node:assert/strict";
import test from "node:test";
import { createCaptureJob, InputError } from "../src/capture/validation.js";

const MAX = 5 * 60_000;

test("creates a job with defaults and a normalised URL", () => {
  const job = createCaptureJob({ url: "https://Example.com" }, MAX);

  assert.equal(job.url, "https://example.com/");
  assert.equal(job.durationMs, 30_000);
  assert.equal(job.captureBodies, true);
  assert.equal(job.maxBodyBytes, 2_000_000);
  assert.match(job.id, /^[0-9a-f-]{36}$/);
  assert.equal("proxy" in job, false);
});

test("clamps duration and body size to the configured maximum", () => {
  const job = createCaptureJob({ url: "https://a.test", durationMs: 10 * MAX, maxBodyBytes: 1e9 }, MAX);
  assert.equal(job.durationMs, MAX);
  assert.equal(job.maxBodyBytes, 10_000_000);
});

for (const [name, input] of [
  ["not an object", []],
  ["missing url", {}],
  ["relative url", { url: "/path" }],
  ["non-http scheme", { url: "file:///etc/passwd" }],
  ["javascript url", { url: "javascript:alert(1)" }],
  ["too short duration", { url: "https://a.test", durationMs: 999 }],
  ["fractional duration", { url: "https://a.test", durationMs: 1500.5 }],
  ["non-boolean captureBodies", { url: "https://a.test", captureBodies: "yes" }],
  ["negative tabId", { url: "https://a.test", tabId: -1 }],
] as const) {
  test(`rejects ${name}`, () => {
    assert.throws(() => createCaptureJob(input, MAX), InputError);
  });
}

test("parses proxy strings with scheme, default ports and encoded credentials", () => {
  const job = createCaptureJob({ url: "https://a.test", proxy: "socks5://us%40er:p%3Ass@proxy.local" }, MAX);
  assert.deepEqual(job.proxy, {
    scheme: "socks5",
    host: "proxy.local",
    port: 1080,
    username: "us@er",
    password: "p:ss",
  });

  const plain = createCaptureJob({ url: "https://a.test", proxy: "10.0.0.1:3128" }, MAX);
  assert.deepEqual(plain.proxy, { scheme: "http", host: "10.0.0.1", port: 3128 });
});

test("explicit proxy credentials win over the ones in the URL", () => {
  const job = createCaptureJob(
    { url: "https://a.test", proxy: { server: "https://u:p@proxy.local:8443", username: "real", password: "secret" } },
    MAX,
  );
  assert.deepEqual(job.proxy, {
    scheme: "https",
    host: "proxy.local",
    port: 8443,
    username: "real",
    password: "secret",
  });
});

test("rejects proxies with unsupported schemes or extra parts", () => {
  for (const proxy of ["ftp://proxy.local", "http://proxy.local/path", "socks5://proxy.local/path", "http://proxy.local?x=1", { port: 80 }]) {
    assert.throws(() => createCaptureJob({ url: "https://a.test", proxy }, MAX), InputError);
  }
});
