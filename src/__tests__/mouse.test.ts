import { injectMousePptr, injectWheelPptr } from "../mouse";
import type { MouseInjectPayload, WheelPayload } from "../types";

describe("injectMousePptr", () => {
  it("maps coordinates without displayRect", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const rb: any = {
      getCDP: () => ({ send }),
      mapClientToDevtools: jest.fn().mockReturnValue({ x: 5, y: 7 }),
      mapFromDisplayRect: jest.fn(),
    };

    const payload: MouseInjectPayload = {
      type: "move",
      x: 1,
      y: 2,
      canvasWidth: 100,
      canvasHeight: 100,
    };

    await injectMousePptr(rb, payload);

    expect(rb.mapClientToDevtools).toHaveBeenCalledWith(1, 2, 100, 100);
    expect(send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ x: 5, y: 7 })
    );
  });

  it("maps coordinates using displayRect", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const rb: any = {
      getCDP: () => ({ send }),
      mapClientToDevtools: jest.fn(),
      mapFromDisplayRect: jest.fn().mockReturnValue({ x: 20, y: 30 }),
    };

    const payload: MouseInjectPayload = {
      type: "down",
      x: 10,
      y: 10,
      canvasWidth: 100,
      canvasHeight: 100,
      displayRect: { x: 0, y: 0, width: 50, height: 50 },
    };

    await injectMousePptr(rb, payload);

    expect(rb.mapFromDisplayRect).toHaveBeenCalledWith(
      10,
      10,
      payload.displayRect
    );
    expect(send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ x: 20, y: 30 })
    );
  });

  it("ignores clicks outside displayRect", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const rb: any = {
      getCDP: () => ({ send }),
      mapClientToDevtools: jest.fn(),
      mapFromDisplayRect: jest.fn(),
    };

    const payload: MouseInjectPayload = {
      type: "click",
      x: 100,
      y: 100,
      canvasWidth: 200,
      canvasHeight: 200,
      displayRect: { x: 0, y: 0, width: 50, height: 50 },
    };

    await injectMousePptr(rb, payload);

    expect(send).not.toHaveBeenCalled();
  });

  it("throws when CDP send fails", async () => {
    const send = jest.fn().mockRejectedValue(new Error("fail"));
    const rb: any = {
      getCDP: () => ({ send }),
      mapClientToDevtools: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      mapFromDisplayRect: jest.fn(),
    };
    const payload: MouseInjectPayload = {
      type: "move",
      x: 0,
      y: 0,
      canvasWidth: 1,
      canvasHeight: 1,
    };
    await expect(injectMousePptr(rb, payload)).rejects.toThrow(
      "MOUSE_INJECT_FAIL"
    );
  });
});

describe("injectWheelPptr", () => {
  it("sends wheel events", async () => {
    const move = jest.fn();
    const wheel = jest.fn();
    const rb: any = {
      getPage: () => ({ mouse: { move, wheel } }),
      mapClientToDevtools: jest.fn().mockReturnValue({ x: 1, y: 2 }),
    };
    const payload: WheelPayload = {
      deltaX: 0,
      deltaY: 100,
      x: 5,
      y: 6,
      canvasWidth: 10,
      canvasHeight: 10,
    };
    await expect(injectWheelPptr(rb, payload)).resolves.toBe(true);
    expect(move).toHaveBeenCalledWith(1, 2);
    expect(wheel).toHaveBeenCalledWith({ deltaX: 0, deltaY: 100 });
  });

  it("returns false on failure", async () => {
    const move = jest.fn().mockRejectedValue(new Error("boom"));
    const rb: any = {
      getPage: () => ({ mouse: { move, wheel: jest.fn() } }),
      mapClientToDevtools: jest.fn().mockReturnValue({ x: 1, y: 2 }),
    };
    const payload: WheelPayload = {
      deltaX: 0,
      deltaY: 0,
      x: 0,
      y: 0,
      canvasWidth: 1,
      canvasHeight: 1,
    };
    const prev = process.env.ENV;
    process.env.ENV = "PROD";
    await expect(injectWheelPptr(rb, payload)).resolves.toBe(false);
    process.env.ENV = prev;
  });
});
