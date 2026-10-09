// The serve sign is the whole of Carom's randomness, so what is checked here is
// the draw's range and that both outcomes occur, not any particular sequence.

import { describe, expect, it } from "vitest";
import { drawServeSign } from "./random";

describe("drawServeSign", () => {
  it("returns only +1 or -1", () => {
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(drawServeSign())).toBe(1);
    }
  });

  it("produces both signs over a run of draws", () => {
    const signs = new Set<number>();
    for (let i = 0; i < 200; i++) signs.add(drawServeSign());
    expect(signs).toEqual(new Set([-1, 1]));
  });
});
