// The two bands, and the one definition of an effective band applied twice.

import { describe, expect, it } from "vitest";
import { FLUX_SHIMMER, fluxHold, fluxWindow } from "./constants";
import {
  bulletBand,
  droneBand,
  inverted,
  isShimmering,
  opposite,
} from "./bands";
import {
  liveWave,
  poseDrone,
  poseEnemyBullet,
  posePlayerBullet,
} from "./fixtures";

describe("the two bands", () => {
  it("has exactly two, each the other's opposite", () => {
    expect(opposite("cyan")).toBe("magenta");
    expect(opposite("magenta")).toBe("cyan");
  });

  it("reads a Shard as the band it stores", () => {
    const state = liveWave();
    const shard = poseDrone(state, "shard", 400, 200, "magenta");
    expect(droneBand(shard, state.stage, false)).toBe("magenta");
  });

  it("reads a Prism's shell while the shell stands, and its core after", () => {
    const state = liveWave();
    const prism = poseDrone(state, "prism", 400, 200, "cyan");
    expect(droneBand(prism, state.stage, false)).toBe("cyan");
    prism.shellAlive = false;
    expect(droneBand(prism, state.stage, false)).toBe("magenta");
  });

  it("swaps a drone and an enemy bullet under an inversion, and never the player's", () => {
    const state = liveWave();
    const shard = poseDrone(state, "shard", 400, 200, "cyan");
    const mine = posePlayerBullet(state, 400, 400, "cyan");
    const theirs = poseEnemyBullet(state, 500, 300, "cyan");

    expect(droneBand(shard, state.stage, true)).toBe("magenta");
    expect(bulletBand(theirs, true)).toBe("magenta");
    expect(bulletBand(mine, true)).toBe("cyan");
  });

  it("cancels two swaps: a broken cyan Prism under an inversion reads cyan", () => {
    const state = liveWave();
    const prism = poseDrone(state, "prism", 400, 200, "cyan");
    prism.shellAlive = false;
    expect(droneBand(prism, state.stage, true)).toBe("cyan");
  });

  it("shimmers exactly while a Flux's clock has passed the stage's hold", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 400, 200, "cyan");
    const hold = fluxHold(state.stage);

    flux.bandClock = hold - 0.01;
    expect(isShimmering(flux, state.stage)).toBe(false);
    expect(droneBand(flux, state.stage, false)).toBe("cyan");

    flux.bandClock = hold;
    expect(isShimmering(flux, state.stage)).toBe(true);
    // Mid-shimmer it reads as the band it is moving toward.
    expect(droneBand(flux, state.stage, false)).toBe("magenta");
  });

  it("gives a window of the stage's hold plus the shimmer", () => {
    expect(fluxWindow(1)).toBeCloseTo(fluxHold(1) + FLUX_SHIMMER, 10);
  });

  it("never shimmers a Shard or a Prism", () => {
    const state = liveWave();
    const shard = poseDrone(state, "shard", 100, 100);
    const prism = poseDrone(state, "prism", 200, 100);
    shard.bandClock = 99;
    prism.bandClock = 99;
    expect(isShimmering(shard, state.stage)).toBe(false);
    expect(isShimmering(prism, state.stage)).toBe(false);
  });

  it("reports an inversion by the seconds it has left", () => {
    expect(inverted(0)).toBe(false);
    expect(inverted(0.001)).toBe(true);
  });
});
