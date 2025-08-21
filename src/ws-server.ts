/* eslint-disable no-console */
import type { Application } from "express";
import type { Server } from "http";
import expressWs, {
  Application as WsApplication,
  WebsocketRequestHandler,
} from "express-ws";
import type { WebSocket } from "ws";

import { RemoteBrowser } from "./remote-browser";
import { createSingleFlow } from "./ws-single";
import { createMultiFlow } from "./ws-multi";
import type {
  CreateWsServerOptions,
  Flow,
  FlowContext,
  WsServerController,
} from "./types";

/**
 * Create a WebSocket server that proxies input to a {@link RemoteBrowser} and
 * broadcasts frames to connected clients. The server automatically switches
 * between single-client and multi-client flows.
 *
 * @example
 * ```ts
 * const ctrl = createWsServer({ app, server, url, width, height, headful:false, quality:60, fps:30 });
 * // later
 * await ctrl.stop();
 * ```
 */
export function createWsServer(
  opts: CreateWsServerOptions
): WsServerController {
  const { app, server, token = "" } = opts;
  const { app: wsApp } = expressWs(app as WsApplication, server);

  // --- clients registry ---
  const clients = new Map<WebSocket, { cid: number }>();
  let nextCid = 1;

  // --- RB + frame cache ---
  const rb = new RemoteBrowser();
  let rbStartP: Promise<true> | null = null;
  const lastFrameRef = { value: null as string | null };

  // --- helpers ---
  const wsSend = (ws: WebSocket, msg: any) => {
    try {
      /* @ts-ignore */ if (ws.readyState === 1)
        ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
    } catch {}
  };
  const broadcast = (msg: any) => {
    const s = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const ws of clients.keys()) {
      try {
        /* @ts-ignore */ if (ws.readyState === 1) ws.send(s);
      } catch {}
    }
  };
  const ensureRemoteBrowser = (): Promise<true> => {
    if (rbStartP) return rbStartP;
    rbStartP = rb
      .start({
        url: opts.url,
        isolate: opts.isolate,
        width: opts.width,
        height: opts.height,
        headful: opts.headful,
        quality: opts.quality,
        fps: opts.fps,
        onFrame: (base64) => {
          lastFrameRef.value = base64;
          broadcast({ type: "frame", payload: base64 });
        },
        onClipboard: (ev) =>
          broadcast({
            type: "clipboard",
            payload: { action: ev.action, text: ev.text || "" },
          }),
      })
      .then((r) => {
        console.log("[vwb] RemoteBrowser started");
        return r;
      })
      .catch((e) => {
        rbStartP = null;
        throw e;
      });
    return rbStartP;
  };
  const getMetrics = () => {
    try {
      const m = (rb as any).getMetrics?.();
      if (m && m.deviceWidth && m.deviceHeight) return m;
    } catch {}
    return { deviceWidth: opts.width, deviceHeight: opts.height };
  };

  // --- auth ---
  const isAuthorized = (reqUrl?: string) => {
    try {
      if (!token) return true;
      const qs = new URLSearchParams(reqUrl?.split("?")[1] || "");
      return qs.get("token") === token;
    } catch {
      return false;
    }
  };

  // --- health ---
  app.get("/ws/health", (_req, res) => {
    try {
      res.json({ ok: true, clients: clients.size });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  // --- Flow switcher ---
  let flow: Flow = createSingleFlow({
    opts,
    rb,
    ensureRemoteBrowser,
    clients,
    wsSend,
    broadcast,
    lastFrameRef,
    getMetrics,
  });

  const recomputeFlow = () => {
    try {
      const want = opts.isolate
        ? "single"
        : clients.size > 1
        ? "multi"
        : "single";
      if (flow.name === want) return;
      flow =
        want === "multi"
          ? createMultiFlow({
              opts,
              rb,
              ensureRemoteBrowser,
              clients,
              wsSend,
              broadcast,
              lastFrameRef,
              getMetrics,
            })
          : createSingleFlow({
              opts,
              rb,
              ensureRemoteBrowser,
              clients,
              wsSend,
              broadcast,
              lastFrameRef,
              getMetrics,
            });
      flow.onSwitchIn();
    } catch (e) {
      console.error("[vwb] flow switch error:");
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
    }
  };

  // --- WS handler (delegates to flow) ---
  const wsHandler: WebsocketRequestHandler = (ws, req) => {
    if (!isAuthorized(req.url)) {
      wsSend(ws as any, {
        type: "error",
        payload: { code: "AUTH_FAIL", message: "Unauthorized" },
      });
      try {
        /* @ts-ignore */ ws.close(1008, "Unauthorized");
      } catch {}
      return;
    }

    const cid = nextCid++;
    clients.set(ws as unknown as WebSocket, { cid });
    recomputeFlow();

    // delegate
    try {
      flow.onConnect(ws as any, cid);
    } catch {}

    // route messages
    ws.on("message", async (raw) => {
      try {
        const s = typeof raw === "string" ? raw : raw.toString();
        const msg = JSON.parse(s);
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
          return;
        await flow.onMessage(ws as any, cid, msg);
      } catch {
        wsSend(ws as any, {
          type: "error",
          payload: { code: "BAD_MSG", message: "Invalid message" },
        });
      }
    });

    ws.on("close", () => {
      clients.delete(ws as unknown as WebSocket);
      recomputeFlow();
      try {
        flow.onDisconnect(ws as any, cid);
      } catch {}
    });

    ws.on("error", () => {
      clients.delete(ws as unknown as WebSocket);
      try {
        /* @ts-ignore */ ws.close();
      } catch {}
      recomputeFlow();
      try {
        flow.onDisconnect(ws as any, cid);
      } catch {}
    });
  };

  (wsApp as unknown as WsApplication).ws("/ws", wsHandler);
  console.log("[vwb] WS mounted at /ws (health at /ws/health)");

  const stop = async () => {
    try {
      for (const ws of clients.keys()) {
        try {
          /* @ts-ignore */ ws.close();
        } catch {}
      }
      clients.clear();
      try {
        if (rbStartP) await rb.stop();
      } catch {}
      rbStartP = null;
      console.log("[vwb] WS server stopped");
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("WS_STOP_FAIL");
    }
  };

  return { stop };
}
