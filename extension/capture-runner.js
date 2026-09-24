import { NetworkRecorder } from "./network-recorder.js";
import { ProxySession } from "./proxy-session.js";

export class CaptureRunner {
  activeJobId;

  constructor(controller) {
    this.controller = controller;
  }

  async run(job) {
    if (!job || typeof job.id !== "string" || this.activeJobId) {
      this.controller.send({
        type: "result",
        jobId: job?.id ?? "unknown",
        status: "failed",
        error: "Another capture is already running or the job is malformed",
      });
      return;
    }

    this.activeJobId = job.id;
    const setupStartedAt = Date.now();
    let captureStartedAt;
    let tabId = job.tabId;
    let createdTab = false;
    let attached = false;
    let recorder;
    const proxy = new ProxySession();
    let status = "completed";
    let errorMessage;

    try {
      await proxy.start(job.proxy);
      if (tabId === undefined) {
        const tab = await chrome.tabs.create({ active: true, url: "about:blank" });
        tabId = tab.id;
        createdTab = true;
      }
      if (typeof tabId !== "number") throw new Error("Chrome did not return a tab id");

      await chrome.debugger.attach({ tabId }, "1.3");
      attached = true;
      recorder = new NetworkRecorder(tabId, job, event => {
        if (!this.controller.send({ type: "event", jobId: job.id, event })) {
          console.warn("[collector] Dropped network event because the controller is disconnected");
        }
      });
      await recorder.start();
      await chrome.debugger.sendCommand({ tabId }, "Page.navigate", { url: job.url });
      captureStartedAt = Date.now();
      await waitForDuration(job.durationMs, captureStartedAt);
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      recorder?.stop();
      await proxy.restore().catch(error => {
        status = "failed";
        errorMessage ??= `Could not restore browser proxy: ${error instanceof Error ? error.message : String(error)}`;
      });
      if (typeof tabId === "number") {
        if (attached) {
          await chrome.debugger.detach({ tabId }).catch(() => {});
        }
        if (createdTab) {
          await chrome.tabs.remove(tabId).catch(() => {});
        }
      }

      this.controller.send({
        type: "result",
        jobId: job.id,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
        stats: { durationMs: Date.now() - (captureStartedAt ?? setupStartedAt) },
      });
      this.activeJobId = undefined;
    }
  }
}

function waitForDuration(durationMs, startedAt) {
  return new Promise(resolve => {
    const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
    setTimeout(resolve, remaining);
  });
}
