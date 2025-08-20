/* eslint-disable no-console */
import puppeteer, { Browser, Page } from "puppeteer";
import type { RemoteBrowserStartOptions } from "./types";

/**
 * Minimal wrapper around Puppeteer that launches Chromium, streams frames and
 * exposes helper methods for input injection and coordinate mapping.
 *
 * @example
 * ```ts
 * const rb = new RemoteBrowser();
 * await rb.start({
 *   url: "https://example.com",
 *   width: 1280,
 *   height: 720,
 *   headful: false,
 *   quality: 60,
 *   fps: 30,
 *   onFrame: (img) => console.log(img.slice(0, 20)),
 * });
 * // ...
 * await rb.stop();
 * ```
 */
export class RemoteBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: any | null = null;
  private running = false;

  private deviceWidth = 1280;
  private deviceHeight = 720;
  private pageScale = 1;
  private jpegQuality = 60;

  private clipGranted = false; // track permissions

  async start(opts: RemoteBrowserStartOptions): Promise<true> {
    try {
      if (this.running) return true;

      this.jpegQuality = Math.max(1, Math.min(100, opts.quality));

      this.browser = await puppeteer.launch({
        headless: !opts.headful,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        defaultViewport: {
          width: opts.width,
          height: opts.height,
          deviceScaleFactor: 1,
        },
      });

      const ctx = await this.browser.createBrowserContext();
      this.page = await ctx.newPage();
      await this.page.goto(opts.url, { waitUntil: "domcontentloaded" });

      // CDP session + screencast
      this.cdp = await this.page.target().createCDPSession();
      await this.cdp.send("Page.enable");

      const everyNthFrame = Math.max(1, Math.round(60 / Math.max(1, opts.fps)));
      await this.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: this.jpegQuality,
        everyNthFrame,
      });

      this.cdp.on("Page.screencastFrame", async (evt: any) => {
        try {
          this.deviceWidth = evt?.metadata?.deviceWidth || this.deviceWidth;
          this.deviceHeight = evt?.metadata?.deviceHeight || this.deviceHeight;
          this.pageScale = evt?.metadata?.pageScaleFactor || this.pageScale;
          opts.onFrame(evt.data);
          await this.cdp!.send("Page.screencastFrameAck", {
            sessionId: evt.sessionId,
          });
        } catch (e) {
          console.error("[rb] frame error:");
          if (process.env.ENV !== "PROD" || !(e instanceof Error))
            console.error(e);
          else console.error(e.message);
        }
      });

      // Expose a bridge to send clipboard out to Node
      await this.page!.exposeFunction(
        "__vwbClipboardOut",
        (payload: { action: "copy" | "cut"; text: string }) => {
          try {
            opts.onClipboard && opts.onClipboard(payload);
          } catch {}
        }
      );

      // Attach listeners for current page and for all future docs
      const injectClipboardHooks = () => `
        (function(){
          function getSel() {
            try { return (window.getSelection && window.getSelection().toString()) || ""; } catch { return ""; }
            }
          function emit(action, text) {
            try { window.__vwbClipboardOut && window.__vwbClipboardOut({ action, text: text || "" }); } catch {}
          }
          document.addEventListener("copy", function(e){
            try {
              let txt = "";
              try { txt = e.clipboardData && e.clipboardData.getData("text/plain"); } catch {}
              if (!txt) txt = getSel();
              emit("copy", txt);
            } catch {}
          }, true);
          document.addEventListener("cut", function(e){
            try {
              let txt = "";
              try { txt = e.clipboardData && e.clipboardData.getData("text/plain"); } catch {}
              if (!txt) txt = getSel();
              emit("cut", txt);
            } catch {}
          }, true);
        })();
      `;

      await this.page!.evaluateOnNewDocument(injectClipboardHooks());
      try {
        await this.page!.evaluate(injectClipboardHooks());
      } catch {}

      // Optionally, hook frames as they navigate (best-effort same-origin)
      this.page!.on("framenavigated", async (frame) => {
        try {
          if (frame === this.page!.mainFrame()) return; // subframes only
          await frame.evaluate(injectClipboardHooks());
        } catch {}
      });

      this.running = true;
      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("RB_START_FAIL");
    }
  }

  async stop(): Promise<true> {
    try {
      this.running = false;
      try {
        if (this.cdp) {
          try {
            await this.cdp.send("Page.stopScreencast");
          } catch {}
          this.cdp = null;
        }
      } catch {}
      try {
        await this.browser?.close();
      } catch {}
      this.browser = null;
      this.page = null;
      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("RB_STOP_FAIL");
    }
  }

  async goto(url: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("NO_PAGE");
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      return false;
    }
  }

  /** Expose Puppeteer Page (throws if not ready). */
  getPage() {
    if (!this.page) throw new Error("NO_PAGE");
    return this.page;
  }

  /** Expose current CDP session (throws if not ready). */
  getCDP(): any {
    if (!this.cdp) throw new Error("NO_CDP");
    return this.cdp;
  }

  /** Map canvas coords → DevTools CSS coords using last device metrics. */
  mapClientToDevtools(x: number, y: number, canvasW: number, canvasH: number) {
    if (!canvasW || !canvasH) return { x: 0, y: 0 };
    const sx = this.deviceWidth / canvasW;
    const sy = this.deviceHeight / canvasH;
    let mx = Math.round(x * sx),
      my = Math.round(y * sy);
    if (mx < 0) mx = 0;
    if (my < 0) my = 0;
    if (mx > this.deviceWidth - 1) mx = this.deviceWidth - 1;
    if (my > this.deviceHeight - 1) my = this.deviceHeight - 1;
    return { x: mx, y: my };
  }

  /**
   * Resize Puppeteer viewport to match client canvas size (1:1 CSS px).
   * This avoids any letterbox/scaling math on the client.
   */
  async resizeViewport(width: number, height: number): Promise<boolean> {
    try {
      if (!this.page) throw new Error("NO_PAGE");
      // Guardrails
      const w = Math.max(320, Math.floor(width));
      const h = Math.max(240, Math.floor(height));

      // Skip if same size
      if (w === this.deviceWidth && h === this.deviceHeight) return true;

      await this.page.setViewport({
        width: w,
        height: h,
        deviceScaleFactor: 1,
      });

      // Proactively update local metrics (screencast metadata also updates)
      this.deviceWidth = w;
      this.deviceHeight = h;
      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      return false;
    }
  }

  async captureFrame(): Promise<string> {
    try {
      if (!this.cdp) throw new Error("NO_CDP");
      const { data } = await this.cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: this.jpegQuality,
        fromSurface: true,
      });
      return data as string; // base64 (no prefix)
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("RB_CAPTURE_FAIL");
    }
  }

  /**
   * Ensure clipboard permissions for current origin.
   * Uses Puppeteer overridePermissions (web-permissions strings).
   */
  async ensureClipboardPermissions(): Promise<boolean> {
    try {
      if (this.clipGranted) return true;
      if (!this.browser || !this.page) throw new Error("NO_PAGE");
      const ctx = this.browser.defaultBrowserContext();
      const origin = new URL(this.page.url()).origin;
      try {
        await ctx.overridePermissions(origin, [
          "clipboard-read",
          "clipboard-write",
          "clipboard-sanitized-write", // might be ignored in some versions
        ]);
      } catch {
        // fallback: at least read/write
        await ctx.overridePermissions(origin, [
          "clipboard-read",
          "clipboard-write",
        ]);
      }
      this.clipGranted = true;
      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      return false;
    }
  }

  /**
   * Clear and set remote clipboard to `text` using navigator.clipboard.
   * Avoids async/await inside page context to prevent __awaiter issues.
   */
  async setClipboardText(text: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("NO_PAGE");
      await this.ensureClipboardPermissions();

      // IMPORTANT: do not use "async" in the page function (TS would inject __awaiter).
      await this.page.evaluate((t: string) => {
        // Promise chain only; no async/await here
        return navigator.clipboard
          .writeText("") // clear first
          .catch(() => void 0) // ignore clear errors
          .then(() => navigator.clipboard.writeText(t || "")); // write new text
      }, text);

      return true;
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      return false;
    }
  }

  /**
   * Perform a real paste (Ctrl/Cmd+V) after ensuring the remote clipboard equals `text`.
   * Falls back to Input.insertText if something blocks clipboard write.
   */
  async pasteFromClipboard(text: string): Promise<true> {
    try {
      if (!this.page) throw new Error("NO_PAGE");
      try {
        await this.setClipboardText(text);
        const isMac = process.platform === "darwin";
        if (isMac) {
          await this.page.keyboard.down("Meta");
          await this.page.keyboard.press("v");
          await this.page.keyboard.up("Meta");
        } else {
          await this.page.keyboard.down("Control");
          await this.page.keyboard.press("v");
          await this.page.keyboard.up("Control");
        }
        return true;
      } catch (permOrWriteErr) {
        // Fallback: direct insert (won't fire paste handlers but avoids concatenation)
        try {
          await this.getCDP().send("Input.insertText", { text });
          return true;
        } catch (e) {
          if (process.env.ENV !== "PROD" || !(e instanceof Error))
            console.error(e);
          else console.error(e.message);
          throw new Error("RB_PASTE_FAIL");
        }
      }
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("RB_PASTE_FAIL");
    }
  }

  /**
   * Map from client canvas coordinates + drawn image rectangle
   * (letterboxed inside the canvas) → DevTools CSS coordinates.
   * Clamps to [0..deviceWidth-1], [0..deviceHeight-1].
   * @param {number} x
   * @param {number} y
   * @param {{x:number,y:number,width:number,height:number}} rect - draw rect inside canvas (from client)
   */
  mapFromDisplayRect(
    x: number,
    y: number,
    rect: { x: number; y: number; width: number; height: number }
  ): { x: number; y: number } {
    try {
      const rw = Math.max(1, rect?.width | 0);
      const rh = Math.max(1, rect?.height | 0);
      const rx = (x - (rect?.x || 0)) / rw;
      const ry = (y - (rect?.y || 0)) / rh;
      const nx = Math.max(0, Math.min(1, rx));
      const ny = Math.max(0, Math.min(1, ry));
      let mx = Math.round(nx * (this.deviceWidth - 1));
      let my = Math.round(ny * (this.deviceHeight - 1));
      if (mx < 0) mx = 0;
      if (my < 0) my = 0;
      if (mx > this.deviceWidth - 1) mx = this.deviceWidth - 1;
      if (my > this.deviceHeight - 1) my = this.deviceHeight - 1;
      return { x: mx, y: my };
    } catch {
      // Fallback: default scaling (shouldn't happen)
      return this.mapClientToDevtools(
        x,
        y,
        rect?.width || 1,
        rect?.height || 1
      );
    }
  }

  getMetrics() {
    return {
      deviceWidth: this.deviceWidth,
      deviceHeight: this.deviceHeight,
      pageScale: this.pageScale,
    };
  }
}
