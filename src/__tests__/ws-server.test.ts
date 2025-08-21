import type { WebSocket } from "ws";

// Capture handler registered via express-ws
let wsHandler: any;
const wsApp = {
  ws: jest.fn((_path: string, handler: any) => {
    wsHandler = handler;
  }),
} as any;

// Mock external and local dependencies
jest.mock("express-ws", () => ({
  __esModule: true,
  default: jest.fn(() => ({ app: wsApp })),
}));

const startMock = jest.fn().mockResolvedValue(true);
const ensurePageMock = jest.fn().mockResolvedValue(true);
const stopMock = jest.fn().mockResolvedValue(true);
const closePageMock = jest.fn().mockResolvedValue(true);
const usePageMock = jest.fn();

jest.mock("../remote-browser", () => ({
  RemoteBrowser: jest.fn().mockImplementation(() => ({
    start: startMock,
    ensurePage: ensurePageMock,
    stop: stopMock,
    closePage: closePageMock,
    usePage: usePageMock,
  })),
}));

const createSingleFlowMock = jest.fn((args: any) => ({
  name: "single",
  onConnect: jest.fn(),
  onMessage: jest.fn((ws: any, cid: number, msg: any) => {
    if (msg.type === "hello") return args.ensureRemoteBrowser(cid, ws);
  }),
  onDisconnect: jest.fn(),
  onSwitchIn: jest.fn(),
}));
const createMultiFlowMock = jest.fn((args: any) => ({
  name: "multi",
  onConnect: jest.fn(),
  onMessage: jest.fn((ws: any, cid: number, msg: any) => {
    if (msg.type === "hello") return args.ensureRemoteBrowser(cid, ws);
  }),
  onDisconnect: jest.fn(),
  onSwitchIn: jest.fn(),
}));

jest.mock("../ws-single", () => ({ createSingleFlow: createSingleFlowMock }));
jest.mock("../ws-multi", () => ({ createMultiFlow: createMultiFlowMock }));

import { createWsServer } from "../ws-server";

function makeWs(): WebSocket & { handlers: Record<string, any> } {
  const handlers: Record<string, any> = {};
  return {
    handlers,
    on: jest.fn((evt, fn) => {
      handlers[evt] = fn;
    }),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1,
  } as any;
}

describe("createWsServer isolate mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates and closes pages per client when isolate is true", async () => {
    const app = { get: jest.fn() } as any;
    const server = {} as any;
    createWsServer({
      app,
      server,
      url: "http://example.com",
      width: 800,
      height: 600,
      headful: false,
      quality: 60,
      fps: 30,
      isolate: true,
    });

    const ws1 = makeWs();
    wsHandler(ws1 as any, { url: "/ws" } as any);
    await ws1.handlers.message(JSON.stringify({ type: "hello" }));
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(ensurePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ cid: 1 })
    );

    const ws2 = makeWs();
    wsHandler(ws2 as any, { url: "/ws" } as any);
    await ws2.handlers.message(JSON.stringify({ type: "hello" }));
    expect(ensurePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ cid: 2 })
    );
    expect(createMultiFlowMock).not.toHaveBeenCalled();

    await ws1.handlers.close();
    expect(closePageMock).toHaveBeenCalledWith(1);
    expect(stopMock).not.toHaveBeenCalled();

    await ws2.handlers.close();
    expect(closePageMock).toHaveBeenCalledWith(2);
    expect(stopMock).toHaveBeenCalled();
  });
});

