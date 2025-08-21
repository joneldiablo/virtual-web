import { createMultiFlow } from "../ws-multi";

jest.mock("../mouse", () => ({
  injectMousePptr: jest.fn().mockResolvedValue(true),
  injectWheelPptr: jest.fn().mockResolvedValue(true),
}));
jest.mock("../keyboard", () => ({ injectKeyPptr: jest.fn().mockResolvedValue(true) }));
jest.mock("../clipboard", () => ({ pasteText: jest.fn().mockResolvedValue(true) }));

describe("createMultiFlow", () => {
  it("passes the correct client id to ensureRemoteBrowser", async () => {
    const rb = {
      resizeViewport: jest.fn(),
      captureFrame: jest.fn(),
      mapClientToDevtools: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      mapFromDisplayRect: jest.fn().mockReturnValue({ x: 0, y: 0 }),
    } as any;
    const ensureRemoteBrowser = jest.fn();
    const clients = new Map<any, { cid: number }>();
    const wsSend = jest.fn();
    const broadcast = jest.fn();
    const lastFrameRef = new Map<number, string | null>();
    const getMetrics = jest
      .fn()
      .mockReturnValue({ deviceWidth: 800, deviceHeight: 600 });

    const flow = createMultiFlow({
      opts: {} as any,
      rb,
      ensureRemoteBrowser,
      clients,
      wsSend,
      broadcast,
      lastFrameRef,
      getMetrics,
    });

    const ws1 = {} as any;
    const ws2 = {} as any;
    clients.set(ws1, { cid: 1 });
    clients.set(ws2, { cid: 2 });

    await flow.onMessage(ws1 as any, 1, {
      type: "mouse",
      payload: { x: 0, y: 0, canvasWidth: 1, canvasHeight: 1 },
    });
    expect(ensureRemoteBrowser).toHaveBeenCalledWith(1, ws1);

    await flow.onMessage(ws2 as any, 2, {
      type: "mouse",
      payload: { x: 0, y: 0, canvasWidth: 1, canvasHeight: 1 },
    });
    expect(ensureRemoteBrowser).toHaveBeenCalledWith(2, ws2);
  });
});
