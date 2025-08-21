import { RemoteBrowser } from "../remote-browser";
import type { Page } from "puppeteer";

describe("RemoteBrowser page management", () => {
  it("stores the page at index 0 when not isolated", () => {
    const rb = new RemoteBrowser();
    const pg = {} as Page;
    rb.page = pg;
    expect(rb.page).toBe(pg);
  });

  it("indexes pages by client id when isolated", () => {
    const rb = new RemoteBrowser();
    (rb as any).isolate = true;
    rb.setActiveCid(1);
    const pg1 = { id: 1 } as unknown as Page;
    rb.page = pg1;
    expect(rb.page).toBe(pg1);
    rb.setActiveCid(2);
    expect(rb.page).toBeNull();
  });
});
