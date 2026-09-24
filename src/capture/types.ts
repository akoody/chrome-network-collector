export type ProxyInput = string | {
  server: string;
  username?: string;
  password?: string;
};

export type ProxyConfig = {
  scheme: "http" | "https" | "socks4" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type CaptureRequest = {
  url: string;
  durationMs?: number;
  proxy?: ProxyInput;
  captureBodies?: boolean;
  maxBodyBytes?: number;
  tabId?: number;
};

export type CaptureJob = {
  id: string;
  url: string;
  durationMs: number;
  proxy?: ProxyConfig;
  captureBodies: boolean;
  maxBodyBytes: number;
  tabId?: number;
};

export type CaptureStatus = "queued" | "running" | "completed" | "failed";

export type CaptureSession = {
  id: string;
  job: CaptureJob;
  status: CaptureStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  eventCount: number;
  bytesWritten: number;
  outputFile: string;
  error?: string;
};

export type CaptureSessionView = Omit<CaptureSession, "job"> & { job: PublicCaptureJob };

export type PublicCaptureJob = Omit<CaptureJob, "proxy"> & {
  proxy?: Omit<ProxyConfig, "username" | "password"> & { hasCredentials: boolean };
};

export type CaptureEventRecord = {
  jobId: string;
  capturedAt: string;
  event: unknown;
};

export type ExtensionMessage =
  | { type: "event"; jobId: string; event: unknown }
  | { type: "result"; jobId: string; status: "completed" | "failed"; error?: string }
  | { type: "ready"; extensionVersion?: string }
  | { type: "heartbeat" };

export type CaptureWriter = {
  readonly outputFile: string;
  append(record: CaptureEventRecord): Promise<number>;
  close(): Promise<void>;
};

export type CaptureStore = {
  initialize(): Promise<void>;
  create(jobId: string): Promise<CaptureWriter>;
};

export type CaptureDispatcher = {
  isConnected(): boolean;
  start(job: CaptureJob): void;
};
