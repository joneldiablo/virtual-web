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

  beforeEach(() => {
    wsSend.mockClear();
    broadcast.mockClear();
  });

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

  it("broadcasts frame and clipboard events", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const session = ctrl.get();
    await session.ensureRemoteBrowser();
    const opts = (session.rb.start as jest.Mock).mock.calls[0][0];
    opts.onFrame("img");
    opts.onClipboard({ action: "copy", text: "t" });
    expect(broadcast).toHaveBeenCalledWith({ type: "frame", payload: "img" });
    expect(broadcast).toHaveBeenCalledWith({
      type: "clipboard",
      payload: { action: "copy", text: "t" },
    });
  });

  it("falls back to default metrics", () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const session = ctrl.get();
    (session.rb.getMetrics as jest.Mock).mockReturnValueOnce(undefined);
    expect(session.getMetrics()).toEqual({ deviceWidth: 1, deviceHeight: 1 });
  });

  it("starts browser only once", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const session = ctrl.get({} as WebSocket);
    await session.ensureRemoteBrowser();
    await session.ensureRemoteBrowser();
    expect(session.rb.start).toHaveBeenCalledTimes(1);
  });

  it("retries start after failure", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const session = ctrl.get();
    (session.rb.start as jest.Mock)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(true);
    await expect(session.ensureRemoteBrowser()).rejects.toThrow("fail");
    await session.ensureRemoteBrowser();
    expect(session.rb.start).toHaveBeenCalledTimes(2);
  });

  it("removes and stops isolated sessions", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      isolate: true,
      wsSend,
      broadcast,
    });
    const ws1 = {} as WebSocket;
    const s = ctrl.get(ws1);
    await ctrl.remove(ws1);
    expect(s.rb.stop).toHaveBeenCalled();
  });

  it("isolated session sends events to its socket", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      isolate: true,
      wsSend,
      broadcast,
    });
    const ws1 = {} as WebSocket;
    const session = ctrl.get(ws1);
    await session.ensureRemoteBrowser();
    const opts = (session.rb.start as jest.Mock).mock.calls[0][0];
    opts.onFrame("snap");
    opts.onClipboard({ action: "cut", text: "x" });
    expect(wsSend).toHaveBeenCalledWith(ws1, {
      type: "frame",
      payload: "snap",
    });
    expect(wsSend).toHaveBeenCalledWith(ws1, {
      type: "clipboard",
      payload: { action: "cut", text: "x" },
    });
    (session.rb.getMetrics as jest.Mock).mockReturnValueOnce(null);
    expect(session.getMetrics()).toEqual({ deviceWidth: 1, deviceHeight: 1 });
  });

  it("retries isolated start after failure", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      isolate: true,
      wsSend,
      broadcast,
    });
    const ws1 = {} as WebSocket;
    const session = ctrl.get(ws1);
    (session.rb.start as jest.Mock)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    await expect(session.ensureRemoteBrowser()).rejects.toThrow("boom");
    await session.ensureRemoteBrowser();
    expect(session.rb.start).toHaveBeenCalledTimes(2);
  });

  it("stops all shared browsers", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      wsSend,
      broadcast,
    });
    const session = ctrl.get();
    await session.ensureRemoteBrowser();
    await ctrl.stopAll();
    expect(session.rb.stop).toHaveBeenCalled();
  });

  it("stops all isolated browsers", async () => {
    const ctrl = createSessionController({
      ...baseOpts,
      isolate: true,
      wsSend,
      broadcast,
    });
    const ws1 = {} as WebSocket;
    const ws2 = {} as WebSocket;
    const s1 = ctrl.get(ws1);
    const s2 = ctrl.get(ws2);
    await ctrl.stopAll();
    expect(s1.rb.stop).toHaveBeenCalled();
    expect(s2.rb.stop).toHaveBeenCalled();
  });
});

