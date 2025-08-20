/* eslint-disable no-console */
import { KeyInput } from "puppeteer";
import { RemoteBrowser } from "./remote-browser";

/**
 * Wire payload from frontend (pure keydown/keyup).
 */
export interface KeyPayload {
  type: "down" | "up";
  key: string; // e.key (e.g. 'ñ', 'Dead', 'Enter', 'Backspace', etc.)
  code?: string; // e.code (KeyA, ArrowLeft, NumpadEnter, …)
  repeat?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** Normalize some browser variants to what Puppeteer expects */
const KEY_NORMALIZE: Record<string, string> = {
  OS: "Meta",
  Spacebar: " ",
  Esc: "Escape",
};

/** Control / function keys handled by Puppeteer down/up */
const CONTROL_KEYS = new Set<string>([
  "Backspace",
  "Delete",
  "Enter",
  "Tab",
  "Escape",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Pause",
  "PrintScreen",
  "Meta",
  "Control",
  "Alt",
  "Shift",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "NumpadEnter",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
]);

const MODS = new Set<string>(["Control", "Meta", "Alt", "Shift"]);
const isModifier = (k: string) => MODS.has(k);
const normalizeKey = (k?: string) => (k ? KEY_NORMALIZE[k] ?? k : "");

/** Printable = single visible Unicode code point (space or any accented letter, punctuation, etc.) */
const isPrintable = (key: string) => {
  if (key === " ") return true;
  return key.length === 1 && key !== "\u0000";
};

/**
 * We must suppress keyup after inserting printable text, otherwise Puppeteer will throw
 * "Unknown key: 'ñ'". Use a stable identifier: prefer 'code', fallback to 'key'.
 */
const suppressKeyUp = new Set<string>();
const idFor = (p: KeyPayload) => p.code || p.key || "";

/**
 * Keyboard via Puppeteer:
 * - "Dead" → ignore (no down/up).
 * - Control/function or with modifiers → page.keyboard.down/up(key).
 * - Printable w/o modifiers → sendCharacter() (or CDP Input.insertText) on keydown, suppress keyup.
 */
export async function injectKeyPptr(
  rb: RemoteBrowser,
  p: KeyPayload
): Promise<true> {
  try {
    const page = rb.getPage();
    const cdp = rb.getCDP(); // used for fallback Input.insertText

    const rawKey = normalizeKey(p.key);
    const key = rawKey || "";
    const ident = idFor(p);
    const hasMods = !!(p.ctrl || p.meta || p.alt);

    // 1) Dead keys from IME / dead-key layouts → ignore
    if (key === "Dead") return true;

    // 2) Control / function keys or any combo (Ctrl/Meta/Alt) → down/up
    if (hasMods || CONTROL_KEYS.has(key) || isModifier(key)) {
      if (p.type === "down") {
        // if you dislike OS autorepeat, you can ignore repeats here:
        // if (p.repeat) return true;
        await page.keyboard.down(key as KeyInput);
        return true;
      }
      await page.keyboard.up(key as KeyInput);
      return true;
    }

    // 3) Printable without modifiers → insert character on keydown, suppress keyup
    if (isPrintable(key)) {
      if (p.type === "down") {
        try {
          // Prefer Puppeteer's sendCharacter (not always declared in TS types)
          const kb: any = page.keyboard as any;
          if (typeof kb.sendCharacter === "function") {
            await kb.sendCharacter(key);
          } else {
            // Robust fallback via CDP
            await cdp.send("Input.insertText", { text: key });
          }
        } catch (err) {
          // If sendCharacter failed for any reason, fallback to CDP too
          try {
            await cdp.send("Input.insertText", { text: key });
          } catch (e) {
            console.error("[keyboard] insert printable failed:");
            if (process.env.ENV !== "PROD" || !(e instanceof Error))
              console.error(e);
            else console.error(e.message);
          }
        }
        if (ident) suppressKeyUp.add(ident);
      } else {
        if (ident && suppressKeyUp.has(ident)) {
          suppressKeyUp.delete(ident);
          return true; // swallow keyup to avoid "Unknown key"
        }
        // If it wasn't marked, ignore silently
      }
      return true;
    }

    // 4) Conservative fallback (should not hit for accented chars)
    if (p.type === "down") await page.keyboard.down(key as KeyInput);
    else await page.keyboard.up(key as KeyInput);
    return true;
  } catch (e) {
    const msg = (e as Error)?.message || "";
    switch (true) {
      case /Unknown key/.test(msg): {
        console.warn("[keyboard] Unknown key swallowed:", msg);
        return true;
      }
      default: {
        console.error("[keyboard] error:");
        if (process.env.ENV !== "PROD" || !(e instanceof Error))
          console.error(e);
        else console.error(e.message);
        return true;
      }
    }
  }
}
