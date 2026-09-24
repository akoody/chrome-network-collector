const DEFAULTS = {
  controllerUrl: "http://127.0.0.1:8787",
  token: "",
  lastCaptureRequest: {},
  lastCapture: null,
};

const form = document.querySelector("#capture-form");
const urlInput = document.querySelector("#url");
const durationInput = document.querySelector("#duration");
const bodiesInput = document.querySelector("#capture-bodies");
const proxyServerInput = document.querySelector("#proxy-server");
const proxyUsernameInput = document.querySelector("#proxy-username");
const proxyPasswordInput = document.querySelector("#proxy-password");
const startButton = document.querySelector("#start");
const connection = document.querySelector("#connection");
const captureSection = document.querySelector("#capture");
const captureStatus = document.querySelector("#capture-status");
const captureTime = document.querySelector("#capture-time");
const captureSummary = document.querySelector("#capture-summary");
const captureError = document.querySelector("#capture-error");
const outputRow = document.querySelector("#output-row");
const outputFile = document.querySelector("#output-file");
const message = document.querySelector("#message");

let pollTimer;
let activeId;

document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#copy-path").addEventListener("click", async () => {
  const path = outputFile.textContent;
  try {
    await navigator.clipboard.writeText(path);
    message.textContent = "Путь скопирован";
  } catch {
    message.textContent = "Не удалось скопировать путь";
  }
});

form.addEventListener("submit", startCapture);

initialize();

async function initialize() {
  try {
    const settings = await chrome.storage.local.get(DEFAULTS);
    const [health, last] = await Promise.all([
      api("health"),
      Promise.resolve(settings.lastCapture),
    ]);
    connection.textContent = health.extensionConnected
      ? "Контроллер подключён"
      : "Расширение не подключено к контроллеру";
    connection.dataset.ready = String(health.extensionConnected);

    if (settings.lastCaptureRequest.url) urlInput.value = settings.lastCaptureRequest.url;
    if (settings.lastCaptureRequest.durationSeconds) durationInput.value = settings.lastCaptureRequest.durationSeconds;
    if (last?.id) {
      renderCapture(last);
      if (last.status === "running" || last.status === "queued") {
        activeId = last.id;
        setBusy(true);
        pollCapture();
      }
    }
  } catch (error) {
    connection.textContent = "Нет связи с контроллером";
    showError(error.message);
  }
}

async function startCapture(event) {
  event.preventDefault();
  message.textContent = "";
  const url = urlInput.value.trim();
  let target;
  try {
    target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Поддерживаются только HTTP и HTTPS адреса");
    }
  } catch (error) {
    showError(error.message || "Укажи корректный адрес сайта");
    return;
  }

  const durationSeconds = Number(durationInput.value);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) {
    showError("Длительность должна быть от 1 до 300 секунд");
    return;
  }

  const request = {
    url: target.toString(),
    durationMs: durationSeconds * 1000,
    captureBodies: bodiesInput.checked,
  };
  const proxyServer = proxyServerInput.value.trim();
  if (proxyServer) {
    request.proxy = {
      server: proxyServer,
      ...(proxyUsernameInput.value ? { username: proxyUsernameInput.value } : {}),
      ...(proxyPasswordInput.value ? { password: proxyPasswordInput.value } : {}),
    };
  } else if (proxyUsernameInput.value || proxyPasswordInput.value) {
    showError("Сначала укажи адрес прокси");
    return;
  }

  setBusy(true);
  captureError.hidden = true;
  captureSection.hidden = false;
  captureStatus.textContent = "Отправка задания…";
  try {
    const result = await api("start", request);
    activeId = result.id;
    await chrome.storage.local.set({
      lastCaptureRequest: { url: request.url, durationSeconds },
      lastCapture: result,
    });
    renderCapture(result);
    pollCapture();
  } catch (error) {
    setBusy(false);
    showError(error.message);
    captureStatus.textContent = "Не удалось запустить захват";
  }
}

async function pollCapture() {
  clearTimeout(pollTimer);
  if (!activeId) return;
  try {
    const result = await api("status", { id: activeId });
    await chrome.storage.local.set({ lastCapture: result });
    renderCapture(result);
    if (result.status === "running" || result.status === "queued") {
      pollTimer = setTimeout(pollCapture, 1_000);
    } else {
      activeId = undefined;
      setBusy(false);
    }
  } catch (error) {
    captureStatus.textContent = "Статус временно недоступен";
    showError(error.message);
    pollTimer = setTimeout(pollCapture, 2_000);
  }
}

function renderCapture(capture) {
  captureSection.hidden = false;
  captureStatus.textContent = statusLabel(capture.status);
  captureTime.textContent = capture.status === "running"
    ? `${formatCount(capture.eventCount)} событий · ${formatBytes(capture.bytesWritten)}`
    : "";
  captureSummary.textContent = capture.status === "completed" || capture.status === "failed"
    ? `${formatCount(capture.eventCount)} событий · ${formatBytes(capture.bytesWritten)}`
    : "Запись сетевых событий…";
  captureError.textContent = capture.error || "";
  captureError.hidden = !capture.error;
  outputRow.hidden = !capture.outputFile;
  outputFile.textContent = capture.outputFile || "";
}

function statusLabel(status) {
  return ({ queued: "В очереди", running: "Идёт захват", completed: "Готово", failed: "Ошибка" })[status] || status;
}

function setBusy(busy) {
  startButton.disabled = busy;
  startButton.textContent = busy ? "Захват выполняется…" : "Начать захват";
}

function showError(text) {
  message.textContent = text || "Неизвестная ошибка";
}

function formatCount(value) {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

function formatBytes(value) {
  if (!value) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ${units[index]}`;
}

function api(action, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "collector:api", action, payload }, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
      } else if (!response || response.error) {
        reject(new Error(response?.error || "Нет ответа от расширения"));
      } else {
        resolve(response);
      }
    });
  });
}
