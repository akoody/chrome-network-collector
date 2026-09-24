import type {
  CaptureDispatcher,
  CaptureEventRecord,
  CaptureSession,
  CaptureSessionView,
  CaptureStatus,
  CaptureStore,
  CaptureWriter,
  ExtensionMessage,
} from "./types.js";
import { createCaptureJob } from "./validation.js";

type ManagedCapture = {
  session: CaptureSession;
  closeWriter: () => Promise<void>;
  append: (record: CaptureEventRecord) => Promise<number>;
  acceptingEvents: boolean;
  finishPromise?: Promise<void>;
};

export class CaptureConflictError extends Error {
  constructor(readonly activeJobId: string) {
    super("A capture is already running");
    this.name = "CaptureConflictError";
  }
}

export class ExtensionUnavailableError extends Error {
  constructor() {
    super("Collector extension is not connected");
    this.name = "ExtensionUnavailableError";
  }
}

export class CaptureService {
  private readonly captures = new Map<string, ManagedCapture>();
  private pendingJobId: string | undefined;

  constructor(
    private readonly store: CaptureStore,
    private readonly dispatcher: CaptureDispatcher,
    private readonly maxDurationMs: number,
  ) {}

  async start(input: unknown): Promise<CaptureSessionView> {
    const job = createCaptureJob(input, this.maxDurationMs);
    const active = [...this.captures.values()].find(({ session }) => session.status === "running" || session.status === "queued");
    if (active || this.pendingJobId) {
      throw new CaptureConflictError(active?.session.id ?? this.pendingJobId ?? "unknown");
    }
    if (!this.dispatcher.isConnected()) {
      throw new ExtensionUnavailableError();
    }

    this.pendingJobId = job.id;
    let writer: CaptureWriter;
    try {
      writer = await this.store.create(job.id);
    } catch (error) {
      this.pendingJobId = undefined;
      throw error;
    }
    const session: CaptureSession = {
      id: job.id,
      job,
      status: "queued",
      createdAt: new Date().toISOString(),
      eventCount: 0,
      bytesWritten: 0,
      outputFile: writer.outputFile,
    };
    const managed: ManagedCapture = {
      session,
      closeWriter: () => writer.close(),
      append: record => writer.append(record),
      acceptingEvents: true,
    };
    this.captures.set(job.id, managed);
    this.pendingJobId = undefined;

    try {
      this.dispatcher.start(job);
      session.status = "running";
      session.startedAt = new Date().toISOString();
      return snapshot(session);
    } catch (error) {
      await this.finish(managed, "failed", error instanceof Error ? error.message : "Could not dispatch capture");
      throw error;
    }
  }

  get(id: string): CaptureSessionView | undefined {
    const capture = this.captures.get(id);
    return capture ? snapshot(capture.session) : undefined;
  }

  async handleExtensionMessage(message: ExtensionMessage): Promise<void> {
    if (message.type === "event") {
      const capture = this.captures.get(message.jobId);
      if (!capture || !capture.acceptingEvents || capture.session.status !== "running") {
        return;
      }

      try {
        const bytes = await capture.append({
          jobId: capture.session.id,
          capturedAt: new Date().toISOString(),
          event: message.event,
        });
        capture.session.eventCount += 1;
        capture.session.bytesWritten += bytes;
      } catch (error) {
        await this.finish(capture, "failed", `Could not write capture output: ${errorMessage(error)}`);
      }
      return;
    }

    if (message.type === "result") {
      const capture = this.captures.get(message.jobId);
      if (capture) {
        await this.finish(capture, message.status, message.error);
      }
    }
  }

  async failRunning(reason: string): Promise<void> {
    const active = [...this.captures.values()].filter(({ session }) => session.status === "running" || session.status === "queued");
    await Promise.all(active.map(capture => this.finish(capture, "failed", reason)));
  }

  private async finish(
    capture: ManagedCapture,
    status: Exclude<CaptureStatus, "queued" | "running">,
    error?: string,
  ): Promise<void> {
    if (capture.session.status === "completed" || capture.session.status === "failed") {
      return;
    }
    if (capture.finishPromise) return capture.finishPromise;

    capture.acceptingEvents = false;
    capture.finishPromise = this.finalize(capture, status, error);
    return capture.finishPromise;
  }

  private async finalize(
    capture: ManagedCapture,
    status: Exclude<CaptureStatus, "queued" | "running">,
    error?: string,
  ): Promise<void> {
    let finalStatus = status;
    let finalError = error;
    try {
      await capture.closeWriter();
    } catch (closeError) {
      finalStatus = "failed";
      finalError = `Could not finalize capture output: ${errorMessage(closeError)}`;
    }
    capture.session.status = finalStatus;
    if (finalError) capture.session.error = finalError;
    capture.session.finishedAt = new Date().toISOString();
  }
}

function snapshot(session: CaptureSession): CaptureSessionView {
  const { job, ...metadata } = session;
  const { proxy, ...jobDetails } = job;
  const publicJob = proxy
    ? {
        ...jobDetails,
        proxy: {
          scheme: proxy.scheme,
          host: proxy.host,
          port: proxy.port,
          hasCredentials: Boolean(proxy.username || proxy.password),
        },
      }
    : jobDetails;
  return { ...metadata, job: publicJob };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
