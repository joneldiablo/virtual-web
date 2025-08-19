/* eslint-disable no-console */
import puppeteer, { Browser, Page } from "puppeteer";

export interface RemoteBrowserStartOptions {
  url: string;
  width: number;
  height: number;
  headful: boolean;
  quality: number;
  fps: number;
  onFrame: (base64: string) => void;
}

/**
 * Minimal RemoteBrowser: starts/stops Chromium, streams frames and exposes CDP + mapper.
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
        } catch (err) {
          console.error("[rb] frame error:", err);
        }
      });

      this.running = true;
      return true;
    } catch (error) {
      console.error(error);
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
    } catch (error) {
      console.error(error);
      throw new Error("RB_STOP_FAIL");
    }
  }

  async goto(url: string): Promise<true> {
    try {
      if (!this.page) throw new Error("NO_PAGE");
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      return true;
    } catch (error) {
      console.error(error);
      throw new Error("RB_GOTO_FAIL");
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
  async resizeViewport(width: number, height: number): Promise<true> {
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
    } catch (error) {
      console.error(error);
      throw new Error("RB_RESIZE_FAIL");
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
    } catch (error) {
      console.error(error);
      throw new Error("RB_CAPTURE_FAIL");
    }
  }
}
