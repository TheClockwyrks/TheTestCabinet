// What a wave is made of, and where it comes in from.

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_FIRST_DELAY,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  fluxWindow,
  slotX,
  slotY,
} from "./constants";
import { droneBand } from "./bands";
import { buildWave, waveCols, waveFluxes, wavePrisms, waveRows } from "./waves";
import { liveWave } from "./fixtures";

describe("a standard wave", () => {
  it("holds every drone entering, above the play field, at the moment it opens", () => {
    const state = liveWave();
    buildWave(state);
    expect(state.drones.length).toBeGreaterThan(0);
    for (const drone of state.drones) {
      expect(drone.phase).toBe("entering");
      expect(drone.y).toBeLessThan(FIELD_TOP);
    }
  });

  it("holds a Prism, at least two Fluxes, and Shards as the bulk of it", () => {
    const state = liveWave();
    buildWave(state);
    const kinds = state.drones.map((drone) => drone.kind);
    expect(
      kinds.filter((kind) => kind === "prism").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      kinds.filter((kind) => kind === "flux").length,
    ).toBeGreaterThanOrEqual(2);
    const shards = kinds.filter((kind) => kind === "shard").length;
    expect(shards).toBeGreaterThan(kinds.length - shards);
  });

  it("escorts each Prism with two Shards, one of each band", () => {
    const state = liveWave();
    buildWave(state);
    const prism = state.drones.find((drone) => drone.kind === "prism");
    expect(prism).toBeDefined();
    const escorts = state.drones.filter(
      (drone) =>
        drone.kind === "shard" &&
        drone.slotY === prism?.slotY &&
        Math.abs(drone.slotX - (prism?.slotX ?? 0)) <= 64 &&
        drone.entryGroup === prism?.entryGroup,
    );
    expect(escorts).toHaveLength(2);
    expect(new Set(escorts.map((drone) => drone.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
  });

  it("fills a layout mirror-symmetric about the grid's centre", () => {
    for (const stage of [1, 2, 4, 5, 7, 8]) {
      const state = liveWave();
      state.stage = stage;
      buildWave(state);
      const filled = new Set(
        state.drones.map((drone) => `${drone.slotX},${drone.slotY}`),
      );
      for (const drone of state.drones) {
        const mirrored = `${2 * FORM_CENTER_X - drone.slotX},${drone.slotY}`;
        expect(filled.has(mirrored)).toBe(true);
      }
    }
  });

  it("holds at least one drone of each effective band", () => {
    for (const stage of [1, 2, 4, 5]) {
      const state = liveWave();
      state.stage = stage;
      buildWave(state);
      const bands = new Set(
        state.drones.map((drone) => droneBand(drone, stage, false)),
      );
      expect(bands.has("cyan")).toBe(true);
      expect(bands.has("magenta")).toBe(true);
    }
  });

  it("stays inside the grid's capacity, and grows with the stage", () => {
    expect(waveCols(1)).toBeLessThanOrEqual(FORM_COLS);
    expect(waveRows(1)).toBeLessThanOrEqual(FORM_ROWS);
    expect(waveCols(9)).toBe(FORM_COLS);
    expect(waveRows(12)).toBe(FORM_ROWS);
    expect(waveCols(5)).toBeGreaterThan(waveCols(1));
    expect(waveFluxes(7)).toBeGreaterThan(waveFluxes(1));
    expect(wavePrisms(7)).toBeGreaterThan(wavePrisms(1));

    for (const stage of [1, 4, 7, 10, 13]) {
      const state = liveWave();
      state.stage = stage;
      buildWave(state);
      expect(state.drones.length).toBeLessThanOrEqual(FORM_COLS * FORM_ROWS);
      for (const drone of state.drones) {
        expect(drone.slotX).toBeGreaterThanOrEqual(slotX(0));
        expect(drone.slotX).toBeLessThanOrEqual(slotX(FORM_COLS - 1));
        expect(drone.slotY).toBeGreaterThanOrEqual(slotY(0));
        expect(drone.slotY).toBeLessThanOrEqual(slotY(FORM_ROWS - 1));
      }
    }
  });

  it("releases its drones in between two and eight consecutive groups", () => {
    for (const stage of [1, 2, 4, 5, 7]) {
      const state = liveWave();
      state.stage = stage;
      buildWave(state);
      const groups = [
        ...new Set(state.drones.map((drone) => drone.entryGroup)),
      ].sort((a, b) => a - b);
      expect(groups.length).toBeGreaterThanOrEqual(2);
      expect(groups.length).toBeLessThanOrEqual(8);
      expect(groups).toEqual(groups.map((_unused, index) => index));
    }
  });

  it("draws each Flux's starting phase from the game's own generator", () => {
    const state = liveWave();
    buildWave(state);
    const clocks = state.drones
      .filter((drone) => drone.kind === "flux")
      .map((drone) => drone.bandClock);
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    for (const clock of clocks) {
      expect(clock).toBeGreaterThanOrEqual(0);
      expect(clock).toBeLessThan(fluxWindow(1));
    }
    expect(new Set(clocks).size).toBeGreaterThan(1);
  });

  it("returns the wave's own clocks and schedule to their fresh values", () => {
    const state = liveWave();
    state.entryClock = 9;
    state.swayClock = 9;
    state.diveClock = 9;
    state.challengeHits = 9;
    buildWave(state);
    expect(state.entryClock).toBe(0);
    expect(state.swayClock).toBe(0);
    expect(state.diveClock).toBe(0);
    expect(state.diveTarget).toBe(DIVE_FIRST_DELAY);
    expect(state.challengeHits).toBe(0);
  });

  it("builds the same wave from the same seed", () => {
    const a = liveWave();
    const b = liveWave();
    buildWave(a);
    buildWave(b);
    expect(a.drones).toEqual(b.drones);
  });
});

describe("a challenge stage", () => {
  it("holds its five groups of eight, released on the same schedule", () => {
    const state = liveWave();
    state.stage = 3;
    buildWave(state);
    expect(state.drones).toHaveLength(CHALLENGE_TOTAL);
    for (let group = 0; group < CHALLENGE_GROUPS; group++) {
      const members = state.drones.filter(
        (drone) => drone.entryGroup === group,
      );
      expect(members).toHaveLength(CHALLENGE_PER_GROUP);
    }
  });

  it("carries one band per group, opposite to the group before it", () => {
    const state = liveWave();
    state.stage = 3;
    buildWave(state);
    const bands = Array.from({ length: CHALLENGE_GROUPS }, (_unused, group) => {
      const members = state.drones.filter(
        (drone) => drone.entryGroup === group,
      );
      const unique = new Set(members.map((drone) => drone.band));
      expect(unique.size).toBe(1);
      return members[0]?.band;
    });
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).not.toBe(bands[i - 1]);
    }
  });

  it("enters from alternate sides, outside the field", () => {
    const state = liveWave();
    state.stage = 3;
    buildWave(state);
    const left = state.drones.filter((drone) => drone.x < 0);
    const right = state.drones.filter((drone) => drone.x > 1280);
    expect(left.length + right.length).toBe(CHALLENGE_TOTAL);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
  });
});
