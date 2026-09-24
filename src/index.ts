import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { CaptureService } from "./capture/capture-service.js";
import { NdjsonCaptureStore } from "./capture/ndjson-capture-store.js";
import { createHttpHandler } from "./http/http-handler.js";
import { ExtensionGateway } from "./transport/extension-gateway.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const store = new NdjsonCaptureStore(config.outputDirectory);
  await store.initialize();

  const gateway = new ExtensionGateway(config.authToken);
  const captures = new CaptureService(store, gateway, config.maxDurationMs);
  gateway.onMessage(message => captures.handleExtensionMessage(message));
  gateway.onDisconnect(() => captures.failRunning("Collector extension disconnected"));

  const server = createServer(createHttpHandler(config, captures, gateway));
  gateway.attach(server);

  server.listen(config.port, config.host, () => {
    console.log(`Collector API listening on http://${config.host}:${config.port}`);
    console.log(`Collector API token: ${config.authToken}`);
    console.log(`Extension WebSocket: ws://${config.host}:${config.port}/extension?token=<COLLECTOR_TOKEN>`);
    console.log(`Capture output directory: ${config.outputDirectory}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`Received ${signal}, shutting down`);
    void captures.failRunning("Collector stopped").finally(() => {
      gateway.close();
      server.close(() => process.exit(0));
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch(error => {
  console.error("Collector failed to start", error);
  process.exitCode = 1;
});
