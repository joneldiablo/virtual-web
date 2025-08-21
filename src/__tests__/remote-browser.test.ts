import { RemoteBrowser } from "../remote-browser";
import type { Page } from "puppeteer";

describe("RemoteBrowser pages", () => {
  it("stores pages by client id and returns them via getter", async () => {
    const rb = new RemoteBrowser();
    const p1 = { close: jest.fn() } as unknown as Page;
    const p2 = { close: jest.fn() } as unknown as Page;

    rb.page = { cid: 1, page: p1, cdp: {} as any };
    rb.page = { cid: 2, page: p2, cdp: {} as any };

    // Getter should return page for last active cid
    expect(rb.page).toBe(p2);

    // Switch back to cid 1
    rb.page = { cid: 1, page: p1, cdp: {} as any };
    expect(rb.page).toBe(p1);

    await rb.closePage(1);
    expect(rb.getPageByCid(1)).toBeUndefined();
  });
});
