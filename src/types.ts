/* eslint-disable no-console */
import type { Application } from "express";
import type { Server } from "http";
import type { WebSocket } from "ws";
import type { RemoteBrowser } from "./remote-browser";

/**
 * CLI arguments definition.
 *
 * @example
 * ```ts
 * const args: CliArgs = {
 *   url: "https://example.com",
 *   port: 8080,
 *   quality: 60,
 *   fps: 30,
 *   headful: false,
 *   width: 1280,
 *   height: 720,
 *   token: "",
 *   env: "PROD",
 *   _: [],
 *   $0: "",
 * };
 * ```
 */
export interface CliArgs {
  url: string;
  port: number;
  quality: number;
  fps: number;
  headful: boolean;
  width: number;
  height: number;
  token: string;
  env: "PROD" | "DEV" | "DEBUG" | "TESTING";
  _: (string | number)[];
  $0: string;
}

/**
 * Options for {@link RemoteBrowser.start}.
 *
 * @example
 * ```ts
 * const opts: RemoteBrowserStartOptions = {
 *   url: "https://example.com",
 *   width: 1280,
 *   height: 720,
 *   headful: false,
 *   quality: 60,
 *   fps: 30,
 *   onFrame: (img) => console.log(img.slice(0, 20)),
 * };
 * ```
 */
export interface RemoteBrowserStartOptions {
  url: string;
  width: number;
  height: number;
  headful: boolean;
  quality: number;
  fps: number;
  onFrame: (base64: string) => void;
  onClipboard?: (ev: { action: "copy" | "cut"; text: string }) => void;
}

/** Controller returned by {@link createHttpServer}. */
export interface HttpServerController {
  app: Application;
  server: Server;
  ready: Promise<true>;
  stop: (code?: number) => Promise<void>;
}

/**
 * Payload representing a keyboard event forwarded from the client.
 *
 * @example
 * ```ts
 * const payload: KeyPayload = { type: "down", key: "a" };
 * ```
 */
export interface KeyPayload {
  /** Event type: keydown or keyup */
  type: "down" | "up";
  /** Value from `KeyboardEvent.key` (e.g. "a", "Enter") */
  key: string;
  /** Optional value from `KeyboardEvent.code` (e.g. "KeyA") */
  code?: string;
  /** Whether the key is autorepeat */
  repeat?: boolean;
  /** Control modifier pressed */
  ctrl?: boolean;
  /** Alt/Option modifier pressed */
  alt?: boolean;
  /** Shift modifier pressed */
  shift?: boolean;
  /** Meta/Command modifier pressed */
  meta?: boolean;
}

/**
 * Mouse event payload originating from the client canvas.
 *
 * @example
 * ```ts
 * const p: MousePayload = {
 *   x: 10,
 *   y: 20,
 *   type: "move",
 *   canvasWidth: 800,
 *   canvasHeight: 600,
 * };
 * ```
 */
export interface MousePayload {
  x: number;
  y: number;
  type: "down" | "up" | "move";
  button?: "left" | "right" | "middle";
  clickCount?: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Payload used by {@link injectMousePptr}.
 *
 * @example
 * ```ts
 * const p: MouseInjectPayload = {
 *   type: "click",
 *   x: 10,
 *   y: 10,
 *   canvasWidth: 800,
 *   canvasHeight: 600,
 * };
 * ```
 */
export interface MouseInjectPayload {
  type: "move" | "down" | "up" | "click" | "dblclick";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  buttonsBits?: number;
  canvasWidth: number;
  canvasHeight: number;
  displayRect?: { x: number; y: number; width: number; height: number };
}

/**
 * Wheel event payload from the client.
 *
 * @example
 * ```ts
 * const w: WheelPayload = {
 *   deltaX: 0,
 *   deltaY: -100,
 *   x: 10,
 *   y: 10,
 *   canvasWidth: 800,
 *   canvasHeight: 600,
 * };
 * ```
 */
export interface WheelPayload {
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** Controller returned by {@link createWsServer}. */
export interface WsServerController {
  /** Gracefully stop the WebSocket server. */
  stop: () => Promise<void>;
}

/** Options for {@link createWsServer}. */
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

/**
 * Helpers provided to flow implementations.
 *
 * @example
 * ```ts
 * const ctx: FlowContext = {
 *   opts,
 *   rb,
 *   ensureRemoteBrowser,
 *   clients: new Map(),
 *   wsSend: () => {},
 *   broadcast: () => {},
 *   lastFrameRef: { value: null },
 *   getMetrics: () => ({ deviceWidth: 0, deviceHeight: 0 })
 * };
 * ```
 */
export interface FlowContext {
  opts: CreateWsServerOptions;
  rb: RemoteBrowser;
  ensureRemoteBrowser: () => Promise<true>;

  clients: Map<WebSocket, { cid: number }>;
  wsSend: (ws: WebSocket, msg: any) => void;
  broadcast: (msg: any) => void;

  /** Shared last-frame cache */
  lastFrameRef: { value: string | null };

  /** Device metrics getter */
  getMetrics: () => { deviceWidth: number; deviceHeight: number };
}

/**
 * Flow interface used by the WebSocket server to handle different modes.
 *
 * @example
 * ```ts
 * const flow: Flow = {
 *   name: "single",
 *   onSwitchIn: () => {},
 *   onConnect: async () => {},
 *   onDisconnect: async () => {},
 *   onMessage: async () => {}
 * };
 * ```
 */
export interface Flow {
  name: "single" | "multi";
  onSwitchIn: () => void | Promise<void>;
  onConnect: (ws: WebSocket, cid: number) => void | Promise<void>;
  onDisconnect: (ws: WebSocket, cid: number) => void | Promise<void>;
  onMessage: (ws: WebSocket, cid: number, msg: any) => Promise<void>;
}
