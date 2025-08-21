// Mock puppeteer dependency
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

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

  it("does not close existing pages when adding a new client", async () => {
    const rb = new RemoteBrowser();

    const makePage = (): Page => {
      const cdp = { send: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
      return {
        setViewport: jest.fn().mockResolvedValue(undefined),
        goto: jest.fn().mockResolvedValue(undefined),
        target: jest.fn(() => ({ createCDPSession: jest.fn().mockResolvedValue(cdp) })),
        on: jest.fn(),
        exposeFunction: jest.fn().mockResolvedValue(undefined),
        evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as Page;
    };

    const p1 = makePage();
    const p2 = makePage();

    (rb as any).browser = {
      pages: jest
        .fn()
        .mockResolvedValueOnce([p1])
        .mockResolvedValueOnce([p1]),
      newPage: jest.fn().mockResolvedValueOnce(p2),
      on: jest.fn(),
    } as any;

    await rb.ensurePage({
      cid: 1,
      url: "http://a",
      width: 800,
      height: 600,
      onFrame: jest.fn(),
    });
    await rb.ensurePage({
      cid: 2,
      url: "http://a",
      width: 800,
      height: 600,
      onFrame: jest.fn(),
    });

    expect((p1 as any).close).not.toHaveBeenCalled();
  });
});
