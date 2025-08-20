/* eslint-disable no-console */
import type { WebSocket } from "ws";
import type { Flow, FlowContext } from "./types";
import { injectMousePptr, injectWheelPptr } from "./mouse";
import { injectKeyPptr } from "./keyboard";
import { pasteText } from "./clipboard";

function isCidInUse(
  clients: Map<WebSocket, { cid: number }>,
  candidate: number
) {
  for (const v of clients.values()) if (v.cid === candidate) return true;
  return false;
}

/**
 * Multi-client flow:
 * - One "leader" (first connected) controls viewport resize.
 * - All clients see each other's cursors via {type:"cursor"} broadcast (incl. sender).
 * - Sends 'mode' with scaled:true, leader:cid, and device metrics.
 */
export function createMultiFlow(ctx: FlowContext): Flow {
  let leaderCid: number | null = null;

  const chooseLeader = () => {
    try {
      const first = [...ctx.clients.values()][0];
      leaderCid = first ? first.cid : null;
    } catch {
      leaderCid = null;
    }
  };

  const sendMode = () => {
    try {
      const m = ctx.getMetrics();
      ctx.broadcast({
        type: "mode",
        payload: {
          scaled: true,
          leader: leaderCid,
          deviceWidth: m.deviceWidth,
          deviceHeight: m.deviceHeight,
        },
      });
    } catch {}
  };

  const sendHello = (ws: WebSocket, cid: number) => {
    try {
      ctx.wsSend(ws, {
        type: "hello",
        payload: { clients: ctx.clients.size, cid, leader: leaderCid },
      });
    } catch {}
  };

  const shouldResize = (cid: number) => leaderCid != null && cid === leaderCid;

  const broadcastCursor = (cid: number, p: any) => {
    try {
      const dev =
        p.displayRect && p.displayRect.width && p.displayRect.height
          ? ctx.rb.mapFromDisplayRect(p.x, p.y, p.displayRect)
          : ctx.rb.mapClientToDevtools(p.x, p.y, p.canvasWidth, p.canvasHeight);

      ctx.broadcast({
        type: "cursor",
        payload: {
          cid,
          x: dev.x,
          y: dev.y,
          down: !!(p.buttonsBits & 1),
          ts: Date.now(),
        },
      });
    } catch {}
  };

  return {
    name: "multi",

    onSwitchIn: () => {
      chooseLeader();
      sendMode();
    },

    onConnect: async (ws, cid) => {
      // pick/confirm leader
      if (!leaderCid) chooseLeader();
      sendHello(ws, cid);
      sendMode();

      try {
        await ctx.ensureRemoteBrowser();
        // cached frame then fresh
        if (ctx.lastFrameRef.value)
          ctx.wsSend(ws, { type: "frame", payload: ctx.lastFrameRef.value });
        try {
          const snap = await ctx.rb.captureFrame();
          ctx.wsSend(ws, { type: "frame", payload: snap });
        } catch {}
      } catch {}
    },

    onDisconnect: (_ws, _cid) => {
      // re-elect leader if needed
      if (
        leaderCid &&
        ![...ctx.clients.values()].some((v) => v.cid === leaderCid)
      )
        chooseLeader();
      sendMode();
    },

    onMessage: async (ws, cid, msg) => {
      try {
        switch (msg.type) {
          case "ping": {
            ctx.wsSend(ws, { type: "pong" });
            break;
          }
          case "hello": {
            await ctx.ensureRemoteBrowser();

            const rec = ctx.clients.get(ws as any);
            const oldCid = rec?.cid;

            // 1) Reasignar cid si clientId es válido y libre
            const want = Number(msg?.payload?.clientId) | 0;
            if (
              rec &&
              want > 0 &&
              want !== rec.cid &&
              !isCidInUse(ctx.clients, want)
            ) {
              rec.cid = want;
              // Si el líder era el viejo cid, migrarlo
              if (leaderCid != null && oldCid === leaderCid) leaderCid = want;
            }

            // 2) Solo el líder puede resizar
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              if (shouldResize(rec?.cid || 0)) {
                await ctx.rb.resizeViewport(
                  msg.payload.canvasWidth | 0,
                  msg.payload.canvasHeight | 0
                );
                try {
                  const snap = await ctx.rb.captureFrame();
                  ctx.wsSend(ws, { type: "frame", payload: snap });
                } catch {}
              }
            }

            // 3) Confirmar hello con el cid final y líder actual
            ctx.wsSend(ws, {
              type: "hello",
              payload: {
                clients: ctx.clients.size,
                cid: ctx.clients.get(ws as any)?.cid,
                leader: leaderCid,
              },
            });

            // 4) Enviar modo (por métricas/leader)
            sendMode();
            break;
          }
          case "requestFrame": {
            await ctx.ensureRemoteBrowser();
            if (ctx.lastFrameRef.value)
              ctx.wsSend(ws, {
                type: "frame",
                payload: ctx.lastFrameRef.value,
              });
            try {
              const snap = await ctx.rb.captureFrame();
              ctx.wsSend(ws, { type: "frame", payload: snap });
            } catch {}
            break;
          }
          case "resize": {
            await ctx.ensureRemoteBrowser();
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              if (shouldResize(cid)) {
                await ctx.rb.resizeViewport(
                  msg.payload.canvasWidth | 0,
                  msg.payload.canvasHeight | 0
                );
                try {
                  const snap = await ctx.rb.captureFrame();
                  ctx.wsSend(ws, { type: "frame", payload: snap });
                } catch {}
                sendMode();
              }
            }
            break;
          }
          case "mouse": {
            await ctx.ensureRemoteBrowser();
            await injectMousePptr(ctx.rb, msg.payload);
            // broadcast cursor for everyone (incl. sender)
            broadcastCursor(cid, msg.payload);
            break;
          }
          case "wheel": {
            await ctx.ensureRemoteBrowser();
            await injectWheelPptr(ctx.rb, msg.payload);
            break;
          }
          case "key": {
            await ctx.ensureRemoteBrowser();
            await injectKeyPptr(ctx.rb, msg.payload);
            break;
          }
          case "clipboard": {
            await ctx.ensureRemoteBrowser();
            if (msg?.payload?.action === "paste") {
              const text = String(msg?.payload?.text ?? "");
              if (text) await pasteText(ctx.rb, text);
            }
            break;
          }
          default: {
            ctx.wsSend(ws, {
              type: "error",
              payload: { code: "UNSUPPORTED", message: "Unknown type" },
            });
          }
        }
      } catch {
        ctx.wsSend(ws, {
          type: "error",
          payload: { code: "BAD_MSG", message: "Invalid message" },
        });
      }
    },
  };
}
