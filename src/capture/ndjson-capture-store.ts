import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureEventRecord, CaptureStore, CaptureWriter } from "./types.js";

export class NdjsonCaptureStore implements CaptureStore {
  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async create(jobId: string): Promise<CaptureWriter> {
    const outputFile = join(this.directory, `${jobId}.ndjson`);
    const handle = await open(outputFile, "wx");
    let pendingWrites = Promise.resolve();
    let closed = false;

    return {
      outputFile,
      append(record: CaptureEventRecord): Promise<number> {
        if (closed) {
          return Promise.reject(new Error("Capture file is already closed"));
        }
        const line = `${JSON.stringify(record)}\n`;
        const bytes = Buffer.byteLength(line);
        const write = pendingWrites.then(() => handle.appendFile(line, "utf8"));
        pendingWrites = write;
        return write.then(() => bytes);
      },
      async close(): Promise<void> {
        if (closed) {
          await pendingWrites;
          return;
        }
        closed = true;
        try {
          await pendingWrites;
        } finally {
          await handle.close();
        }
      },
    };
  }
}
