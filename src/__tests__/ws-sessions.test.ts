import { createSessionController } from "../ws-sessions";
import type { WebSocket } from "ws";

jest.mock("../remote-browser", () => {
  return {
    RemoteBrowser: jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
      getMetrics: jest
        .fn()
        .mockReturnValue({ deviceWidth: 800, deviceHeight: 600 }),
    })),
  };
});

describe("session controller", () => {
  const baseOpts = {
    app: {} as any,
    server: {} as any,
    token: "",
    url: "http://example.com",
    width: 1,
    height: 1,
    headful: false,
    quality: 1,
    fps: 1,
    isolate: false,
  };
  const wsSend = jest.fn();
  const broadcast = jest.fn();

  it("shares browser when isolate false", () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const a = ctrl.get({} as WebSocket);
    const b = ctrl.get({} as WebSocket);
    expect(a.rb).toBe(b.rb);
  });

  it("isolates browsers when isolate true", () => {
    const ctrl = createSessionController({
      ...baseOpts,
      isolate: true,
      wsSend,
      broadcast,
    });
    const ws1 = {} as WebSocket;
    const ws2 = {} as WebSocket;
    const a = ctrl.get(ws1);
    const b = ctrl.get(ws2);
    expect(a.rb).not.toBe(b.rb);
  });
});

