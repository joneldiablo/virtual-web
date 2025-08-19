/* eslint-disable no-console */
import { RemoteBrowser } from "./remote-browser";

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

/** Mouse via Puppeteer page.mouse.* */
export async function injectMousePptr(
  rb: RemoteBrowser,
  p: MousePayload
): Promise<true> {
  try {
    const page = rb.getPage();
    const { x, y } = rb.mapClientToDevtools(
      p.x,
      p.y,
      p.canvasWidth,
      p.canvasHeight
    );

    // move always (keeps cursor logical position in sync)
    await page.mouse.move(x, y);

    if (p.type === "move") return true;

    const button = p.button ?? "left";
    if (p.type === "down") {
      await page.mouse.down({
        button,
        clickCount: p.clickCount && p.clickCount > 1 ? p.clickCount : 1,
      });
      return true;
    }
    // up
    await page.mouse.up({
      button,
      clickCount: p.clickCount && p.clickCount > 1 ? p.clickCount : 1,
    });
    return true;
  } catch (error) {
    console.error(error);
    throw new Error("PPTR_MOUSE_FAIL");
  }
}

export async function injectWheelPptr(
  rb: RemoteBrowser,
  p: WheelPayload
): Promise<true> {
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
  } catch (error) {
    console.error(error);
    throw new Error("PPTR_WHEEL_FAIL");
  }
}
