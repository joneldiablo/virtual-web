/* eslint-disable no-console */
import type { RemoteBrowser } from "./remote-browser";
import type {
  MousePayload,
  MouseInjectPayload,
  WheelPayload,
} from "./types";

/**
 * Inject mouse events using DevTools coordinates computed from either the full
 * canvas (1:1) or a displayed image rectangle.
 *
 * @example
 * ```ts
 * await injectMousePptr(rb, {
 *   type: "click",
 *   x: 10,
 *   y: 10,
 *   canvasWidth: 800,
 *   canvasHeight: 600
 * });
 * ```
 */
export async function injectMousePptr(
  rb: RemoteBrowser,
  payload: MouseInjectPayload
): Promise<true> {
  try {
    const cdp = rb.getCDP();

    // Optional: ignore clicks that land in letterbox (outside the draw rect)
    if (
      payload.displayRect &&
      (payload.type === "down" ||
        payload.type === "up" ||
        payload.type === "click" ||
        payload.type === "dblclick")
    ) {
      const r = payload.displayRect;
      const inX = payload.x >= r.x && payload.x <= r.x + r.width;
      const inY = payload.y >= r.y && payload.y <= r.y + r.height;
      if (!inX || !inY) return true; // ignore clicks outside the video area
    }

    // Map coords
    const dev =
      payload.displayRect &&
      payload.displayRect.width &&
      payload.displayRect.height
        ? rb.mapFromDisplayRect(payload.x, payload.y, payload.displayRect)
        : rb.mapClientToDevtools(
            payload.x,
            payload.y,
            payload.canvasWidth,
            payload.canvasHeight
          );

    const typeMap: any = {
      move: "mouseMoved",
      down: "mousePressed",
      up: "mouseReleased",
    };
    const cdptype = typeMap[payload.type] || typeMap.move;

    const button = payload.button || "left";
    const buttons = payload.buttonsBits ?? 0;

    await cdp.send("Input.dispatchMouseEvent", {
      type: cdptype,
      x: dev.x,
      y: dev.y,
      button,
      buttons,
      clickCount: payload.type === "dblclick" ? 2 : 1,
    });

    return true;
  } catch (error) {
    console.error(error);
    throw new Error("MOUSE_INJECT_FAIL");
  }
}

/**
 * Inject a mouse wheel event into the remote page.
 *
 * @example
 * ```ts
 * await injectWheelPptr(rb, {
 *   deltaX: 0,
 *   deltaY: -120,
 *   x: 10,
 *   y: 10,
 *   canvasWidth: 800,
 *   canvasHeight: 600
 * });
 * ```
 */
export async function injectWheelPptr(
  rb: RemoteBrowser,
  p: WheelPayload
): Promise<boolean> {
  try {
    const page = rb.getPage();
    const { x, y } = rb.mapClientToDevtools(
      p.x,
      p.y,
      p.canvasWidth,
      p.canvasHeight
    );
    await page.mouse.move(x, y); // optional, helps target under cursor
    await page.mouse.wheel({ deltaX: p.deltaX, deltaY: p.deltaY });
    return true;
  } catch (e) {
    if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
    else console.error(e.message);
    return false;
  }
}
