import { createSingleFlow } from "../ws-single";

jest.mock("../mouse", () => ({
  injectMousePptr: jest.fn().mockResolvedValue(true),
  injectWheelPptr: jest.fn().mockResolvedValue(true),
}));
jest.mock("../keyboard", () => ({
  injectKeyPptr: jest.fn().mockResolvedValue(true),
}));
jest.mock("../clipboard", () => ({
  pasteText: jest.fn().mockResolvedValue(true),
}));

describe("createSingleFlow", () => {
  it("passes the correct client id to ensureRemoteBrowser", async () => {
    const rb = {
      resizeViewport: jest.fn(),
      captureFrame: jest.fn(),
    } as any;
    const ensureRemoteBrowser = jest.fn();
    const clients = new Map<any, { cid: number }>();
    const wsSend = jest.fn();
    const broadcast = jest.fn();
    const lastFrameRef = new Map<number, string | null>();
    const getMetrics = jest
      .fn()
      .mockReturnValue({ deviceWidth: 800, deviceHeight: 600 });

    const flow = createSingleFlow({
      opts: {} as any,
      rb,
      ensureRemoteBrowser,
      clients,
      wsSend,
      broadcast,
      lastFrameRef,
      getMetrics,
    });

    const ws = {} as any;
    clients.set(ws, { cid: 1 });

    await flow.onMessage(ws as any, 1, {
      type: "mouse",
      payload: { x: 0, y: 0, canvasWidth: 1, canvasHeight: 1 },
    });
    expect(ensureRemoteBrowser).toHaveBeenCalledWith(1, ws);
  });
});

