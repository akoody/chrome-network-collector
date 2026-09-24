import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.js";
import { CaptureConflictError, CaptureService, ExtensionUnavailableError } from "../capture/capture-service.js";
import { InputError } from "../capture/validation.js";
import type { ExtensionGateway } from "../transport/extension-gateway.js";

const MAX_REQUEST_BYTES = 1_000_000;

export function createHttpHandler(
  config: AppConfig,
  captures: CaptureService,
  gateway: ExtensionGateway,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void routeRequest(request, response, config, captures, gateway).catch(error => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: errorMessage(error) });
      } else {
        response.destroy();
      }
    });
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: AppConfig,
  captures: CaptureService,
  gateway: ExtensionGateway,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, extensionConnected: gateway.isConnected() });
    return;
  }

  if (method === "POST" && url.pathname === "/capture") {
    if (!authorized(request, config.authToken)) {
      sendJson(response, 401, { error: "Missing or invalid x-collector-token" });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: errorMessage(error) });
      return;
    }
    try {
      const capture = await captures.start(body);
      sendJson(response, 202, capture);
    } catch (error) {
      if (error instanceof InputError) {
        sendJson(response, 400, { error: error.message });
      } else if (error instanceof CaptureConflictError) {
        sendJson(response, 409, { error: error.message, activeJobId: error.activeJobId });
      } else if (error instanceof ExtensionUnavailableError) {
        sendJson(response, 503, { error: error.message });
      } else {
        throw error;
      }
    }
    return;
  }

  const match = url.pathname.match(/^\/capture\/([a-f0-9-]+)$/i);
  if (method === "GET" && match) {
    if (!authorized(request, config.authToken)) {
      sendJson(response, 401, { error: "Missing or invalid x-collector-token" });
      return;
    }
    const id = match[1];
    const capture = id ? captures.get(id) : undefined;
    if (!capture) {
      sendJson(response, 404, { error: "Capture not found" });
      return;
    }
    sendJson(response, 200, capture);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const token = request.headers["x-collector-token"];
  return typeof token === "string" && token === expectedToken;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buffer.byteLength;
    if (bytesRead > MAX_REQUEST_BYTES) {
      throw new InputError("Request body is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InputError("Request body must be valid JSON");
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Internal server error";
}
