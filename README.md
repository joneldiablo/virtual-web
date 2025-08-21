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
* Optional isolation mode that launches a dedicated browser per WebSocket
  session.
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
ts-node src/cli.ts --url https://example.com --port 8080
```

This command starts the HTTP and WebSocket servers, launches Chromium and begins
streaming frames from the provided URL.

To give every client its own browser instance:

```bash
ts-node src/cli.ts --url https://example.com --port 8080 --isolate
```

## Testing

- Unit tests cover session controller behavior, keyboard and clipboard helpers, and mouse input (including wheel events) to ensure coordinate mapping and input handling work as expected.
- Run tests with coverage:

```bash
yarn test --coverage
```

Current coverage is roughly 80% of the TypeScript source.

