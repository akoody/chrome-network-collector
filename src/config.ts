import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export type AppConfig = {
  host: string;
  port: number;
  outputDirectory: string;
  authToken: string;
  maxDurationMs: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  return {
    host: environment.HOST?.trim() || "127.0.0.1",
    port: parseInteger(environment.PORT, "PORT", 8787, 1, 65_535),
    outputDirectory: resolve(environment.OUTPUT_DIR?.trim() || "captures"),
    authToken: environment.COLLECTOR_TOKEN?.trim() || randomUUID(),
    maxDurationMs: parseInteger(environment.MAX_DURATION_MS, "MAX_DURATION_MS", 5 * 60_000, 1_000),
  };
}

function parseInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}
