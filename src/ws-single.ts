/* eslint-disable no-console */
import type { WebSocket } from "ws";
import type { Flow, FlowContext } from "./types";
import { injectMousePptr, injectWheelPptr } from "./mouse";
import { injectKeyPptr } from "./keyboard";
import { pasteText } from "./clipboard";

/** Find the WebSocket currently using a CID (if any). */
function findWsByCid(
  clients: Map<WebSocket, { cid: number }>,
  cid: number
): WebSocket | null {
  for (const [ws, v] of clients.entries()) if (v.cid === cid) return ws;
  return null;
}

/**
 * Flow used when only a single client is connected. The client can freely
 * resize the viewport and receives frames without cursor echo.
 *
 * @example
 * ```ts
 * const flow = createSingleFlow(ctx);
 * flow.onSwitchIn();
 * ```
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

    onConnect: async (_ws, _cid) => {
      // Defer page creation until the client sends "hello" with its session id
      sendMode();
    },

    onDisconnect: () => {
      sendMode();
    },

    onMessage: async (ws, baseCid, msg) => {
      const cid = ctx.clients.get(ws as any)?.cid ?? baseCid;
      try {
        switch (msg.type) {
          case "ping": {
            ctx.wsSend(ws, { type: "pong" });
            break;
          }

          case "hello": {
            const rec = ctx.clients.get(ws as any);
            if (!rec) break;

            // 1) CID takeover if client asks for a specific clientId
            const want = Number(msg?.payload?.clientId) | 0;
            if (want > 0 && want !== rec.cid) {
              const other = findWsByCid(ctx.clients, want);
              if (other && other !== ws) {
                try {
                  ctx.wsSend(other, {
                    type: "error",
                    payload: {
                      code: "CID_REPLACED",
                      message: "Client reconnected",
                    },
                  });
                } catch {}
                try {
                  (other as any).close(4001, "Replaced by reconnect");
                } catch {}
              }
              if (ctx.opts.isolate) await ctx.rb.closePage(want);
              const oldCid = rec.cid;
              rec.cid = want;
              if (ctx.opts.isolate) await ctx.rb.closePage(oldCid);
            }

            // 2) Ensure page and allow free resize
            await ctx.ensureRemoteBrowser(rec.cid, ws);
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              await ctx.rb.resizeViewport(
                msg.payload.canvasWidth | 0,
                msg.payload.canvasHeight | 0
              );
              try {
                const snap = await ctx.rb.captureFrame();
                ctx.wsSend(ws, { type: "frame", payload: snap });
              } catch {}
            }

            // 3) Confirm final cid so the client stores it (sessionStorage)
            sendHello(ws, ctx.clients.get(ws as any)!.cid);

            // 4) Notify mode (in case metrics changed)
            sendMode();
            break;
          }

          case "requestFrame": {
            await ctx.ensureRemoteBrowser(cid, ws);
            const prev = ctx.lastFrameRef.get(cid);
            if (prev)
              ctx.wsSend(ws, {
                type: "frame",
                payload: prev,
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
              await ctx.ensureRemoteBrowser(cid, ws);
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
            break;
          }

          case "mouse": {
            await ctx.ensureRemoteBrowser(cid, ws);
            await injectMousePptr(ctx.rb, msg.payload);
            break;
          }
          case "wheel": {
            await ctx.ensureRemoteBrowser(cid, ws);
            await injectWheelPptr(ctx.rb, msg.payload);
            break;
          }
          case "key": {
            await ctx.ensureRemoteBrowser(cid, ws);
            await injectKeyPptr(ctx.rb, msg.payload);
            break;
          }

          case "clipboard": {
            await ctx.ensureRemoteBrowser(cid, ws);
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
