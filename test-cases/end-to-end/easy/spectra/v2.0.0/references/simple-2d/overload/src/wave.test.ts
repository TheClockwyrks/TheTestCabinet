// What a wave is made of, before a frame has run over it.

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  DIVE_FIRST_DELAY,
  FIELD_TOP,
  FORM_CENTER_X,
  slotX,
  slotY,
} from "./constants";
import { emptyArt } from "./assets";
import { openingState } from "./flow";
import {
  buildWave,
  freeFormationSlot,
  waveFluxPairs,
  wavePrisms,
} from "./wave";
import { toSim, type Sim } from "./sim";

function simAt(stage: number, seed = 1): Sim {
  const sim = toSim(openingState(emptyArt()));
  sim.stage = stage;
  sim.rngState = seed;
  buildWave(sim);
  return sim;
}

/** The layout, as the pairs a comparison can be made over. */
function layoutOf(sim: Sim): string[] {
  return sim.drones.map(
    (drone) =>
      `${drone.kind}:${drone.band}:${drone.slotX}:${drone.slotY}:${drone.entryGroup}`,
  );
}

describe("a standard wave", () => {
  it("starts every drone above the play field, entering", () => {
    const sim = simAt(1);
    expect(sim.drones.length).toBeGreaterThan(0);
    for (const drone of sim.drones) {
      expect(drone.phase).toBe("entering");
      expect(drone.y).toBeLessThan(FIELD_TOP);
      expect(drone.charge).toBe(0);
      expect(drone.shellAlive).toBe(true);
      expect(drone.travel).toBe(true);
      expect(drone.oscillation).toBe(true);
      expect(drone.fire).toBe(true);
    }
  });

  it("starts the wave's own clocks fresh", () => {
    const sim = simAt(1);
    expect(sim.entryClock).toBe(0);
    expect(sim.swayClock).toBe(0);
    expect(sim.diveClock).toBe(0);
    expect(sim.diveTarget).toBe(DIVE_FIRST_DELAY);
    expect(sim.challengeHits).toBe(0);
  });

  it("fills a mirror-symmetric block", () => {
    for (const stage of [1, 2, 4, 5, 7, 8]) {
      const filled = simAt(stage).drones.map((drone) => drone.slotX);
      for (const x of filled) {
        const mirror = 2 * FORM_CENTER_X - x;
        expect(
          filled.some((candidate) => Math.abs(candidate - mirror) < 1),
        ).toBe(true);
      }
    }
  });

  it("holds Shards of both bands, at least two Fluxes and at least one Prism", () => {
    for (const stage of [1, 2, 4, 5, 7]) {
      const drones = simAt(stage).drones;
      const shards = drones.filter((drone) => drone.kind === "shard");
      const fluxes = drones.filter((drone) => drone.kind === "flux");
      const prisms = drones.filter((drone) => drone.kind === "prism");
      expect(fluxes.length).toBeGreaterThanOrEqual(2);
      expect(prisms.length).toBeGreaterThanOrEqual(1);
      expect(shards.length).toBeGreaterThan(fluxes.length + prisms.length);
      expect(shards.some((drone) => drone.band === "cyan")).toBe(true);
      expect(shards.some((drone) => drone.band === "magenta")).toBe(true);
    }
  });

  it("releases its drones in between two and eight groups", () => {
    for (const stage of [1, 2, 4, 5, 7, 10]) {
      const groups = new Set(simAt(stage).drones.map((d) => d.entryGroup));
      expect(groups.size).toBeGreaterThanOrEqual(2);
      expect(groups.size).toBeLessThanOrEqual(8);
    }
  });

  it("grows with the stage and leans further on Fluxes and Prisms", () => {
    const total = (stage: number): number => simAt(stage).drones.length;
    expect(total(4)).toBeGreaterThan(total(1));
    expect(total(7)).toBeGreaterThan(total(4));
    expect(waveFluxPairs(7)).toBeGreaterThan(waveFluxPairs(1));
    expect(wavePrisms(9)).toBeGreaterThan(wavePrisms(1));
  });

  it("sends each Prism in with two Shards of opposite bands", () => {
    const sim = simAt(1);
    const prism = sim.drones.find((drone) => drone.kind === "prism");
    expect(prism).toBeDefined();
    const escorts = sim.drones.filter(
      (drone) =>
        drone.kind === "shard" && drone.entryGroup === prism?.entryGroup,
    );
    expect(escorts).toHaveLength(2);
    expect(new Set(escorts.map((drone) => drone.band)).size).toBe(2);
    for (const escort of escorts) {
      expect(Math.abs(escort.x - (prism?.x ?? 0))).toBeLessThan(320);
    }
  });

  it("builds the same wave from one seed and a different one from another", () => {
    expect(layoutOf(simAt(1, 7))).toEqual(layoutOf(simAt(1, 7)));
    expect(layoutOf(simAt(1, 7))).not.toEqual(layoutOf(simAt(1, 8)));
    expect(layoutOf(simAt(4, 7))).not.toEqual(layoutOf(simAt(4, 8)));
  });

  it("puts every slot on the grid the geometry fixes", () => {
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let col = 0; col < 9; col++) xs.add(slotX(col));
    for (let row = 0; row < 5; row++) ys.add(slotY(row));
    for (const drone of simAt(7).drones) {
      expect(xs.has(drone.slotX)).toBe(true);
      expect(ys.has(drone.slotY)).toBe(true);
    }
  });
});

describe("a challenge wave", () => {
  it("sends its groups of one band each, alternating", () => {
    const sim = simAt(3);
    expect(sim.drones).toHaveLength(CHALLENGE_TOTAL);
    for (let group = 0; group < CHALLENGE_GROUPS; group++) {
      const members = sim.drones.filter((drone) => drone.entryGroup === group);
      expect(members).toHaveLength(CHALLENGE_PER_GROUP);
      const bands = new Set(members.map((drone) => drone.band));
      expect(bands.size).toBe(1);
      expect([...bands][0]).toBe(group % 2 === 0 ? "cyan" : "magenta");
    }
  });

  it("starts every drone off the field and out of the play area", () => {
    for (const drone of simAt(3).drones) {
      expect(drone.y).toBeLessThan(FIELD_TOP);
      expect(drone.x < 0 || drone.x > 1280).toBe(true);
      expect(drone.slotX).toBe(drone.x);
      expect(drone.slotY).toBe(drone.y);
    }
  });
});

describe("a free formation slot", () => {
  it("is one nothing stands in, nearest the point asked for", () => {
    const sim = simAt(1);
    const slot = freeFormationSlot(sim, slotX(4), slotY(4));
    const held = sim.drones.some(
      (drone) => drone.slotX === slot.x && drone.slotY === slot.y,
    );
    expect(held).toBe(false);
  });
});
