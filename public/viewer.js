export class FrameRenderer {
  constructor(options) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.useBitmap = options.useBitmap ?? true;
    this.smoothing = options.smoothing ?? true;

    this.buffer = document.createElement("canvas");
    this.bctx = this.buffer.getContext("2d", { alpha: false });

    this.ctx.imageSmoothingEnabled = this.smoothing;
    this.bctx.imageSmoothingEnabled = this.smoothing;

    this.iw = 0;
    this.ih = 0;
    this.layout = { dx: 0, dy: 0, dw: 0, dh: 0, cw: 0, ch: 0, iw: 0, ih: 0 };

    this.fit();
    addEventListener("resize", () => this.fit(), { passive: true });
  }

  fit() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth && clientHeight) {
      this.canvas.width = clientWidth;
      this.canvas.height = clientHeight;
      this.buffer.width = clientWidth;
      this.buffer.height = clientHeight;
    }
  }

  drawContained(ctx, img, iw, ih) {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ir = iw / ih;
    const cr = cw / ch;

    let dw = cw,
      dh = ch,
      dx = 0,
      dy = 0;
    if (ir > cr) {
      dw = cw;
      dh = Math.round(cw / ir);
      dy = Math.floor((ch - dh) / 2);
    } else {
      dh = ch;
      dw = Math.round(ch * ir);
      dx = Math.floor((cw - dw) / 2);
    }

    this.bctx.fillStyle = "#111";
    this.bctx.fillRect(0, 0, cw, ch);
    this.bctx.drawImage(img, 0, 0, iw, ih, dx, dy, dw, dh);
    ctx.drawImage(this.buffer, 0, 0);

    // Guarda layout del área de imagen
    this.layout = { dx, dy, dw, dh, cw, ch, iw, ih };
  }

  async render(payload) {
    try {
      let blob;
      if (typeof payload === "string") {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: "image/jpeg" });
      } else if (payload instanceof ArrayBuffer) {
        blob = new Blob([new Uint8Array(payload)], { type: "image/jpeg" });
      } else {
        blob = new Blob([payload], { type: "image/jpeg" });
      }

      if ("createImageBitmap" in window) {
        const bmp = await createImageBitmap(blob);
        this.iw = bmp.width;
        this.ih = bmp.height;
        this.drawContained(this.ctx, bmp, bmp.width, bmp.height);
        try {
          bmp.close && bmp.close();
        } catch {}
        return;
      }

      await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          this.iw = img.naturalWidth;
          this.ih = img.naturalHeight;
          this.drawContained(
            this.ctx,
            img,
            img.naturalWidth,
            img.naturalHeight
          );
          resolve();
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      });
    } catch (error) {
      console.error("[viewer] render error:", error);
    }
  }

  /** Returns the drawn image rectangle within the canvas (canvas pixel units). */
  getLayout() {
    const { dx, dy, dw, dh } = this.layout;
    return { x: dx, y: dy, width: dw, height: dh };
  }
}

export function attachFrameRenderer(canvas, options = {}) {
  const renderer = new FrameRenderer({ canvas, ...options });
  return {
    render: (payload) => renderer.render(payload),
    fit: () => renderer.fit(),
    getLayout: () => renderer.getLayout(),
  };
}
