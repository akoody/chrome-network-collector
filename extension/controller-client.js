const DEFAULT_SETTINGS = {
  controllerUrl: "http://127.0.0.1:8787",
  token: "",
};

export class ControllerClient {
  socket;
  reconnectTimer;
  connecting = false;
  reconnectPending = false;
  messageHandler = () => {};

  onMessage(handler) {
    this.messageHandler = handler;
  }

  async reconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const previousSocket = this.socket;
    this.socket = undefined;
    previousSocket?.close();
    if (this.connecting) {
      this.reconnectPending = true;
      return;
    }
    await this.connect();
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.connecting) return;

    this.connecting = true;
    try {
      const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
      const url = new URL(`${settings.controllerUrl.replace(/\/$/, "")}/extension`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", settings.token);

      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        console.info("[collector] Connected to local controller");
        this.send({ type: "ready", extensionVersion: chrome.runtime.getManifest().version });
      });
      socket.addEventListener("message", event => {
        if (this.socket === socket) this.messageHandler(parseMessage(event.data));
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) this.socket = undefined;
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        console.warn("[collector] Local controller connection failed");
      });
    } catch (error) {
      console.error("[collector] Could not connect to the local controller", error);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
      if (this.reconnectPending) {
        this.reconnectPending = false;
        void this.reconnect();
      }
    }
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  heartbeat() {
    if (!this.send({ type: "heartbeat" })) void this.connect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 2_000);
  }
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[collector] Ignoring malformed controller message");
    return undefined;
  }
}
