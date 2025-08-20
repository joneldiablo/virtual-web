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
 * Single-client flow:
 * - The only client can resize viewport freely (1:1).
 * - Sends 'mode' with scaled:false.
 * - Optionally echoes cursor (we keep it simple: no echo; el cursor nativo ya se ve).
 */
export function createSingleFlow(ctx: FlowContext): Flow {
  const sendMode = () => {
    try {
      const m = ctx.getMetrics();
      ctx.broadcast({
        type: "mode",
        payload: {
          scaled: false,
          leader: null,
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
        payload: { clients: ctx.clients.size, cid, leader: null },
      });
    } catch {}
  };

  return {
    name: "single",

    onSwitchIn: () => {
      sendMode();
    },

    onConnect: async (ws, cid) => {
      sendHello(ws, cid);
      sendMode();
      try {
        await ctx.ensureRemoteBrowser();
        // cache frame first
        if (ctx.lastFrameRef.value)
          ctx.wsSend(ws, { type: "frame", payload: ctx.lastFrameRef.value });
        // then a fresh capture
        try {
          const snap = await ctx.rb.captureFrame();
          ctx.wsSend(ws, { type: "frame", payload: snap });
        } catch {}
      } catch {}
    },

    onDisconnect: () => {
      sendMode();
    },

    onMessage: async (ws, _cid, msg) => {
      try {
        switch (msg.type) {
          case "ping": {
            ctx.wsSend(ws, { type: "pong" });
            break;
          }
          case "hello": {
            const rec = ctx.clients.get(ws as any);
            const prevCid = rec?.cid;

            // 1) Reasignar cid si clientId es válido y no está en uso
            const want = Number(msg?.payload?.clientId) | 0;
            if (
              rec &&
              want > 0 &&
              want !== rec.cid &&
              !isCidInUse(ctx.clients, want)
            ) {
              rec.cid = want;
            }

            // 2) Resize libre (single)
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              await ctx.ensureRemoteBrowser();
              await ctx.rb.resizeViewport(
                msg.payload.canvasWidth | 0,
                msg.payload.canvasHeight | 0
              );
              try {
                const snap = await ctx.rb.captureFrame();
                ctx.wsSend(ws, { type: "frame", payload: snap });
              } catch {}
            }

            // 3) Confirmar hello con el cid final
            ctx.wsSend(ws, {
              type: "hello",
              payload: {
                clients: ctx.clients.size,
                cid: ctx.clients.get(ws as any)?.cid,
                leader: null,
              },
            });

            // 4) Notificar modo (por si cambió viewport)
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
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              await ctx.ensureRemoteBrowser();
              await ctx.rb.resizeViewport(
                msg.payload.canvasWidth | 0,
                msg.payload.canvasHeight | 0
              );
              try {
                const snap = await ctx.rb.captureFrame();
                ctx.wsSend(ws, { type: "frame", payload: snap });
              } catch {}
              // metrics changed → notify
              sendMode();
            }
            break;
          }
          case "mouse": {
            await ctx.ensureRemoteBrowser();
            await injectMousePptr(ctx.rb, msg.payload);
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
