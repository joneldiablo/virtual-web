/* eslint-disable no-console */
import type { Application } from "express";
import type { Server } from "http";
import expressWs, {
  Application as WsApplication,
  WebsocketRequestHandler,
} from "express-ws";
import type { WebSocket } from "ws";

import { RemoteBrowser } from "./remote-browser";
import { injectMousePptr, injectWheelPptr } from "./mouse";
import { injectKeyPptr } from "./keyboard";
import { pasteText } from "./clipboard";

export interface WsServerController {
  stop: () => Promise<void>;
}
export interface CreateWsServerOptions {
  app: Application;
  server: Server;
  token?: string;
  url: string;
  width: number;
  height: number;
  headful: boolean;
  quality: number;
  fps: number;
}

export function createWsServer(
  opts: CreateWsServerOptions
): WsServerController {
  const { app, server, token = "" } = opts;
  const { app: wsApp } = expressWs(app as WsApplication, server);
  const clients = new Set<WebSocket>();

  const rb = new RemoteBrowser();
  let rbStartP: Promise<true> | null = null;

  // Cache last screencast frame for instant paint on new clients
  let lastFrameBase64: string | null = null;

  const broadcast = (msg: any) => {
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const c of clients) {
      try {
        if (c.readyState === 1) c.send(text);
      } catch {}
    }
  };

  const ensureRemoteBrowser = (): Promise<true> => {
    if (rbStartP) return rbStartP;
    rbStartP = rb
      .start({
        url: opts.url,
        width: opts.width,
        height: opts.height,
        headful: opts.headful,
        quality: opts.quality,
        fps: opts.fps,
        onFrame: (base64) => {
          lastFrameBase64 = base64;
          broadcast({ type: "frame", payload: base64 });
        },
        onClipboard: (ev: any) => {
          // Remote → Client: share copied text
          broadcast({
            type: "clipboard",
            payload: { action: ev.action, text: ev.text || "" },
          });
        },
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

  const isAuthorized = (reqUrl?: string) => {
    try {
      if (!token) return true;
      const qs = new URLSearchParams(reqUrl?.split("?")[1] || "");
      return qs.get("token") === token;
    } catch {
      return false;
    }
  };

  app.get("/ws/health", (_req, res) => {
    try {
      res.json({ ok: true, clients: clients.size });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  const wsHandler: WebsocketRequestHandler = (ws, req) => {
    if (!isAuthorized(req.url)) {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            payload: { code: "AUTH_FAIL", message: "Unauthorized" },
          })
        );
      } catch {}
      try {
        ws.close(1008, "Unauthorized");
      } catch {}
      return;
    }
    clients.add(ws as unknown as WebSocket);
    try {
      ws.send(
        JSON.stringify({ type: "hello", payload: { clients: clients.size } })
      );
    } catch {}

    ensureRemoteBrowser()
      .then(async () => {
        // 1) send cached frame immediately if we have it
        if (lastFrameBase64) {
          try {
            ws.send(
              JSON.stringify({ type: "frame", payload: lastFrameBase64 })
            );
          } catch {}
        }
        // 2) send a fresh capture for this client (no bloqueo del broadcast)
        try {
          const snap = await rb.captureFrame();
          try {
            ws.send(JSON.stringify({ type: "frame", payload: snap }));
          } catch {}
        } catch {}
      })
      .catch((err) => {
        console.error("[vwb] RB start error:", err);
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              payload: {
                code: "RB_START_FAIL",
                message: "Failed to start browser",
              },
            })
          );
        } catch {}
      });

    ws.on("message", async (raw) => {
      try {
        const s = typeof raw === "string" ? raw : raw.toString();
        const msg = JSON.parse(s);
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
          return;

        switch (msg.type) {
          case "ping": {
            try {
              ws.send(JSON.stringify({ type: "pong" }));
            } catch {}
            break;
          }
          case "hello": {
            // If hello carries canvas size, match viewport (como ya lo tienes)
            if (
              msg.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              await ensureRemoteBrowser();
              await rb.resizeViewport(
                msg.payload.canvasWidth | 0,
                msg.payload.canvasHeight | 0
              );
              // después del resize, captura frame fresco
              try {
                const snap = await rb.captureFrame();
                try {
                  ws.send(JSON.stringify({ type: "frame", payload: snap }));
                } catch {}
              } catch {}
            }
            break;
          }
          case "requestFrame": {
            await ensureRemoteBrowser();
            // try cached first
            if (lastFrameBase64) {
              try {
                ws.send(
                  JSON.stringify({ type: "frame", payload: lastFrameBase64 })
                );
              } catch {}
            }
            // then attempt a fresh capture
            try {
              const snap = await rb.captureFrame();
              try {
                ws.send(JSON.stringify({ type: "frame", payload: snap }));
              } catch {}
            } catch {}
            break;
          }
          case "resize": {
            if (
              msg.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              await ensureRemoteBrowser();
              await rb.resizeViewport(
                msg.payload.canvasWidth | 0,
                msg.payload.canvasHeight | 0
              );
              // captura post-resize para que pinte al instante
              try {
                const snap = await rb.captureFrame();
                try {
                  ws.send(JSON.stringify({ type: "frame", payload: snap }));
                } catch {}
              } catch {}
            }
            break;
          }
          case "mouse": {
            await ensureRemoteBrowser();
            await injectMousePptr(rb, msg.payload);
            break;
          }
          case "wheel": {
            await ensureRemoteBrowser();
            await injectWheelPptr(rb, msg.payload);
            break;
          }
          case "key": {
            await ensureRemoteBrowser();
            await injectKeyPptr(rb, msg.payload);
            break;
          }
          case "clipboard": {
            await ensureRemoteBrowser();
            const action = msg?.payload?.action;
            if (action === "paste") {
              const text = String(msg?.payload?.text ?? "");
              if (text) await pasteText(rb, text);
              // opcional: ack
              // try { ws.send(JSON.stringify({ type: "clipboard", payload: { action: "pasted", ok: true } })); } catch {}
            } else if (action === "request") {
              // No standard way to read Chromium clipboard from CDP; omit for now.
              // You could keep last 'copy/cut' and return it if necesitas:
              // try { ws.send(JSON.stringify({ type: "clipboard", payload: { action: "copy", text: lastCopied } })); } catch {}
            }
            break;
          }

          default: {
            try {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { code: "UNSUPPORTED", message: "Unknown type" },
                })
              );
            } catch {}
          }
        }
      } catch (err) {
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              payload: { code: "BAD_MSG", message: "Invalid message" },
            })
          );
        } catch {}
      }
    });

    ws.on("close", () => {
      clients.delete(ws as unknown as WebSocket);
    });
    ws.on("error", () => {
      clients.delete(ws as unknown as WebSocket);
      try {
        ws.close();
      } catch {}
    });
  };

  (wsApp as unknown as WsApplication).ws("/ws", wsHandler);

  const ready = Promise.resolve(true);
  const stop = async () => {
    try {
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
      clients.clear();
      try {
        if (rbStartP) await rb.stop();
      } catch {}
      rbStartP = null;
      console.log("[vwb] WS server stopped");
    } catch (err) {
      console.error(err);
      throw new Error("WS_STOP_FAIL");
    }
  };

  console.log("[vwb] WS mounted at /ws (health at /ws/health)");
  return { stop };
}
