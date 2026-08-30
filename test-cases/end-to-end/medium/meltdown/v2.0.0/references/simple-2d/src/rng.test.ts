// The game's one source of randomness (specs/instrumentation.md, A
// deterministic core): the whole generator state lives in the state's own
// field, so reseeding and replaying the same calls reproduces the same result.

import { describe, expect, it } from "vitest";
import { drawVent, nextRandom } from "./rng";

function ventsFrom(seed: number, count: number): string[] {
  let state = seed;
  const vents: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const draw = drawVent(state);
    state = draw.state;
    vents.push(draw.vent);
  }
  return vents;
}

describe("the seeded generator", () => {
  it("draws inside [0, 1) and carries its whole state", () => {
    let state = 1;
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      expect(Number.isInteger(draw.state)).toBe(true);
      state = draw.state;
    }
  });

  it("replays the same sequence from the same seed", () => {
    expect(ventsFrom(7, 40)).toEqual(ventsFrom(7, 40));
  });

  it("draws a different sequence from a different seed", () => {
    expect(ventsFrom(7, 40)).not.toEqual(ventsFrom(8, 40));
  });

  it("uses both vents across a wave, at roughly even odds", () => {
    const vents = ventsFrom(1, 400);
    const left = vents.filter((vent) => vent === "left").length;
    expect(left).toBeGreaterThan(140);
    expect(left).toBeLessThan(260);
    expect(ventsFrom(1, 40)).toContain("left");
    expect(ventsFrom(1, 40)).toContain("top");
  });
});
