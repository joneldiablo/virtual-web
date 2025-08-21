import { RemoteBrowser } from "../remote-browser";
import type { Page } from "puppeteer";

describe("RemoteBrowser pages", () => {
  it("stores pages by client id", async () => {
    const rb = new RemoteBrowser();
    const dummyPage = { close: jest.fn() } as unknown as Page;
    rb.page = { cid: 1, page: dummyPage, cdp: {} as any };
    expect(rb.getPageByCid(1)).toBe(dummyPage);
    await rb.closePage(1);
    expect(rb.getPageByCid(1)).toBeUndefined();
  });
});
