/**
 * Cursor overlay renderer (draws all clients' cursors over the canvas).
 * Converts DevTools coordinates → local canvas draw rect using getLayout().
 */
export class CursorOverlay {
  /**
   * @param {{canvas: HTMLCanvasElement, getLayout: () => {x:number,y:number,width:number,height:number}}} opts
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.getLayout = opts.getLayout;
    this.deviceWidth = 1280;
    this.deviceHeight = 720;

    // Create overlay above canvas
    this.overlay = document.createElement("div");
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "0";
    this.overlay.style.top = "0";
    this.overlay.style.pointerEvents = "none";
    this.overlay.style.width = "100%";
    this.overlay.style.height = "100%";
    this.overlay.style.zIndex = "10";

    const parent = this.canvas.parentElement || document.body;
    if (!/relative|absolute|fixed/i.test(getComputedStyle(parent).position)) {
      parent.style.position = "relative";
    }
    parent.appendChild(this.overlay);

    this.cursors = new Map(); // cid -> {el, timer}
    this.palette = [
      "#ff5555",
      "#55ff55",
      "#5599ff",
      "#ffcc00",
      "#ff66cc",
      "#66ffff",
      "#bbbbbb",
      "#ffaa33",
    ];

    addEventListener("resize", () => this.requestLayout(), { passive: true });
  }

  /** Update remote device metrics for mapping */
  setDeviceMetrics(dw, dh) {
    if (dw > 0 && dh > 0) {
      this.deviceWidth = dw | 0;
      this.deviceHeight = dh | 0;
    }
  }

  requestLayout() {
    /* no-op, overlay is absolute */
  }

  /** Ensure element for a cid */
  ensureCursor(cid) {
    let rec = this.cursors.get(cid);
    if (rec) return rec;

    const color = this.palette[(cid - 1) % this.palette.length];
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "0";
    container.style.top = "0";
    container.style.opacity = "0";

    container.innerHTML = `
      <div style="
        position:absolute; transform: translate(-50%,-50%);
        width:14px;height:14px;border-radius:50%;
        border:2px solid ${color}; background: rgba(0,0,0,.35); backdrop-filter: blur(2px);
        box-shadow: 0 0 0 2px rgba(0,0,0,.2);
        transition: background .12s ease, opacity .2s ease;
      "></div>
      <span style="
        position:absolute; transform: translate(8px, -12px);
        font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu;
        color: ${color}; text-shadow: 0 1px 0 rgba(0,0,0,.6);
        background: rgba(0,0,0,.3); padding:2px 6px; border-radius: 6px;
        user-select: none;
      ">${cid}</span>
    `;
    this.overlay.appendChild(container);
    rec = { el: container, timer: null };
    this.cursors.set(cid, rec);
    return rec;
  }

  /** Convert DevTools coords → local canvas pixel coordinates inside draw rect */
  devtoolsToCanvas(x, y) {
    const rect = this.getLayout?.() || {
      x: 0,
      y: 0,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
    const nx = Math.max(0, Math.min(1, x / Math.max(1, this.deviceWidth)));
    const ny = Math.max(0, Math.min(1, y / Math.max(1, this.deviceHeight)));
    return {
      cx: rect.x + nx * rect.width,
      cy: rect.y + ny * rect.height,
    };
  }

  /** Update cursor position from DevTools coords; fade out after idle */
  update({ cid, x, y, down }) {
    if (typeof cid !== "number") return;
    const rec = this.ensureCursor(cid);
    const { cx, cy } = this.devtoolsToCanvas(x, y);

    rec.el.style.transform = `translate(${cx}px, ${cy}px)`;
    rec.el.style.opacity = "1";
    const dot = rec.el.firstElementChild;
    if (dot)
      dot.style.background = down ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)";

    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      rec.el.style.opacity = "0";
    }, 1500);
  }

  /** Remove a cursor */
  remove(cid) {
    const rec = this.cursors.get(cid);
    if (!rec) return;
    if (rec.timer) clearTimeout(rec.timer);
    rec.el.remove();
    this.cursors.delete(cid);
  }
}
