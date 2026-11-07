# Chrome Network Collector

[![CI](https://github.com/akoody/chrome-network-collector/actions/workflows/ci.yml/badge.svg)](https://github.com/akoody/chrome-network-collector/actions/workflows/ci.yml)

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

A proxy is either a string (`host:port`, `http://user:pass@host:port`, `socks5://host:1080`) or an object with `server`, `username` and `password`. Supported schemes: http, https, socks4 and socks5.

## Security

The controller listens on `127.0.0.1` only. The HTTP API and the extension WebSocket require a token, generated on every start or set with `COLLECTOR_TOKEN`, and compared in constant time. Only http and https pages can be captured.

## Development

```bash
npm run check   # TypeScript, tests, build
```

`node:test` tests cover job validation (URLs, duration and body limits, proxy parsing with credentials), configuration, token checks and NDJSON output. CI runs `npm run check` on every pull request.

## License

[MIT](LICENSE)
