import type { CliArgs } from "../types";

describe("CliArgs", () => {
  it("allows the isolate flag", () => {
    const args: CliArgs = {
      url: "https://example.com",
      port: 8080,
      quality: 60,
      fps: 30,
      headful: false,
      isolate: true,
      width: 800,
      height: 600,
      token: "",
      env: "PROD",
      publicDir: "",
      _: [],
      $0: "",
    };
    expect(args.isolate).toBe(true);
  });
});
