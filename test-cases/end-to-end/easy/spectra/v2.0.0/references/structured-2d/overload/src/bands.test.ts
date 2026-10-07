import { describe, expect, it } from "vitest";
import {
  bulletEffectiveBand,
  droneEffectiveBand,
  fluxWindowAt,
  inversionActive,
  opposite,
  shieldAbsorbs,
  shimmering,
  shotMatches,
  swapped,
} from "./bands";
import { FLUX_SHIMMER, INVERSION_TIME, fluxHold } from "./constants";
import { addDroneTo } from "./drones";
import { addBulletTo } from "./bullets";
import { titleState } from "./fixtures";

describe("the two bands", () => {
  it("has exactly two, each the other's opposite", () => {
    expect(opposite("cyan")).toBe("magenta");
    expect(opposite("magenta")).toBe("cyan");
  });

  it("composes swaps as toggles, so two cancel", () => {
    expect(swapped("cyan")).toBe("cyan");
    expect(swapped("cyan", true)).toBe("magenta");
    expect(swapped("cyan", true, true)).toBe("cyan");
    expect(swapped("cyan", true, true, true)).toBe("magenta");
  });
});

describe("effective band", () => {
  it("reads a Shard's stored band", () => {
    const state = titleState();
    const drone = addDroneTo(state, "shard", 300, 200);
    expect(droneEffectiveBand(drone, state)).toBe("cyan");
    drone.band = "magenta";
    expect(droneEffectiveBand(drone, state)).toBe("magenta");
  });

  it("flips a Prism whose shell is broken", () => {
    const state = titleState();
    const prism = addDroneTo(state, "prism", 300, 200);
    prism.shellAlive = false;
    expect(droneEffectiveBand(prism, state)).toBe("magenta");
  });

  it("flips a drone under an inversion", () => {
    const state = titleState();
    const drone = addDroneTo(state, "shard", 300, 200);
    state.inversion = INVERSION_TIME;
    expect(inversionActive(state)).toBe(true);
    expect(droneEffectiveBand(drone, state)).toBe("magenta");
  });

  it("cancels a broken shell against an inversion", () => {
    const state = titleState();
    const prism = addDroneTo(state, "prism", 300, 200);
    prism.shellAlive = false;
    state.inversion = INVERSION_TIME;
    expect(droneEffectiveBand(prism, state)).toBe("cyan");
  });

  it("flips an enemy bullet but never one of the player's", () => {
    const state = titleState();
    const mine = addBulletTo(state, 100, 100, "cyan", true, 0, -1);
    const theirs = addBulletTo(state, 100, 100, "cyan", false, 0, 1);
    state.inversion = INVERSION_TIME;
    expect(bulletEffectiveBand(mine, state)).toBe("cyan");
    expect(bulletEffectiveBand(theirs, state)).toBe("magenta");
  });
});

describe("a Flux's window", () => {
  it("is the hold plus the shimmer", () => {
    expect(fluxWindowAt(1)).toBeCloseTo(fluxHold(1) + FLUX_SHIMMER, 10);
  });

  it("shimmers only once the hold has run", () => {
    const state = titleState();
    const flux = addDroneTo(state, "flux", 300, 200);
    expect(shimmering(flux, 1)).toBe(false);
    flux.bandClock = fluxHold(1) - 0.01;
    expect(shimmering(flux, 1)).toBe(false);
    flux.bandClock = fluxHold(1);
    expect(shimmering(flux, 1)).toBe(true);
  });

  it("never shimmers on another kind", () => {
    const state = titleState();
    const shard = addDroneTo(state, "shard", 300, 200);
    shard.bandClock = 99;
    expect(shimmering(shard, 1)).toBe(false);
  });
});

describe("what a band decides", () => {
  it("destroys on a match and spares on a mismatch", () => {
    const state = titleState();
    const drone = addDroneTo(state, "shard", 300, 200);
    const match = addBulletTo(state, 300, 220, "cyan", true, 0, -1);
    const miss = addBulletTo(state, 300, 220, "magenta", true, 0, -1);
    expect(shotMatches(match, drone, state)).toBe(true);
    expect(shotMatches(miss, drone, state)).toBe(false);
  });

  it("destroys no shimmering Flux, of either band", () => {
    const state = titleState();
    const flux = addDroneTo(state, "flux", 300, 200);
    flux.bandClock = fluxHold(1);
    const cyan = addBulletTo(state, 300, 220, "cyan", true, 0, -1);
    const magenta = addBulletTo(state, 300, 220, "magenta", true, 0, -1);
    expect(shotMatches(cyan, flux, state)).toBe(false);
    expect(shotMatches(magenta, flux, state)).toBe(false);
  });

  it("absorbs an enemy bullet of the ship's own band alone", () => {
    const state = titleState();
    const same = addBulletTo(state, 640, 560, "cyan", false, 0, 1);
    const other = addBulletTo(state, 640, 560, "magenta", false, 0, 1);
    expect(shieldAbsorbs(same, state)).toBe(true);
    expect(shieldAbsorbs(other, state)).toBe(false);
  });
});
