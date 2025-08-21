import { pasteText } from "../clipboard";

jest.mock("../remote-browser", () => ({ RemoteBrowser: jest.fn() }));

describe("pasteText", () => {
  it("calls pasteFromClipboard and returns true", async () => {
    const rb: any = { pasteFromClipboard: jest.fn().mockResolvedValue(true) };
    await expect(pasteText(rb, "hi")).resolves.toBe(true);
    expect(rb.pasteFromClipboard).toHaveBeenCalledWith("hi");
  });

  it("rethrows known clipboard errors", async () => {
    const rb: any = {
      pasteFromClipboard: jest
        .fn()
        .mockRejectedValue(new Error("RB_CLIP_PERM_FAIL")),
    };
    await expect(pasteText(rb, "hi")).rejects.toThrow("RB_CLIP_PERM_FAIL");
  });

  it("rethrows unexpected errors", async () => {
    const rb: any = {
      pasteFromClipboard: jest.fn().mockRejectedValue(new Error("BOOM")),
    };
    await expect(pasteText(rb, "hi")).rejects.toThrow("BOOM");
  });
});
