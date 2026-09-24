import { CaptureRunner } from "./capture-runner.js";
import { ControllerClient } from "./controller-client.js";

const controller = new ControllerClient();
const runner = new CaptureRunner(controller);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "collector:api") return;

  void requestController(message.action, message.payload)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error instanceof Error ? error.message : "Не удалось связаться с контроллером" }));
  return true;
});

controller.onMessage(message => {
  if (message?.type === "start") {
    void runner.run(message.job);
  }
});

chrome.runtime.onStartup.addListener(() => void controller.connect());
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "install") {
    void chrome.storage.local.set({
      controllerUrl: "http://127.0.0.1:8787",
      token: "",
    });
  }
  void controller.connect();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.controllerUrl || changes.token)) {
    void controller.reconnect();
  }
});

chrome.alarms.create("collector-heartbeat", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "collector-heartbeat") {
    controller.heartbeat();
  }
});

void controller.connect();

async function requestController(action, payload) {
  const settings = await chrome.storage.local.get({
    controllerUrl: "http://127.0.0.1:8787",
    token: "",
  });
  if (!settings.token) throw new Error("Сначала укажи token в настройках расширения");

  const baseUrl = settings.controllerUrl.replace(/\/$/, "");
  let path;
  let options = {};
  if (action === "health") {
    path = "/health";
  } else if (action === "start") {
    path = "/capture";
    options = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    };
  } else if (action === "status" && typeof payload?.id === "string") {
    path = `/capture/${encodeURIComponent(payload.id)}`;
  } else {
    throw new Error("Неизвестная операция");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      "x-collector-token": settings.token,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && result.activeJobId) {
      throw new Error(`Уже выполняется захват ${result.activeJobId}`);
    }
    throw new Error(result.error || `Контроллер ответил с ошибкой (${response.status})`);
  }
  return result;
}
