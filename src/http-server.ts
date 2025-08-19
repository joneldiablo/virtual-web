/* eslint-disable no-console */
import path from "node:path";
import fs from "node:fs";
import http from "http";
import express, { Application } from "express";

/**
 * Controller returned by createHttpServer
 */
export interface HttpServerController {
  app: Application;
  server: http.Server;
  ready: Promise<true>;
  stop: (code?: number) => Promise<void>;
}

/**
 * Create and start a static HTTP server for /public.
 * No globals, no external resolve/reject.
 */
export function createHttpServer(opts: { port: number }): HttpServerController {
  // Validate public dir
  const publicDir = path.resolve(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) throw new Error("PUBLIC_NOT_FOUND");

  const app = express();
  app.use(express.static(publicDir));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);

  // Promise that resolves when listening, rejects on bind error
  const ready = new Promise<true>((resolve, reject) => {
    try {
      server.once("error", (err: any) => {
        if (err?.code === "EADDRINUSE") reject(new Error("EADDRINUSE"));
        else reject(err);
      });
      server.listen(opts.port, () => {
        console.log(`[vwb] HTTP listening at http://localhost:${opts.port}/`);
        console.log(`[vwb] Static dir: ${publicDir}`);
        resolve(true);
      });
    } catch (err) {
      reject(err);
    }
  });

  // Graceful stop
  const stop = async (_code = 0) => {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      console.log("[vwb] HTTP server closed");
    } catch (err) {
      console.error(err);
    }
  };

  return { app, server, ready, stop };
}
