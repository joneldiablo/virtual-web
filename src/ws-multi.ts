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
 * Multi-client flow where one client is the leader and controls viewport
 * resizing. All clients receive frames and cursor broadcasts.
 *
 * @example
 * ```ts
 * const flow = createMultiFlow(ctx);
 * flow.onSwitchIn();
 * ```
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

    onConnect: async (_ws, _cid) => {
      // Wait for "hello" before ensuring a page for the client
      if (!leaderCid) chooseLeader();
      sendMode();
    },

    onDisconnect: () => {
      if (
        leaderCid &&
        ![...ctx.clients.values()].some((v) => v.cid === leaderCid)
      )
        chooseLeader();
      sendMode();
    },

    onMessage: async (ws, baseCid, msg) => {
      // Determine the client id either from the registry or the base handler
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

            const oldCid = rec.cid;
            const want = Number(msg?.payload?.clientId) | 0;

            // (1) Reassign CID with takeover if it's used by another WS
            if (want > 0 && want !== rec.cid) {
              const other = findWsByCid(ctx.clients, want);
              if (other && other !== ws) {
                // Close the previous WS that owned that cid; cleanup happens in the base on('close') handler
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
              rec.cid = want;
              if (ctx.opts.isolate) await ctx.rb.closePage(oldCid);
              if (
                leaderCid != null &&
                (oldCid === leaderCid || want === leaderCid)
              )
                leaderCid = want;
            }

            await ctx.ensureRemoteBrowser(rec.cid, ws);

            // (2) Only the leader may resize
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              if (shouldResize(rec.cid)) {
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

            // (3) Confirm hello with the final CID (client stores it in sessionStorage)
            sendHello(ws, rec.cid);

            // (4) Send mode (metrics/leader)
            sendMode();
            break;
          }

          case "requestFrame": {
            await ctx.ensureRemoteBrowser(cid, ws);
            const last = ctx.lastFrameRef.get(0);
            if (last)
              ctx.wsSend(ws, {
                type: "frame",
                payload: last,
              });
            try {
              const snap = await ctx.rb.captureFrame();
              ctx.wsSend(ws, { type: "frame", payload: snap });
            } catch {}
            break;
          }

          case "resize": {
            await ctx.ensureRemoteBrowser(cid, ws);
            const rec = ctx.clients.get(ws as any);
            if (!rec) break;
            if (
              msg?.payload &&
              typeof msg.payload.canvasWidth === "number" &&
              typeof msg.payload.canvasHeight === "number"
            ) {
              if (shouldResize(rec.cid)) {
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
            await ctx.ensureRemoteBrowser(cid, ws);
            await injectMousePptr(ctx.rb, msg.payload);
            broadcastCursor(cid, msg.payload);
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
