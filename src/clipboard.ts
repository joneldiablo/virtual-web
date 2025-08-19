/* eslint-disable no-console */
import { RemoteBrowser } from "./remote-browser";

/**
 * Paste plain text at caret using CDP (works across origins).
 * @param {RemoteBrowser} rb
 * @param {string} text
 * @returns {Promise<true>}
 */
export async function pasteText(
  rb: RemoteBrowser,
  text: string
): Promise<true> {
  try {
    const cdp = rb.getCDP();
    // CDP supports inserting arbitrary text at the current focus/caret.
    await cdp.send("Input.insertText", { text });
    // Optional: also dispatch a 'paste' event in-page for apps that listen to it
    // (best-effort; may be ignored by some browsers)
    try {
      const page = rb.getPage();
      await page.evaluate((t) => {
        try {
          const ev = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(ev, "clipboardData", {
            value: new DataTransfer(),
          });
          // @ts-ignore
          ev.clipboardData.setData("text/plain", t);
          document.activeElement?.dispatchEvent(ev);
        } catch {}
      }, text);
    } catch {}
    return true;
  } catch (error) {
    console.error(error);
    throw new Error("RB_PASTE_FAIL");
  }
}
