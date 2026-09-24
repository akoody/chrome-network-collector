import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { CaptureJob, CaptureRequest, ProxyConfig, ProxyInput } from "./types.js";

const MAX_URL_LENGTH = 8_192;
const MAX_BODY_BYTES = 10_000_000;
const DEFAULT_DURATION_MS = 30_000;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function createCaptureJob(input: unknown, maxDurationMs: number): CaptureJob {
  if (!isRecord(input)) {
    throw new InputError("A JSON object is required");
  }

  const request = input as CaptureRequest;
  const url = normalizeTargetUrl(request.url);
  const durationMs = normalizeInteger(request.durationMs, DEFAULT_DURATION_MS, 1_000, maxDurationMs, "durationMs");
  const maxBodyBytes = normalizeInteger(request.maxBodyBytes, 2_000_000, 0, MAX_BODY_BYTES, "maxBodyBytes");
  const proxy = normalizeProxy(request.proxy);

  if (request.captureBodies !== undefined && typeof request.captureBodies !== "boolean") {
    throw new InputError("captureBodies must be a boolean");
  }
  if (request.tabId !== undefined && (!Number.isSafeInteger(request.tabId) || request.tabId < 0)) {
    throw new InputError("tabId must be a non-negative integer");
  }

  return {
    id: randomUUID(),
    url,
    durationMs,
    captureBodies: request.captureBodies ?? true,
    maxBodyBytes,
    ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
    ...(proxy === undefined ? {} : { proxy }),
  };
}

function normalizeTargetUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_URL_LENGTH) {
    throw new InputError("url must be a non-empty URL no longer than 8192 characters");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InputError("url must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InputError("Only http:// and https:// URLs are supported");
  }
  return parsed.toString();
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) {
    return Math.min(Math.max(fallback, minimum), maximum);
  }
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new InputError(`${field} must be an integer greater than or equal to ${minimum}`);
  }
  return Math.min(value as number, maximum);
}

function normalizeProxy(value: unknown): ProxyConfig | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  let input: ProxyInput;
  if (typeof value === "string") {
    input = value;
  } else if (isRecord(value) && typeof value.server === "string") {
    input = {
      server: value.server,
      ...(typeof value.username === "string" ? { username: value.username } : {}),
      ...(typeof value.password === "string" ? { password: value.password } : {}),
    };
  } else {
    throw new InputError("proxy must be a URL string or an object with a server string");
  }

  const rawServer = typeof input === "string" ? input : input.server;
  let parsed: URL;
  try {
    parsed = new URL(rawServer.includes("://") ? rawServer : `http://${rawServer}`);
  } catch {
    throw new InputError("proxy must contain a valid host and optional port");
  }

  const scheme = parsed.protocol.slice(0, -1);
  if (scheme !== "http" && scheme !== "https" && scheme !== "socks4" && scheme !== "socks5") {
    throw new InputError("Proxy scheme must be http, https, socks4 or socks5");
  }
  if (!parsed.hostname || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new InputError("Proxy must contain only scheme, host, port and credentials");
  }

  const defaultPort = scheme === "socks4" || scheme === "socks5" ? 1080 : scheme === "https" ? 443 : 80;
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new InputError("Proxy port is invalid");
  }

  const username = typeof input === "string"
    ? decodeCredential(parsed.username)
    : input.username ?? decodeCredential(parsed.username);
  const password = typeof input === "string"
    ? decodeCredential(parsed.password)
    : input.password ?? decodeCredential(parsed.password);

  return {
    scheme,
    host: parsed.hostname,
    port,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
  };
}

function decodeCredential(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InputError("Proxy credentials contain invalid URL encoding");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
