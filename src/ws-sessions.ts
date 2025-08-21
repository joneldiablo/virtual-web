/* eslint-disable no-console */
import type { WebSocket } from "ws";
import { RemoteBrowser } from "./remote-browser";
import type { CreateWsServerOptions } from "./types";

/**
 * Data associated with a WebSocket session.
 */
export interface SessionData {
  rb: RemoteBrowser;
  ensureRemoteBrowser: () => Promise<true>;
  lastFrameRef: { value: string | null };
  getMetrics: () => { deviceWidth: number; deviceHeight: number };
}

/** Controller that manages {@link RemoteBrowser} instances per WebSocket. */
export interface SessionController {
  /** Obtain session data for a given socket. */
  get: (ws?: WebSocket) => SessionData;
  /** Remove and stop the browser for the given socket. */
  remove: (ws: WebSocket) => Promise<void>;
  /** Stop all managed browsers. */
  stopAll: () => Promise<void>;
}

/**
 * Create a controller that manages browser instances for WebSocket sessions.
 * When `isolate` is false a single browser is shared. If true each connection
 * gets its own browser.
 *
 * @example
 * ```ts
 * const ctrl = createSessionController({
 *   ...opts,
 *   wsSend: (ws, msg) => ws.send(JSON.stringify(msg)),
 *   broadcast: (msg) => console.log(msg),
 * });
 * const session = ctrl.get(socket);
 * await session.ensureRemoteBrowser();
 * ```
 */
export function createSessionController(
  opts: CreateWsServerOptions & {
    wsSend: (ws: WebSocket, msg: any) => void;
    broadcast: (msg: any) => void;
  }
): SessionController {
  const sessions = new Map<WebSocket, SessionData>();

  const sharedRb = new RemoteBrowser();
  let sharedStartP: Promise<true> | null = null;
  const sharedLast = { value: null as string | null };

  const sharedData: SessionData = {
    rb: sharedRb,
    ensureRemoteBrowser: () => {
      if (sharedStartP) return sharedStartP;
      sharedStartP = sharedRb
        .start({
          url: opts.url,
          width: opts.width,
          height: opts.height,
          headful: opts.headful,
          quality: opts.quality,
          fps: opts.fps,
          onFrame: (base64) => {
            sharedLast.value = base64;
            opts.broadcast({ type: "frame", payload: base64 });
          },
          onClipboard: (ev) =>
            opts.broadcast({
              type: "clipboard",
              payload: { action: ev.action, text: ev.text || "" },
            }),
          isolate: opts.isolate,
        })
        .then((r) => {
          console.log("[vwb] RemoteBrowser started");
          return r;
        })
        .catch((e) => {
          sharedStartP = null;
          throw e;
        });
      return sharedStartP;
    },
    lastFrameRef: sharedLast,
    getMetrics: () => {
      try {
        const m = (sharedRb as any).getMetrics?.();
        if (m && m.deviceWidth && m.deviceHeight) return m;
      } catch {}
      return { deviceWidth: opts.width, deviceHeight: opts.height };
    },
  };

  const get = (ws?: WebSocket): SessionData => {
    if (!opts.isolate) return sharedData;
    let s = ws ? sessions.get(ws) : undefined;
    if (!s) {
      const rb = new RemoteBrowser();
      let startP: Promise<true> | null = null;
      const last = { value: null as string | null };
      s = {
        rb,
        ensureRemoteBrowser: () => {
          if (startP) return startP;
          startP = rb
            .start({
              url: opts.url,
              width: opts.width,
              height: opts.height,
              headful: opts.headful,
              quality: opts.quality,
              fps: opts.fps,
              onFrame: (base64) => {
                last.value = base64;
                if (ws) opts.wsSend(ws, { type: "frame", payload: base64 });
              },
              onClipboard: (ev) =>
                ws &&
                opts.wsSend(ws, {
                  type: "clipboard",
                  payload: { action: ev.action, text: ev.text || "" },
                }),
              isolate: opts.isolate,
            })
            .then((r) => {
              console.log("[vwb] RemoteBrowser started");
              return r;
            })
            .catch((e) => {
              startP = null;
              throw e;
            });
          return startP;
        },
        lastFrameRef: last,
        getMetrics: () => {
          try {
            const m = (rb as any).getMetrics?.();
            if (m && m.deviceWidth && m.deviceHeight) return m;
          } catch {}
          return { deviceWidth: opts.width, deviceHeight: opts.height };
        },
      };
      if (ws) sessions.set(ws, s);
    }
    return s;
  };

  const remove = async (ws: WebSocket): Promise<void> => {
    if (!opts.isolate) return;
    const s = sessions.get(ws);
    if (s) {
      try {
        await s.rb.stop();
      } catch {}
      sessions.delete(ws);
    }
  };

  const stopAll = async (): Promise<void> => {
    if (opts.isolate) {
      for (const s of sessions.values()) {
        try {
          await s.rb.stop();
        } catch {}
      }
      sessions.clear();
    } else if (sharedStartP) {
      try {
        await sharedRb.stop();
      } catch {}
      sharedStartP = null;
    }
  };

  return { get, remove, stopAll };
}
