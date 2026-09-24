import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { CaptureDispatcher, CaptureJob, ExtensionMessage } from "../capture/types.js";

type MessageHandler = (message: ExtensionMessage) => void | Promise<void>;
type DisconnectHandler = () => void | Promise<void>;

export class ExtensionGateway implements CaptureDispatcher {
  private readonly webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  private socket: WebSocket | undefined;
  private messageHandler: MessageHandler = () => {};
  private disconnectHandler: DisconnectHandler = () => {};
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(private readonly token: string) {
    this.webSocketServer.on("connection", socket => this.handleConnection(socket));
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/extension" || requestUrl.searchParams.get("token") !== this.token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, client => {
        this.webSocketServer.emit("connection", client, request);
      });
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandler = handler;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(job: CaptureJob): void {
    if (!this.isConnected()) {
      throw new Error("Collector extension is not connected");
    }
    this.socket?.send(JSON.stringify({ type: "start", job }));
  }

  close(): void {
    this.socket?.close(1001, "Collector stopped");
    this.webSocketServer.close();
  }

  private handleConnection(socket: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1012, "Replaced by a newer extension connection");
    }
    this.socket = socket;
    socket.send(JSON.stringify({ type: "connected", protocolVersion: 1 }));

    socket.on("message", raw => this.receive(socket, raw));
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = undefined;
        void this.disconnectHandler();
      }
    });
    socket.on("error", error => console.error("Extension socket error", error.message));
  }

  private receive(socket: WebSocket, raw: RawData): void {
    let message: ExtensionMessage;
    try {
      message = parseExtensionMessage(JSON.parse(raw.toString()));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Invalid message" }));
      return;
    }

    this.messageQueue = this.messageQueue
      .then(() => this.messageHandler(message))
      .then(() => undefined)
      .catch(error => {
        console.error("Could not process extension message", error);
      });
  }
}

function parseExtensionMessage(value: unknown): ExtensionMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Extension message must contain a type");
  }
  if (value.type === "event" && typeof value.jobId === "string" && "event" in value) {
    return { type: "event", jobId: value.jobId, event: value.event };
  }
  if (
    value.type === "result" &&
    typeof value.jobId === "string" &&
    (value.status === "completed" || value.status === "failed")
  ) {
    return {
      type: "result",
      jobId: value.jobId,
      status: value.status,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  }
  if (value.type === "ready") {
    return { type: "ready", ...(typeof value.extensionVersion === "string" ? { extensionVersion: value.extensionVersion } : {}) };
  }
  if (value.type === "heartbeat") {
    return { type: "heartbeat" };
  }
  throw new Error("Unsupported extension message");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
