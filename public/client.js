/**
 * Helper: write text to host clipboard, with secure & fallback paths.
 * @param {string} text
 */
async function writeClipboardText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback: hidden textarea + execCommand('copy')
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: read host clipboard (Ctrl/Cmd+V gesture/path). Works on https/localhost.
 * @returns {Promise<string|null>}
 */
async function readClipboardText() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const t = await navigator.clipboard.readText();
      return typeof t === "string" ? t : null;
    }
  } catch {}
  return null;
}

/**
 * @typedef {Object} AttachClientOptions
 * @property {HTMLCanvasElement} canvas
 * @property {() => void} [onOpen]
 * @property {() => void} [onClose]
 * @property {() => void} [onError]
 * @property {(msg:any)=>void} [onMessage]
 * @property {string} [token]
 * @property {string} [wsUrl]
 * @property {() => {x:number,y:number,width:number,height:number}} [getLayout]
 */

export function attachClient(options) {
  const canvas = options.canvas;
  const token = options.token || "";
  const wsUrl =
    options.wsUrl ||
    (location.protocol === "https:" ? "wss:" : "ws:") +
      "//" +
      location.host +
      "/ws";
  const getLayout =
    options.getLayout ||
    (() => ({
      x: 0,
      y: 0,
      width: canvas.clientWidth | 0,
      height: canvas.clientHeight | 0,
    }));
  let ws = null;
  let rafMove = 0;

  const safeSend = (obj) => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    } catch {}
  };
  const relPos = (evt) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, evt.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, evt.clientY - r.top));
    return { x, y, canvasWidth: r.width | 0, canvasHeight: r.height | 0 };
  };
  const normBtn = (b) => (b === 2 ? "right" : b === 1 ? "middle" : "left");

  const connect = () => {
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        options.onOpen && options.onOpen();
        const r = canvas.getBoundingClientRect();
        safeSend({
          type: "hello",
          payload: {
            canvasWidth: r.width | 0,
            canvasHeight: r.height | 0,
            ...(token ? { token } : {}),
          },
        });
        safeSend({ type: "requestFrame" });

        // ⬇️ También pedimos el clipboard remoto opcionalmente (no obligatorio)
        // safeSend({ type: "clipboard", payload: { action: "request" } });
      };

      ws.onmessage = async (event) => {
        // Intercept clipboard messages first
        try {
          const msg =
            typeof event.data === "string" ? JSON.parse(event.data) : undefined;
          if (msg && msg.type === "clipboard" && msg.payload) {
            const { action, text } = msg.payload || {};
            if (
              (action === "copy" || action === "cut") &&
              typeof text === "string"
            ) {
              await writeClipboardText(text);
              options.onClipboard &&
                options.onClipboard({ direction: "in", action, text });
              return; // handled
            }
          }
        } catch {
          // not JSON → seguirá al onMessage (frames)
        }
        // Deja pasar al handler principal (frames, etc.)
        try {
          options.onMessage && options.onMessage(event.data);
        } catch {}
      };

      ws.onclose = () => {
        options.onClose && options.onClose();
        setTimeout(connect, 1200);
      };

      ws.onerror = () => {
        options.onError && options.onError();
        try {
          ws && ws.close();
        } catch {}
      };
    } catch {
      options.onError && options.onError();
      setTimeout(connect, 1500);
    }
  };
  connect();

  // Resize → notifica backend para ajustar viewport (ya lo usas)
  let raf = 0;
  const sendResize = () => {
    const r = canvas.getBoundingClientRect();
    safeSend({
      type: "resize",
      payload: { canvasWidth: r.width | 0, canvasHeight: r.height | 0 },
    });
  };
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sendResize);
    });
    ro.observe(canvas);
  } else {
    addEventListener(
      "resize",
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(sendResize);
      },
      { passive: true }
    );
  }

  // Mouse
  const onMouse = (e, evType) => {
    const { x, y, canvasWidth, canvasHeight } = relPos(e);
    const displayRect = getLayout();
    const payload = {
      x: Math.round(x),
      y: Math.round(y),
      type: evType,
      button: evType !== "move" ? normBtn(e.button) : undefined,
      buttons: {
        left: !!(e.buttons & 1),
        right: !!(e.buttons & 2),
        middle: !!(e.buttons & 4),
      },
      buttonsBits: e.buttons | 0,
      canvasWidth,
      canvasHeight,
      displayRect,
    };
    safeSend({ type: "mouse", payload });
  };
  const onMouseMove = (e) => {
    if (rafMove) return;
    rafMove = requestAnimationFrame(() => {
      rafMove = 0;
      onMouse(e, "move");
    });
  };
  canvas.addEventListener("mousedown", (e) => onMouse(e, "down"));
  canvas.addEventListener("mouseup", (e) => onMouse(e, "up"));
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Wheel
  canvas.addEventListener(
    "wheel",
    (e) => {
      const { x, y, canvasWidth, canvasHeight } = relPos(e);
      const displayRect = getLayout();
      safeSend({
        type: "wheel",
        payload: {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          x: Math.round(x),
          y: Math.round(y),
          canvasWidth,
          canvasHeight,
          displayRect,
        },
      });
      e.preventDefault();
    },
    { passive: false }
  );

  // Keyboard (ya lo tienes separado)
  addEventListener("keydown", (e) => {
    safeSend({
      type: "key",
      payload: {
        type: "down",
        key: e.key,
        code: e.code,
        repeat: !!e.repeat,
        ctrl: !!e.ctrlKey,
        alt: !!e.altKey,
        shift: !!e.shiftKey,
        meta: !!e.metaKey,
      },
    });
    if (
      e.ctrlKey ||
      e.metaKey ||
      [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Tab",
        "F5",
        "F12",
      ].includes(e.key)
    )
      e.preventDefault();
  });
  addEventListener("keyup", (e) => {
    safeSend({
      type: "key",
      payload: {
        type: "up",
        key: e.key,
        code: e.code,
        ctrl: !!e.ctrlKey,
        alt: !!e.altKey,
        shift: !!e.shiftKey,
        meta: !!e.metaKey,
      },
    });
    if (
      e.ctrlKey ||
      e.metaKey ||
      [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Tab",
        "F5",
        "F12",
      ].includes(e.key)
    )
      e.preventDefault();
  });

  window.addEventListener("keydown", async (e) => {
    const isPasteCombo =
      (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
    if (isPasteCombo) {
      try {
        const text = await readClipboardText();
        if (text) {
          safeSend({ type: "clipboard", payload: { action: "paste", text } });
          e.preventDefault();
        }
      } catch {}
    }
  });

  return {
    send: (obj) => safeSend(obj),
    close: () => {
      try {
        ws && ws.close();
      } catch {}
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}
