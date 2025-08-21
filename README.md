# Virtual Web Browser

Virtual Web Browser (VWB) is a Node.js/TypeScript service that runs a remote
Chromium instance and exposes it through HTTP and WebSocket interfaces. It
streams video frames, accepts input events, and manages clipboard operations so
that clients can interact with the browser as if it were local.

## Features

* Launch and control a Chromium session with Puppeteer.
* Static HTTP server for serving the client bundle.
* WebSocket server that proxies keyboard, mouse, wheel and clipboard events.
* Automatic switch between single-client and multi-client modes.
* Optional isolation that opens a dedicated Chromium page for each WebSocket client.
* Helpers for precise coordinate mapping and clipboard management.
* Centralized type definitions under `src/types.ts` for consistent reuse.

## Module Exports

### `clipboard`
- `pasteText(rb, text)` – Paste plain text into the remote page using real
  clipboard operations.

### `http-server`
- `createHttpServer(opts)` – Serve the `public` directory and expose a health
  endpoint. Returns an `HttpServerController`.

### `keyboard`
- `injectKeyPptr(rb, payload)` – Replay key events in the remote page.

### `mouse`
- `injectMousePptr(rb, payload)` – Inject mouse movement and clicks.
- `injectWheelPptr(rb, payload)` – Inject wheel scrolling.

### `remote-browser`
- `RemoteBrowser` – Wrapper around Puppeteer with helpers for streaming frames,
  input injection and coordinate mapping.

### `ws-single` and `ws-multi`
- `createSingleFlow(ctx)` – Flow used when a single client is connected.
- `createMultiFlow(ctx)` – Flow used when multiple clients are connected with a
  leader.

### `ws-server`
- `createWsServer(opts)` – WebSocket server that proxies input to the
  `RemoteBrowser` and broadcasts frames.

### `types`
- Shared interfaces: `CliArgs`, `RemoteBrowserStartOptions`,
  `HttpServerController`, `WsServerController`, `CreateWsServerOptions`,
  `KeyPayload`, `MousePayload`, `MouseInjectPayload`, `WheelPayload`,
  `FlowContext`, and `Flow`.

### `cli`
- Command-line entry point for starting the service.

## Usage

```bash
ts-node src/cli.ts --url https://example.com --port 8080 --isolate
```

This command starts the HTTP and WebSocket servers, launches Chromium and begins
streaming frames from the provided URL. Pass `--isolate` to open one page per
WebSocket client. When isolation is enabled, pages are mapped by client ID so
each connection receives its own dedicated page, and existing sessions remain
active when additional clients join. Pages are tracked by session ID to ensure
tabs are cleaned up correctly on disconnect or reconnect.

