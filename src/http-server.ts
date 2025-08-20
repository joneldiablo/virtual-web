/* eslint-disable no-console */
import path from "node:path";
import fs from "node:fs";
import http from "http";
import express from "express";
import type { HttpServerController } from "./types";

/**
 * Resolve the absolute path to the /public directory.
 * Priority:
 *  1) Explicit option (opts.publicDir) if exists
 *  2) ENV PUBLIC_DIR if exists
 *  3) Package-anchored: <pkgRoot>/public  (works for global install)
 *  4) CWD fallback: <cwd>/public         (dev fallback)
 */
function resolvePublicDir(explicit?: string): string {
  const candidates: string[] = [];

  // 1) CLI/option
  if (explicit && explicit.trim()) {
    const p = path.resolve(explicit.trim());
    candidates.push(p);
  }

  // 2) ENV
  if (process.env.PUBLIC_DIR) {
    candidates.push(path.resolve(process.env.PUBLIC_DIR));
  }

  // 3) Package-anchored:
  //    When running compiled CJS: __dirname ≈ <pkg>/dist/cjs
  //    public is at <pkg>/public  → ../../public
  const pkgPublicFromDist = path.resolve(__dirname, "../public");
  candidates.push(pkgPublicFromDist);

  // 4) Dev fallback (when running ts-node from project root)
  candidates.push(path.resolve(process.cwd(), "public"));

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        console.log("[vwb] frontend directory", p);
        return p;
      }
    } catch {}
  }
  throw new Error("PUBLIC_NOT_FOUND");
}

/**
 * Create and start a static HTTP server that serves files from the `public`
 * directory and exposes a simple health endpoint.
 *
 * @example
 * ```ts
 * const ctrl = createHttpServer({ port: 8080 });
 * await ctrl.ready; // server is listening
 * // ... later
 * await ctrl.stop();
 * ```
 */
export function createHttpServer(opts: {
  port: number;
  publicDir?: string;
}): HttpServerController {
  // Validate public dir
  const publicDir = resolvePublicDir(opts.publicDir);

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
    } catch (e) {
      if (process.env.ENV !== "PROD" || !(e instanceof Error)) console.error(e);
      else console.error(e.message);
    }
  };

  return { app, server, ready, stop };
}
