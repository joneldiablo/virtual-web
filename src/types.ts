/* eslint-disable no-console */
import type { Application } from "express";
import type { Server } from "http";
import type { WebSocket } from "ws";
import { RemoteBrowser } from "./remote-browser";

/** Controller to stop WS server */
export interface WsServerController {
  stop: () => Promise<void>;
}

/** Factory options */
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

/** Minimal helpers the flows need */
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
/** Flow interface: single/multi */
export interface Flow {
  name: "single" | "multi";
  onSwitchIn: () => void | Promise<void>;
  onConnect: (ws: WebSocket, cid: number) => void | Promise<void>;
  onDisconnect: (ws: WebSocket, cid: number) => void | Promise<void>;
  onMessage: (ws: WebSocket, cid: number, msg: any) => Promise<void>;
}
