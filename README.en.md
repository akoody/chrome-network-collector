# Chrome Network Collector

[Русский](README.md) | English

The extension captures network activity from your current Chrome profile and saves it as NDJSON. A local Node.js controller manages captures and stores the files.

## Setup

```bash
npm install
npm run build
npm start
```

Open `chrome://extensions`, enable Developer mode, and load the `extension/` directory as an unpacked extension. Open the extension settings and enter the token printed by the controller.

## Capture

Click the extension icon, enter a URL and duration, optionally configure a proxy, then click **Start capture**. The popup shows the job status, event count, and output file path. Chrome's proxy settings are restored when the capture ends.

By default, the controller listens on `127.0.0.1:8787` and writes files to `captures/`. Set `HOST`, `PORT`, `OUTPUT_DIR`, or `MAX_DURATION_MS` to change the address, port, output directory, or maximum capture duration.

Proxy settings apply to all of Chrome while a capture is running, so captures are limited to one at a time. Response bodies can be disabled in the popup. Streaming responses may not be available in full.
