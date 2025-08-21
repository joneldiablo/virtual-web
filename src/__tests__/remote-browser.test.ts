// Mock puppeteer dependency
jest.mock("puppeteer", () => ({ launch: jest.fn() }));

import { RemoteBrowser } from "../remote-browser";
import type { Page } from "puppeteer";

describe("RemoteBrowser pages", () => {
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

  it("stores pages by client id and switches active page", async () => {
    const rb = new RemoteBrowser();
    (rb as any).isIsolate = true;
    const p1 = makePage();
    const p2 = makePage();

    (rb as any).browser = {
      newPage: jest
        .fn()
        .mockResolvedValueOnce(p1)
        .mockResolvedValueOnce(p2),
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

    expect(rb.getPageByCid(1)).toBe(p1);
    expect(rb.getPageByCid(2)).toBe(p2);

    rb.usePage(1);
    expect(rb.getPage()).toBe(p1);
    rb.usePage(2);
    expect(rb.getPage()).toBe(p2);

    await rb.closePage(1);
    expect(rb.getPageByCid(1)).toBeUndefined();
  });

  it("does not close existing pages when adding a new client", async () => {
    const rb = new RemoteBrowser();
    (rb as any).isIsolate = true;

    const p1 = makePage();
    const p2 = makePage();

    (rb as any).browser = {
      newPage: jest
        .fn()
        .mockResolvedValueOnce(p1)
        .mockResolvedValueOnce(p2),
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
