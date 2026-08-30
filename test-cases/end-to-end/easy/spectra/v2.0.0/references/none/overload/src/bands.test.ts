// Spectra — the effective band, which is one definition applied twice.

import { describe, expect, it } from "vitest";
import {
  bulletEffectiveBand,
  droneEffectiveBand,
  foldSwaps,
  inversionActive,
} from "./bands";
import { fluxHold } from "./constants";
import type { Bullet, Drone } from "./types";

function drone(shape: Partial<Drone>): Drone {
  return {
    id: 1,
    kind: "shard",
    band: "cyan",
    x: 0,
    y: 0,
    phase: "formation",
    phaseTime: 0,
    slotX: 0,
    slotY: 0,
    group: 0,
    released: true,
    path: null,
    pathDist: 0,
    bandClock: 0,
    shellAlive: true,
    diveShots: 0,
    fireArmed: false,
    invertedThisDive: false,
    travel: true,
    oscillation: true,
    fire: true,
    charge: 0,
    challenge: false,
    ofWave: false,
    plunge: false,
    ...shape,
  };
}

function bullet(shape: Partial<Bullet>): Bullet {
  return {
    id: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    band: "cyan",
    friendly: true,
    ...shape,
  };
}

describe("foldSwaps", () => {
  it("takes the parity of the swaps, not their sum", () => {
    expect(foldSwaps("cyan")).toBe("cyan");
    expect(foldSwaps("cyan", true)).toBe("magenta");
    expect(foldSwaps("cyan", true, true)).toBe("cyan");
    expect(foldSwaps("cyan", true, true, true)).toBe("magenta");
    expect(foldSwaps("magenta", false, false)).toBe("magenta");
  });
});

describe("droneEffectiveBand", () => {
  it("reads a Shard as its stored band", () => {
    expect(droneEffectiveBand(drone({}), false, 1)).toBe("cyan");
  });

  it("reads a broken Prism as the opposite of its stored band", () => {
    const prism = drone({ kind: "prism", shellAlive: false });
    expect(droneEffectiveBand(prism, false, 1)).toBe("magenta");
  });

  it("swaps under an inversion, and cancels two swaps", () => {
    expect(droneEffectiveBand(drone({}), true, 1)).toBe("magenta");
    const broken = drone({ kind: "prism", shellAlive: false });
    expect(droneEffectiveBand(broken, true, 1)).toBe("cyan");
  });

  it("reads a shimmering Flux as the band it is moving toward", () => {
    const holding = drone({ kind: "flux", bandClock: 0 });
    const shimmering = drone({ kind: "flux", bandClock: fluxHold(1) + 0.1 });
    expect(droneEffectiveBand(holding, false, 1)).toBe("cyan");
    expect(droneEffectiveBand(shimmering, false, 1)).toBe("magenta");
  });

  it("takes the stage into account for where a shimmer begins", () => {
    const clocked = drone({ kind: "flux", bandClock: 1.1 });
    // At stage 1 the hold is 1.6, so 1.1 is still held; at stage 20 it is 1.0.
    expect(droneEffectiveBand(clocked, false, 1)).toBe("cyan");
    expect(droneEffectiveBand(clocked, false, 20)).toBe("magenta");
  });
});

describe("bulletEffectiveBand", () => {
  it("never swaps one of the player's bullets", () => {
    expect(bulletEffectiveBand(bullet({}), true)).toBe("cyan");
  });

  it("swaps an enemy bullet under an inversion", () => {
    expect(bulletEffectiveBand(bullet({ friendly: false }), true)).toBe(
      "magenta",
    );
    expect(bulletEffectiveBand(bullet({ friendly: false }), false)).toBe(
      "cyan",
    );
  });
});

describe("inversionActive", () => {
  it("is exactly whether any seconds are left", () => {
    expect(inversionActive(0)).toBe(false);
    expect(inversionActive(0.01)).toBe(true);
  });
});
