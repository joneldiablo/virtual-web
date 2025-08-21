/* eslint-disable no-console */
import type { Application } from "express";
import type { Server } from "http";
import expressWs, {
  Application as WsApplication,
  WebsocketRequestHandler,
} from "express-ws";
import type { WebSocket } from "ws";

import { createSingleFlow } from "./ws-single";
import { createMultiFlow } from "./ws-multi";
import { createSessionController } from "./ws-sessions";
import type { CreateWsServerOptions, Flow, WsServerController } from "./types";

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

  const sessions = createSessionController({ ...opts, wsSend, broadcast });
  const sharedSession = sessions.get();
  const rb = sharedSession.rb;
  const ensureRemoteBrowser = sharedSession.ensureRemoteBrowser;
  const lastFrameRef = sharedSession.lastFrameRef;
  const getMetrics = sharedSession.getMetrics;

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
  let flow: Flow | null = null;
  if (!opts.isolate)
    flow = createSingleFlow({
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
    if (opts.isolate || !flow) return;
    try {
      const want = clients.size > 1 ? "multi" : "single";
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

    if (opts.isolate) {
      const session = sessions.get(ws as any);
      const localClients = new Map<WebSocket, { cid: number }>([
        [ws as any, { cid }],
      ]);
      const flowLocal = createSingleFlow({
        opts,
        rb: session.rb,
        ensureRemoteBrowser: session.ensureRemoteBrowser,
        clients: localClients,
        wsSend,
        broadcast: (msg: any) => wsSend(ws as any, msg),
        lastFrameRef: session.lastFrameRef,
        getMetrics: session.getMetrics,
      });
      flowLocal.onSwitchIn();

      ws.on("message", async (raw) => {
        try {
          const s = typeof raw === "string" ? raw : raw.toString();
          const msg = JSON.parse(s);
          if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
            return;
          await flowLocal.onMessage(ws as any, cid, msg);
        } catch {
          wsSend(ws as any, {
            type: "error",
            payload: { code: "BAD_MSG", message: "Invalid message" },
          });
        }
      });

      ws.on("close", () => {
        clients.delete(ws as unknown as WebSocket);
        sessions.remove(ws as any);
        try {
          flowLocal.onDisconnect(ws as any, cid);
        } catch {}
      });

      ws.on("error", () => {
        clients.delete(ws as unknown as WebSocket);
        try {
          /* @ts-ignore */ ws.close();
        } catch {}
        sessions.remove(ws as any);
        try {
          flowLocal.onDisconnect(ws as any, cid);
        } catch {}
      });
    } else {
      recomputeFlow();

      // delegate
      try {
        flow!.onConnect(ws as any, cid);
      } catch {}

      // route messages
      ws.on("message", async (raw) => {
        try {
          const s = typeof raw === "string" ? raw : raw.toString();
          const msg = JSON.parse(s);
          if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
            return;
          await flow!.onMessage(ws as any, cid, msg);
        } catch {
          wsSend(ws as any, {
            type: "error",
            payload: { code: "BAD_MSG", message: "Invalid message" },
          });
        }
      });

      ws.on("close", () => {
        clients.delete(ws as unknown as WebSocket);
        sessions.remove(ws as any);
        recomputeFlow();
        try {
          flow!.onDisconnect(ws as any, cid);
        } catch {}
      });

      ws.on("error", () => {
        clients.delete(ws as unknown as WebSocket);
        try {
          /* @ts-ignore */ ws.close();
        } catch {}
        sessions.remove(ws as any);
        recomputeFlow();
        try {
          flow!.onDisconnect(ws as any, cid);
        } catch {}
      });
    }
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
      await sessions.stopAll();
      console.log("[vwb] WS server stopped");
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
      throw new Error("WS_STOP_FAIL");
    }
  };

  return { stop };
}
