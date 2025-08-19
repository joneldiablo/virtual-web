#!/usr/bin/env ts-node
/* eslint-disable no-console */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createHttpServer } from "./http-server";
import { createWsServer } from "./ws-server";

/**
 * CLI arguments definition
 */
interface CliArgs {
  url: string;
  port: number;
  quality: number;
  fps: number;
  headful: boolean;
  width: number;
  height: number;
  token: string;
  _: (string | number)[];
  $0: string;
}

/**
 * Parse CLI args with yargs.
 * Defaults read from process.env, falling back to hard defaults.
 */
const args = yargs(hideBin(process.argv))
  .option("url", {
    type: "string",
    default: process.env.URL || "https://google.com.mx",
    describe: "Initial URL (reserved)",
  })
  .option("port", {
    type: "number",
    default: Number(process.env.PORT) || 8085,
    describe: "HTTP/WebSocket port",
  })
  .option("quality", {
    type: "number",
    default: Number(process.env.QUALITY) || 60,
    describe: "JPEG quality (reserved)",
  })
  .option("fps", {
    type: "number",
    default: Number(process.env.FPS) || 48,
    describe: "Frames per second (reserved)",
  })
  .option("headful", {
    type: "boolean",
    default:
      typeof process.env.HEADFUL === "string"
        ? ["1", "true", "yes", "on"].includes(process.env.HEADFUL.toLowerCase())
        : false,
    describe: "Launch Chromium UI (reserved)",
  })
  .option("width", {
    type: "number",
    default: Number(process.env.WIDTH) || 1280,
    describe: "Viewport width (reserved)",
  })
  .option("height", {
    type: "number",
    default: Number(process.env.HEIGHT) || 720,
    describe: "Viewport height (reserved)",
  })
  .option("token", {
    type: "string",
    default: process.env.TOKEN || "",
    describe: "Optional WS bearer token (reserved)",
  })
  .strict().argv as unknown as CliArgs;

/**
 * main
 * Orchestrates OS-facing concerns only (signals/env/args).
 */
const main = async (cli: CliArgs) => {
  try {
    console.log("Start server....");
    const httpCtrl = createHttpServer({ port: cli.port });
    await httpCtrl.ready;
    console.log("server ready");

    const wsCtrl = createWsServer({
      app: httpCtrl.app,
      server: httpCtrl.server,
      token: cli.token,
      url: cli.url,
      width: cli.width,
      height: cli.height,
      headful: cli.headful,
      quality: cli.quality,
      fps: cli.fps,
    });

    const handleSignal = async (sig: string) => {
      try {
        console.log(`[vwb] Caught ${sig}`);
        await wsCtrl.stop();
        await httpCtrl.stop();
        process.exit(0);
      } catch (e: unknown) {
        if (e instanceof Error) console.error(e);
        else console.error("Unknown error on shutdown:", e);
        process.exit(1);
      }
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
  } catch (error: unknown) {
    if (error instanceof Error) {
      switch (error.message) {
        case "PUBLIC_NOT_FOUND": {
          console.error("Public folder not found");
          break;
        }
        case "EADDRINUSE": {
          console.error("Port already in use");
          break;
        }
        default: {
          console.error(error);
          console.error("Unexpected startup error");
        }
      }
    } else {
      console.error("Non-Error thrown:", error);
    }

    throw error;
  }
};

main(args);
