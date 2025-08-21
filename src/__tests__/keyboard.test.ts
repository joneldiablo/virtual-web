import { injectKeyPptr } from "../keyboard";
import type { KeyPayload } from "../types";

jest.mock("../remote-browser", () => ({ RemoteBrowser: jest.fn() }));

describe("injectKeyPptr", () => {
  const createRb = () => {
    const down = jest.fn();
    const up = jest.fn();
    const sendCharacter = jest.fn();
    const page = { keyboard: { down, up, sendCharacter } } as any;
    const cdp = { send: jest.fn() } as any;
    const rb: any = {
      getPage: () => page,
      getCDP: () => cdp,
    };
    return { rb, page, cdp, down, up, sendCharacter };
  };

  it("handles control keys", async () => {
    const { rb, down, up } = createRb();
    await injectKeyPptr(rb, { type: "down", key: "Enter" } as KeyPayload);
    await injectKeyPptr(rb, { type: "up", key: "Enter" } as KeyPayload);
    expect(down).toHaveBeenCalledWith("Enter");
    expect(up).toHaveBeenCalledWith("Enter");
  });

  it("inserts printable characters and suppresses keyup", async () => {
    const { rb, sendCharacter, up } = createRb();
    await injectKeyPptr(rb, { type: "down", key: "a" } as KeyPayload);
    await injectKeyPptr(rb, { type: "up", key: "a" } as KeyPayload);
    expect(sendCharacter).toHaveBeenCalledWith("a");
    expect(up).not.toHaveBeenCalled();
  });

  it("falls back to CDP when sendCharacter fails", async () => {
    const { rb, sendCharacter, cdp } = createRb();
    sendCharacter.mockImplementation(() => {
      throw new Error("boom");
    });
    await injectKeyPptr(rb, { type: "down", key: "b" } as KeyPayload);
    expect(cdp.send).toHaveBeenCalledWith("Input.insertText", { text: "b" });
  });

  it("ignores dead keys", async () => {
    const { rb, down } = createRb();
    await injectKeyPptr(rb, { type: "down", key: "Dead" } as KeyPayload);
    expect(down).not.toHaveBeenCalled();
  });

  it("swallows unknown key errors", async () => {
    const { rb } = createRb();
    const down = jest.fn().mockImplementation(() => {
      throw new Error("Unknown key: 'Foo'");
    });
    (rb.getPage().keyboard as any).down = down;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await injectKeyPptr(rb, { type: "down", key: "Foo" } as KeyPayload);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
