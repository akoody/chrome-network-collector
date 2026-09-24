const DEFAULTS = {
  controllerUrl: "http://127.0.0.1:8787",
  token: "",
};

const controllerUrlInput = document.querySelector("#controllerUrl");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");
const saveButton = document.querySelector("#save");

chrome.storage.local.get(DEFAULTS).then(settings => {
  controllerUrlInput.value = settings.controllerUrl;
  tokenInput.value = settings.token;
}).catch(() => {
  status.textContent = "Не удалось загрузить настройки";
});

saveButton.addEventListener("click", async () => {
  const controllerUrl = controllerUrlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();

  try {
    const url = new URL(controllerUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Укажи HTTP или HTTPS адрес контроллера");
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Укажи адрес контроллера без пути, параметров и credentials");
    }
    if (!token) throw new Error("Вставь token из консоли контроллера");

    saveButton.disabled = true;
    await chrome.storage.local.set({ controllerUrl, token });
    status.textContent = "Сохранено. Расширение подключается заново.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Не удалось сохранить настройки";
  } finally {
    saveButton.disabled = false;
  }
});
