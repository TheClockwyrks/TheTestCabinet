import { describe, expect, it } from "vitest";
import { Diagnostics } from "./diagnostics";

describe("Diagnostics", () => {
  it("reports nothing until a source is registered", () => {
    expect(new Diagnostics().lines()).toEqual([]);
  });

  it("reads each source at the read, in registration order", () => {
    const diagnostics = new Diagnostics();
    let score = 0;
    diagnostics.register("score", () => String(score));
    diagnostics.register("best", () => "10");
    expect(diagnostics.lines()).toEqual([
      { label: "score", value: "0" },
      { label: "best", value: "10" },
    ]);
    score = 40;
    expect(diagnostics.lines()[0]).toEqual({ label: "score", value: "40" });
  });
});
