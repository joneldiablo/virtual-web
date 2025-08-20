/**
 * Virtual Web Browser - Client (inputs + WS)
 * - Sends mouse/wheel/key events
 * - Handles clipboard sync (host ↔ remote) with de-dupe
 * - Requests an initial frame on connect
 *
 * Design:
 *  - We never send raw Ctrl/Cmd+V key events to the server.
 *  - On paste gesture (keydown or paste event), we read host clipboard and send:
 *      { type: "clipboard", payload: { action: "paste", text } }
 *  - Server will clear/set remote clipboard and perform a real paste (Ctrl/Cmd+V).
 *  - When remote copies/cuts, server broadcasts { type:"clipboard", action:"copy|cut", text }
 *    and we clear+write host clipboard (single source of truth).
 */

/* =========================================
 * Clipboard helpers (host-side)
 * =======================================*/

/**
 * Serialize clipboard ops to avoid races.
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
let __clipboardChain = Promise.resolve();
const enqueueClipboardOp = (fn) => {
  __clipboardChain = __clipboardChain.then(fn).catch(() => {});
  return __clipboardChain;
};

/**
 * Clear host clipboard (secure context or localhost).
 * @returns {Promise<boolean>}
 */
async function clearClipboard() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText("");
      return true;
    }
  } catch {}
  // Fallback: execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = "";
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
 * Write text to host clipboard.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function writeClipboardText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback: execCommand
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
 * Read text from host clipboard.
 * @returns {Promise<string|null>}
 */
async function readClipboardText() {
  try {
    if (navigator.clipboard?.readText) {
      const t = await navigator.clipboard.readText();
      return typeof t === "string" ? t : null;
    }
  } catch {}
  return null;
}

/* =========================================
 * Paste gesture gates (de-dup window)
 * =======================================*/

const PASTE_SUPPRESS_MS = 250;
let suppressPasteKeysUntil = 0;
let lastPasteSendAt = 0;

/** @returns {boolean} */
function inPasteWindow() {
  return performance.now() < suppressPasteKeysUntil;
}

/**
 * Handle paste gesture uniformly:
 * - Prevent default
 * - Debounce duplicated sources (keydown + paste event)
 * - Read host clipboard
 * - Clear host clipboard, then re-write the same (visual coherence)
 * - Send WS clipboard/paste message
 * @param {(obj:any)=>void} safeSend
 * @param {Event} [e]
 */
async function requestPasteFromHost(safeSend, e) {
  try {
    e && e.preventDefault();
  } catch {}
  const now = performance.now();
  if (now - lastPasteSendAt < 40) return; // re-entrant guard
  lastPasteSendAt = now;
  suppressPasteKeysUntil = now + PASTE_SUPPRESS_MS;

  const text = await readClipboardText();
  if (typeof text === "string") {
    await enqueueClipboardOp(async () => {
      await clearClipboard();
      await writeClipboardText(text);
    });
    safeSend({ type: "clipboard", payload: { action: "paste", text } });
  }
}

/* =========================================
 * Client attach
 * =======================================*/

/**
 * @typedef {Object} AttachClientOptions
 * @property {HTMLCanvasElement} canvas
 * @property {() => void} [onOpen]
 * @property {() => void} [onClose]
 * @property {() => void} [onError]
 * @property {(msg:any)=>void} [onMessage]
 * @property {(info:{direction:"in",action:"copy"|"cut",text:string})=>void} [onClipboard]
 * @property {string} [token]
 * @property {string} [wsUrl]
 * @property {() => {x:number,y:number,width:number,height:number}} [getLayout]
 */

/**
 * Attach client controls to a canvas and a WS server.
 * @param {AttachClientOptions} options
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

  /** Safe WS sender */
  const safeSend = (obj) => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    } catch {}
  };

  /** Mouse position relative to canvas client rect */
  const relPos = (evt) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, evt.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, evt.clientY - r.top));
    return { x, y, canvasWidth: r.width | 0, canvasHeight: r.height | 0 };
  };

  /** Normalize button number → "left" | "middle" | "right" */
  const normBtn = (b) => (b === 2 ? "right" : b === 1 ? "middle" : "left");

  const CID_KEY = "vwb_cid";
  function getStoredCid() {
    try {
      const v = sessionStorage.getItem(CID_KEY);
      const n = v ? parseInt(v, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }
  function setStoredCid(cid) {
    try {
      if (Number.isFinite(cid) && cid > 0)
        sessionStorage.setItem(CID_KEY, String(cid));
    } catch {}
  }

  /** Connect WS with auto-retry and initial hello/requestFrame */
  const connect = () => {
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        options.onOpen && options.onOpen();

        // 1) enviar hello con tamaño de canvas + clientId si existe
        const r = canvas.getBoundingClientRect();
        const clientId = getStoredCid();
        safeSend({
          type: "hello",
          payload: {
            canvasWidth: r.width | 0,
            canvasHeight: r.height | 0,
            ...(clientId ? { clientId } : {}),
            ...(token ? { token } : {}),
          },
        });

        // 2) pedir frame inicial
        safeSend({ type: "requestFrame" });
      };

      ws.onmessage = async (event) => {
        try {
          const msg =
            typeof event.data === "string" ? JSON.parse(event.data) : undefined;

          // Guardar cid confirmado por el server
          if (
            msg &&
            msg.type === "hello" &&
            msg.payload &&
            typeof msg.payload.cid === "number"
          ) {
            setStoredCid(msg.payload.cid);
            options.onHello && options.onHello(msg.payload); // opcional
            return;
          }

          if (msg && msg.type === "clipboard" && msg.payload) {
            const { action, text } = msg.payload || {};
            if (
              (action === "copy" || action === "cut") &&
              typeof text === "string"
            ) {
              await enqueueClipboardOp(async () => {
                await clearClipboard();
                await writeClipboardText(text);
              });
              options.onClipboard &&
                options.onClipboard({ direction: "in", action, text });
              return; // handled
            }
          }
        } catch {
          // not JSON → fall through to onMessage
        }

        // 2) Other messages (frames, hello, errors, etc.)
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

  /* ---------- Resize → backend viewport 1:1 ---------- */
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

  /* ---------- Mouse ---------- */
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

  /* ---------- Wheel ---------- */
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

  /* ---------- Keyboard (no raw paste combo to WS) ---------- */
  addEventListener("keydown", async (e) => {
    const isPasteCombo =
      (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
    if (isPasteCombo) {
      await requestPasteFromHost(safeSend, e);
      return; // do not send "key" for paste gesture
    }

    if (
      inPasteWindow() &&
      (e.key === "v" ||
        e.key === "V" ||
        e.key === "Control" ||
        e.key === "Meta")
    ) {
      e.preventDefault();
      return;
    }

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
    if (
      inPasteWindow() &&
      (e.key === "v" ||
        e.key === "V" ||
        e.key === "Control" ||
        e.key === "Meta")
    ) {
      e.preventDefault();
      return;
    }
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

  /* ---------- Paste event (menu / context click) ---------- */
  addEventListener(
    "paste",
    async (e) => {
      await requestPasteFromHost(safeSend, e);
    },
    { capture: true }
  );

  /* ---------- Public API ---------- */
  return {
    /**
     * Send an arbitrary message (e.g., {type:"ping"})
     * @param {any} obj
     */
    send: (obj) => safeSend(obj),
    /** Close WS connection */
    close: () => {
      try {
        ws && ws.close();
      } catch {}
    },
    /** Is WS open? */
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}
