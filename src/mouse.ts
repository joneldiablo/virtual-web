/* eslint-disable no-console */
import type { RemoteBrowser } from "./remote-browser";

export interface MousePayload {
  x: number;
  y: number;
  type: "down" | "up" | "move";
  button?: "left" | "right" | "middle";
  clickCount?: number;
  canvasWidth: number;
  canvasHeight: number;
}
export interface WheelPayload {
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Inject mouse events using DevTools coordinates computed
 * from either full canvas (1:1) or the drawn image rect (letterboxed).
 * @param rb
 * @param payload
 */
export async function injectMousePptr(
  rb: RemoteBrowser,
  payload: {
    type: "move" | "down" | "up" | "click" | "dblclick";
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    buttonsBits?: number;
    canvasWidth: number;
    canvasHeight: number;
    displayRect?: { x: number; y: number; width: number; height: number };
  }
): Promise<true> {
  try {
    const cdp = rb.getCDP();

    // Optional: ignore clicks that land in letterbox (fuera del draw rect)
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
