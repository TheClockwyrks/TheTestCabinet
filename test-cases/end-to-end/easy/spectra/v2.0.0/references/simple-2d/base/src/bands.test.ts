// The effective-band rule: one definition, applied once per swap that holds, as
// toggles rather than additively — so two swaps cancel.

import { describe, expect, it } from "vitest";
import {
  bulletBand,
  droneBand,
  inverted,
  isShimmering,
  opposite,
} from "./bands";
import { fluxHold } from "./constants";

const shard = {
  kind: "shard",
  band: "cyan",
  bandClock: 0,
  shellAlive: true,
} as const;
const prism = {
  kind: "prism",
  band: "cyan",
  bandClock: 0,
  shellAlive: true,
} as const;

describe("the two bands", () => {
  it("has exactly two, and one opposite each", () => {
    expect(opposite("cyan")).toBe("magenta");
    expect(opposite("magenta")).toBe("cyan");
    expect(opposite(opposite("cyan"))).toBe("cyan");
  });

  it("reads a plain drone as its stored band", () => {
    expect(droneBand(shard, 1, false)).toBe("cyan");
    expect(droneBand({ ...shard, band: "magenta" }, 1, false)).toBe("magenta");
  });

  it("reads a broken Prism as its core, and cancels that against an inversion", () => {
    expect(droneBand(prism, 1, false)).toBe("cyan");
    expect(droneBand({ ...prism, shellAlive: false }, 1, false)).toBe(
      "magenta",
    );
    expect(droneBand(prism, 1, true)).toBe("magenta");
    // Two toggles compose to none.
    expect(droneBand({ ...prism, shellAlive: false }, 1, true)).toBe("cyan");
  });

  it("shimmers a Flux only inside the shimmer part of its window", () => {
    const flux = {
      kind: "flux",
      band: "cyan",
      bandClock: 0,
      shellAlive: true,
    } as const;
    expect(isShimmering(flux, 1)).toBe(false);
    expect(isShimmering({ ...flux, bandClock: fluxHold(1) - 0.01 }, 1)).toBe(
      false,
    );
    expect(isShimmering({ ...flux, bandClock: fluxHold(1) }, 1)).toBe(true);
    // A later stage holds for less, so the same clock shimmers there.
    expect(isShimmering({ ...flux, bandClock: fluxHold(20) }, 20)).toBe(true);
    // Neither of the other kinds ever shimmers.
    expect(isShimmering({ ...shard, bandClock: 99 }, 1)).toBe(false);
  });

  it("reads a shimmering Flux as the band it is moving toward", () => {
    const flux = {
      kind: "flux",
      band: "cyan",
      bandClock: fluxHold(1) + 0.1,
      shellAlive: true,
    } as const;
    expect(droneBand(flux, 1, false)).toBe("magenta");
    expect(droneBand(flux, 1, true)).toBe("cyan");
  });

  it("swaps an enemy bullet under an inversion and never the player's", () => {
    const enemy = { band: "cyan", friendly: false } as const;
    const own = { band: "cyan", friendly: true } as const;
    expect(bulletBand(enemy, false)).toBe("cyan");
    expect(bulletBand(enemy, true)).toBe("magenta");
    expect(bulletBand(own, true)).toBe("cyan");
  });

  it("calls an inversion active only while seconds are left", () => {
    expect(inverted(0)).toBe(false);
    expect(inverted(0.01)).toBe(true);
  });
});
