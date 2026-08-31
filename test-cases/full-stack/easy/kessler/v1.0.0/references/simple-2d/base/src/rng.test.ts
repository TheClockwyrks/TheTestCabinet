// The seeded stream of specs/pods.md: mulberry32, numbers in [0, 1), and the
// exact draw sequence a seed pins.

import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { podKindForRoll } from "./figures";

describe("mulberry32", () => {
  it("yields the pinned sequence for seed 1", () => {
    const rng = mulberry32(1);
    expect(rng()).toBeCloseTo(0.6270739406, 10);
    expect(rng()).toBeCloseTo(0.0027357212, 10);
    expect(rng()).toBeCloseTo(0.52744704, 10);
    expect(rng()).toBeCloseTo(0.9810509675, 10);
  });

  it("yields numbers in [0, 1)", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("reproduces the same stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it("yields different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("podKindForRoll", () => {
  it("maps the u2 bands of specs/pods.md, boundaries exact", () => {
    expect(podKindForRoll(0)).toBe("widen");
    expect(podKindForRoll(0.2499)).toBe("widen");
    expect(podKindForRoll(0.25)).toBe("multiball");
    expect(podKindForRoll(0.4499)).toBe("multiball");
    expect(podKindForRoll(0.45)).toBe("shield");
    expect(podKindForRoll(0.6499)).toBe("shield");
    expect(podKindForRoll(0.65)).toBe("pierce");
    expect(podKindForRoll(0.7999)).toBe("pierce");
    expect(podKindForRoll(0.8)).toBe("narrow");
    expect(podKindForRoll(0.9999)).toBe("narrow");
  });
});
