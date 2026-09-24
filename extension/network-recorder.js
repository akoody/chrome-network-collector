const NETWORK_EVENTS = new Set([
  "Network.requestWillBeSent",
  "Network.requestWillBeSentExtraInfo",
  "Network.responseReceived",
  "Network.responseReceivedExtraInfo",
  "Network.loadingFailed",
  "Network.loadingFinished",
  "Network.dataReceived",
  "Network.requestServedFromCache",
  "Network.eventSourceMessageReceived",
  "Network.webSocketCreated",
  "Network.webSocketWillSendHandshakeRequest",
  "Network.webSocketHandshakeResponseReceived",
  "Network.webSocketFrameSent",
  "Network.webSocketFrameReceived",
  "Network.webSocketFrameError",
  "Network.webSocketClosed",
  "Network.webTransportCreated",
  "Network.webTransportConnectionEstablished",
  "Network.webTransportClosed",
]);

const TARGET_FILTER = [
  { type: "iframe", exclude: false },
  { type: "worker", exclude: false },
  { type: "shared_worker", exclude: false },
];

export class NetworkRecorder {
  constructor(tabId, job, emit) {
    this.tabId = tabId;
    this.job = job;
    this.emit = emit;
    this.listener = this.handleEvent.bind(this);
    this.attachedSessions = new Set();
  }

  async start() {
    chrome.debugger.onEvent.addListener(this.listener);
    await this.enableNetwork({ tabId: this.tabId });
    try {
      await command({ tabId: this.tabId }, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: TARGET_FILTER,
      });
    } catch (error) {
      console.info("[collector] Child-target capture is unavailable", error);
    }
  }

  stop() {
    chrome.debugger.onEvent.removeListener(this.listener);
  }

  async enableNetwork(debuggee) {
    await command(debuggee, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 10 * 1024 * 1024,
      maxPostDataSize: 10 * 1024 * 1024,
    });
    await command(debuggee, "Network.setCacheDisabled", { cacheDisabled: true });
    try {
      await command(debuggee, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: TARGET_FILTER,
      });
    } catch {
      // Leaf targets do not expose the Target domain.
    }
  }

  handleEvent(source, method, params) {
    if (source.tabId !== this.tabId) return;
    const debuggee = source.sessionId === undefined
      ? { tabId: this.tabId }
      : { tabId: this.tabId, sessionId: source.sessionId };

    if (method === "Target.attachedToTarget") {
      const sessionId = params.sessionId;
      if (typeof sessionId === "string" && !this.attachedSessions.has(sessionId)) {
        this.attachedSessions.add(sessionId);
        void this.enableNetwork({ tabId: this.tabId, sessionId }).catch(error => {
          console.info("[collector] Could not enable a child target", error);
        });
      }
      return;
    }

    if (!NETWORK_EVENTS.has(method)) return;
    this.emit({
      type: method,
      ...(source.sessionId === undefined ? {} : { sessionId: source.sessionId }),
      params: capEventParams(method, params, this.job.maxBodyBytes),
    });

    if (method === "Network.loadingFinished" && this.job.captureBodies && this.job.maxBodyBytes > 0) {
      void this.captureResponseBody(debuggee, params.requestId);
    }
  }

  async captureResponseBody(debuggee, requestId) {
    try {
      const result = await command(debuggee, "Network.getResponseBody", { requestId });
      const body = capBody(result.body, result.base64Encoded, this.job.maxBodyBytes);
      if (body) {
        this.emit({
          type: "responseBody",
          requestId,
          base64Encoded: Boolean(result.base64Encoded),
          ...body,
        });
      }
    } catch (error) {
      this.emit({
        type: "responseBodyUnavailable",
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function command(debuggee, method, params) {
  return chrome.debugger.sendCommand(debuggee, method, params);
}

function capBody(body, isBase64, maxBytes) {
  if (typeof body !== "string") return undefined;
  const bytes = isBase64 ? Math.floor(body.length * 0.75) : new TextEncoder().encode(body).byteLength;
  if (bytes <= maxBytes) return { body, bytes, truncated: false };
  const prefix = isBase64 ? body.slice(0, Math.floor(maxBytes / 0.75)) : capString(body, maxBytes);
  return { body: prefix, bytes, truncated: true };
}

function capEventParams(method, params, maxBodyBytes) {
  const copy = structuredClone(params);
  const limit = Math.min(Math.max(maxBodyBytes, 64 * 1024), 1_000_000);
  if ((method === "Network.dataReceived" || method === "Network.eventSourceMessageReceived") && typeof copy.data === "string") {
    copy.data = capString(copy.data, limit);
  }
  if (method === "Network.requestWillBeSent" && typeof copy.request?.postData === "string") {
    copy.request.postData = capString(copy.request.postData, limit);
  }
  if ((method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") && typeof copy.response?.payloadData === "string") {
    copy.response.payloadData = capString(copy.response.payloadData, limit);
  }
  return copy;
}

function capString(value, maxBytes) {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && new TextEncoder().encode(value.slice(0, end)).byteLength > maxBytes) {
    end -= Math.ceil(end / 10);
  }
  return `${value.slice(0, end)}\n...[truncated by collector]`;
}
