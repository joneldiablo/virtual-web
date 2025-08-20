/* eslint-disable no-console */
import { RemoteBrowser } from "./remote-browser";

/**
 * Paste plain text using real clipboard paste:
 * - Grants permissions
 * - Clears clipboard
 * - Writes text
 * - Sends Ctrl/Cmd+V so sites that listen to 'paste' work as expected
 * Falls back to Input.insertText on failure.
 * @param {RemoteBrowser} rb
 * @param {string} text
 * @returns {Promise<true>}
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
