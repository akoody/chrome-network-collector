export class ProxySession {
  originalSettings;
  credentials;
  authAttempts = new Map();
  started = false;

  constructor() {
    this.onAuthRequired = this.onAuthRequired.bind(this);
    this.clearAuthAttempt = this.clearAuthAttempt.bind(this);
  }

  async start(proxy) {
    if (!proxy) return;

    this.originalSettings = await chrome.proxy.settings.get({ incognito: false });
    this.credentials = {
      username: proxy.username ?? "",
      password: proxy.password ?? "",
    };
    chrome.webRequest.onAuthRequired.addListener(
      this.onAuthRequired,
      { urls: ["<all_urls>"] },
      ["asyncBlocking"],
    );
    chrome.webRequest.onCompleted.addListener(this.clearAuthAttempt, { urls: ["<all_urls>"] });
    chrome.webRequest.onErrorOccurred.addListener(this.clearAuthAttempt, { urls: ["<all_urls>"] });
    this.started = true;

    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port },
          bypassList: ["<local>"],
        },
      },
      scope: "regular",
    });
  }

  async restore() {
    if (!this.started) return;
    chrome.webRequest.onAuthRequired.removeListener(this.onAuthRequired);
    chrome.webRequest.onCompleted.removeListener(this.clearAuthAttempt);
    chrome.webRequest.onErrorOccurred.removeListener(this.clearAuthAttempt);
    this.credentials = undefined;
    this.authAttempts.clear();
    this.started = false;

    if (this.originalSettings?.value) {
      await chrome.proxy.settings.set({ value: this.originalSettings.value, scope: "regular" });
    }
    this.originalSettings = undefined;
  }

  onAuthRequired(details, callback) {
    if (!this.credentials || !details.isProxy) {
      callback({});
      return;
    }

    const attempts = this.authAttempts.get(details.requestId) ?? 0;
    if (attempts >= 2) {
      callback({});
      return;
    }
    this.authAttempts.set(details.requestId, attempts + 1);
    callback({ authCredentials: this.credentials });
  }

  clearAuthAttempt(details) {
    this.authAttempts.delete(details.requestId);
  }
}
