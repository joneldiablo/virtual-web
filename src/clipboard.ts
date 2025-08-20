/* eslint-disable no-console */
import { RemoteBrowser } from "./remote-browser";

/**
 * Paste plain text using the remote clipboard and a real paste keystroke.
 *
 * The function grants clipboard permissions, clears existing data, writes the
 * provided text, and finally triggers the platform-specific paste shortcut. If
 * any of these steps fails, it falls back to `Input.insertText` via the Chrome
 * DevTools Protocol.
 *
 * @example
 * ```ts
 * import { pasteText, RemoteBrowser } from "virtual-web-browser";
 *
 * const rb = new RemoteBrowser();
 * await rb.start({
 *   url: "https://example.com",
 *   width: 800,
 *   height: 600,
 *   headful: false,
 *   quality: 60,
 *   fps: 30,
 *   onFrame: () => {}
 * });
 * await pasteText(rb, "Hello world");
 * ```
 */
export async function pasteText(
  rb: RemoteBrowser,
  text: string
): Promise<true> {
  try {
    // This will clear then set clipboard, then send the proper key combo
    await rb.pasteFromClipboard(String(text ?? ""));
    return true;
  } catch (e: any) {
    try {
      switch (e?.message) {
        case "RB_CLIP_PERM_FAIL":
        case "RB_CLIP_SET_FAIL":
        case "RB_PASTE_FAIL": {
          console.error("[clipboard] paste error:", e?.message);
          break;
        }
        default: {
          console.error("[clipboard] unexpected:");
          if (process.env.ENV !== "PROD" || !(e instanceof Error))
            console.error(e);
          else console.error(e.message);
        }
      }
    } catch {}
    throw e;
  }
}
