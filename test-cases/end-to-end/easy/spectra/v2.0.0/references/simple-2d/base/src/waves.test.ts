// What a wave is made of: the block's shape, its composition, its groups, and
// the challenge stage's five single-band sweeps.

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_FIRST_DELAY,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  PRISM_ESCORTS,
  SLOT_DX,
  fluxWindow,
  isChallengeStage,
} from "./constants";
import { bareOpeningState } from "./flow";
import { toSim, type Sim } from "./sim";
import {
  buildWave,
  entryStart,
  waveCols,
  waveFluxes,
  wavePrisms,
  waveRows,
} from "./waves";

/** How many times a rule is checked over freshly drawn waves. */
const DRAWS = 7;

/** A wave built for `stage`, on a fresh state. */
function wave(stage: number): Sim {
  const sim = toSim(bareOpeningState());
  sim.stage = stage;
  buildWave(sim);
  return sim;
}

/** Every standard stage in `1..last`, which is every stage but the challenges. */
function standardStages(last: number): number[] {
  const stages: number[] = [];
  for (let stage = 1; stage <= last; stage++) {
    if (!isChallengeStage(stage)) stages.push(stage);
  }
  return stages;
}

describe("a standard wave", () => {
  it("opens with every drone entering, above the play field", () => {
    const sim = wave(1);
    expect(sim.drones.length).toBeGreaterThan(8);
    for (const drone of sim.drones) {
      expect(drone.phase).toBe("entering");
      expect(drone.y).toBeLessThan(FIELD_TOP);
      expect(drone.phaseClock).toBe(0);
      expect(drone.travel).toBe(true);
      expect(drone.oscillation).toBe(true);
      expect(drone.fire).toBe(true);
      expect(drone.shellAlive).toBe(true);
    }
    expect(new Set(sim.drones.map((drone) => drone.id)).size).toBe(
      sim.drones.length,
    );
  });

  it("resets the wave's own clocks and schedule", () => {
    const sim = toSim(bareOpeningState());
    sim.entryClock = 5;
    sim.swayClock = 5;
    sim.diveClock = 5;
    sim.challengeHits = 9;
    buildWave(sim);
    expect(sim.entryClock).toBe(0);
    expect(sim.swayClock).toBe(0);
    expect(sim.diveClock).toBe(0);
    expect(sim.diveTarget).toBe(DIVE_FIRST_DELAY);
    expect(sim.challengeHits).toBe(0);
  });

  it("fills a block that is mirror-symmetric about the grid's centre", () => {
    for (const stage of [1, 2, 4, 7, 11]) {
      const slots = wave(stage).drones.map((drone) => drone.slotX);
      for (const x of slots) {
        const mirrored = 2 * FORM_CENTER_X - x;
        expect(slots.some((other) => Math.abs(other - mirrored) < 1e-9)).toBe(
          true,
        );
      }
    }
  });

  it("holds both bands, at least two Fluxes and at least one Prism", () => {
    for (const stage of [1, 2, 4, 7, 11]) {
      const drones = wave(stage).drones;
      expect(
        drones.filter((d) => d.kind === "flux").length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        drones.filter((d) => d.kind === "prism").length,
      ).toBeGreaterThanOrEqual(1);
      const shards = drones.filter((d) => d.kind === "shard");
      expect(shards.length).toBeGreaterThan(drones.length / 2);
      expect(new Set(shards.map((d) => d.band)).size).toBe(2);
    }
  });

  it("grows with the stage, up to the grid's capacity, and leans on Fluxes and Prisms", () => {
    // A challenge stage is not a wave and does not scale, so the growth is read
    // over the standard stages alone (`specs/stages.md`).
    let previous = 0;
    for (const stage of standardStages(14)) {
      const count = wave(stage).drones.length;
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeLessThanOrEqual(FORM_COLS * FORM_ROWS);
      previous = count;
    }
    expect(waveCols(1)).toBeLessThan(waveCols(9));
    expect(waveRows(1)).toBeLessThan(waveRows(9));
    expect(waveFluxes(1)).toBeLessThan(waveFluxes(9));
    expect(wavePrisms(1)).toBeLessThanOrEqual(wavePrisms(9));
  });

  it("numbers its entry groups consecutively, between two and eight", () => {
    for (const stage of [1, 2, 4, 7, 11]) {
      const groups = wave(stage).drones.map((drone) => drone.entryGroup);
      const distinct = [...new Set(groups)].sort((a, b) => a - b);
      expect(distinct[0]).toBe(0);
      expect(distinct).toEqual(distinct.map((_unused, i) => i));
      expect(distinct.length).toBeGreaterThanOrEqual(2);
      expect(distinct.length).toBeLessThanOrEqual(8);
    }
  });

  it("brings each Prism in with two Shards of opposite bands, in its own group", () => {
    for (const stage of [1, 7]) {
      const drones = wave(stage).drones;
      const prisms = drones.filter((d) => d.kind === "prism");
      for (const prism of prisms) {
        const escorts = drones.filter(
          (d) =>
            d.kind === "shard" &&
            d.entryGroup === prism.entryGroup &&
            Math.abs(d.slotX - prism.slotX) <= SLOT_DX,
        );
        expect(escorts.length).toBe(PRISM_ESCORTS);
        expect(new Set(escorts.map((d) => d.band)).size).toBe(2);
      }
    }
  });

  it("keeps every rule of a wave whichever way the draw falls", () => {
    for (let draw = 0; draw < DRAWS; draw += 1) {
      for (const stage of standardStages(11)) {
        const drones = wave(stage).drones;
        expect(drones.filter((d) => d.kind === "flux").length).toBe(
          waveFluxes(stage),
        );
        expect(drones.filter((d) => d.kind === "prism").length).toBe(
          wavePrisms(stage),
        );
        const shards = drones.filter((d) => d.kind === "shard");
        expect(shards.length).toBeGreaterThan(drones.length / 2);
        expect(new Set(shards.map((d) => d.band)).size).toBe(2);
        // Every slot of the rectangle is filled exactly once, so the block is
        // mirror-symmetric however the kinds fell across it.
        const slots = drones.map((d) => `${d.slotX},${d.slotY}`);
        expect(new Set(slots).size).toBe(slots.length);
        expect(slots.length).toBe(waveCols(stage) * waveRows(stage));
        for (const drone of drones) {
          const mirrored = 2 * FORM_CENTER_X - drone.slotX;
          expect(
            drones.some((other) => Math.abs(other.slotX - mirrored) < 1e-9),
          ).toBe(true);
        }
      }
    }
  });

  it("starts each Prism's escort within reach of the Prism itself", () => {
    for (let draw = 0; draw < DRAWS; draw += 1) {
      for (const stage of standardStages(11)) {
        const drones = wave(stage).drones;
        for (const prism of drones.filter((d) => d.kind === "prism")) {
          // Its own escort is the pair in the slots either side of it; two
          // Prisms stand far enough apart that neither picks up the other's.
          const escorts = drones.filter(
            (d) =>
              d.kind === "shard" &&
              d.entryGroup === prism.entryGroup &&
              Math.abs(d.slotX - prism.slotX) <= SLOT_DX,
          );
          expect(escorts).toHaveLength(PRISM_ESCORTS);
          expect(new Set(escorts.map((d) => d.band)).size).toBe(2);
          for (const escort of escorts) {
            expect(
              Math.hypot(escort.x - prism.x, escort.y - prism.y),
            ).toBeLessThan(320);
          }
        }
      }
    }
  });

  it("draws each Flux's starting clock inside its band window", () => {
    const first = wave(1)
      .drones.filter((d) => d.kind === "flux")
      .map((d) => d.bandClock);
    const again = wave(1)
      .drones.filter((d) => d.kind === "flux")
      .map((d) => d.bandClock);
    for (const clock of [...first, ...again]) {
      expect(clock).toBeGreaterThanOrEqual(0);
      expect(clock).toBeLessThan(fluxWindow(1));
    }
    expect(first).not.toEqual(again);
  });

  it("starts an entrance above the field, out to the drone's own side", () => {
    const left = entryStart({ slotX: 400, slotY: 140 });
    const right = entryStart({ slotX: 900, slotY: 140 });
    expect(left.y).toBeLessThan(FIELD_TOP);
    expect(right.y).toBeLessThan(FIELD_TOP);
    expect(left.x).toBeLessThan(400);
    expect(right.x).toBeGreaterThan(900);
    // A lower row starts higher above the field, so a group stacks up.
    expect(entryStart({ slotX: 400, slotY: 332 }).y).toBeLessThan(left.y);
  });
});

describe("a challenge stage", () => {
  it("holds five groups of eight, alternating bands from the first", () => {
    const drones = wave(3).drones;
    expect(drones).toHaveLength(CHALLENGE_TOTAL);
    for (let group = 0; group < CHALLENGE_GROUPS; group++) {
      const members = drones.filter((drone) => drone.entryGroup === group);
      expect(members).toHaveLength(CHALLENGE_PER_GROUP);
      expect(new Set(members.map((drone) => drone.band)).size).toBe(1);
      if (group > 0) {
        const before = drones.find((drone) => drone.entryGroup === group - 1);
        expect(members[0]?.band).not.toBe(before?.band);
      }
    }
  });

  it("enters each group abreast from alternate sides, outside the field", () => {
    const drones = wave(6).drones;
    for (let group = 0; group < CHALLENGE_GROUPS; group++) {
      const members = drones.filter((drone) => drone.entryGroup === group);
      expect(new Set(members.map((drone) => drone.x)).size).toBe(1);
      const x = members[0]?.x ?? 0;
      if (group % 2 === 0) expect(x).toBeLessThan(FIELD_LEFT);
      else expect(x).toBeGreaterThan(FIELD_RIGHT);
      // Every drone of the group is inside the field on the other axis, so a
      // group crosses in as one wave.
      for (const drone of members) {
        expect(drone.y).toBeGreaterThan(FIELD_TOP);
        expect(drone.slotX).toBe(x);
      }
    }
  });
});
