// Spectra — what a wave is made of, and the flyover a challenge stage is instead.

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  PRISM_ESCORTS,
  slotX,
} from "./constants";
import {
  MAX_ENTRY_GROUPS,
  buildChallenge,
  buildWave,
  entryGroups,
  filledColumns,
  filledRows,
  fluxCount,
  prismCount,
  waveSlots,
} from "./waves";
import { freshState } from "./game";

describe("a standard wave's layout", () => {
  it("fills a symmetric set of whole columns that grows with the stage", () => {
    for (const stage of [1, 3, 5, 9, 20]) {
      const columns = filledColumns(stage);
      const centre = (FORM_COLS - 1) / 2;
      for (const column of columns) {
        expect(columns).toContain(2 * centre - column);
      }
      expect(columns.length).toBeLessThanOrEqual(FORM_COLS);
      expect(filledRows(stage)).toBeLessThanOrEqual(FORM_ROWS);
    }
    expect(filledColumns(1).length).toBeLessThan(filledColumns(9).length);
  });

  it("is mirror-symmetric about the grid's centre at every stage", () => {
    for (const stage of [1, 2, 4, 7, 12]) {
      const filled = waveSlots(stage);
      const xs = filled.map((slot) => slotX(slot.col));
      for (const slot of filled) {
        const mirrored = 2 * FORM_CENTER_X - slotX(slot.col);
        expect(xs.some((x) => Math.abs(x - mirrored) < 1)).toBe(true);
      }
    }
  });

  it("holds both bands, at least two Fluxes and at least one Prism", () => {
    for (const stage of [1, 2, 5, 11]) {
      const filled = waveSlots(stage);
      const kinds = filled.map((slot) => slot.kind);
      expect(
        kinds.filter((kind) => kind === "flux").length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        kinds.filter((kind) => kind === "prism").length,
      ).toBeGreaterThanOrEqual(1);
      const shards = filled.filter((slot) => slot.kind === "shard");
      expect(shards.some((slot) => slot.band === "cyan")).toBe(true);
      expect(shards.some((slot) => slot.band === "magenta")).toBe(true);
      expect(shards.length).toBeGreaterThan(filled.length / 2);
    }
  });

  it("leans further on Fluxes and Prisms as the stage climbs", () => {
    expect(fluxCount(9)).toBeGreaterThan(fluxCount(1));
    expect(prismCount(9)).toBeGreaterThan(prismCount(1));
    expect(fluxCount(40)).toBe(fluxCount(19));
    expect(prismCount(40)).toBe(prismCount(13));
  });

  it("releases its drones in between two and eight groups", () => {
    for (const stage of [1, 2, 3, 5, 9, 14, 30]) {
      const groups = entryGroups(stage);
      expect(groups.length).toBeGreaterThanOrEqual(2);
      expect(groups.length).toBeLessThanOrEqual(MAX_ENTRY_GROUPS);
      // Every slot lands in exactly one group.
      const total = groups.reduce((sum, group) => sum + group.length, 0);
      expect(total).toBe(waveSlots(stage).length);
    }
  });

  it("gives every Prism its escorts, one of each band, in its own group", () => {
    for (const stage of [1, 5, 13]) {
      const groups = entryGroups(stage);
      const prismGroups = groups.filter((group) =>
        group.some((slot) => slot.kind === "prism"),
      );
      expect(prismGroups.length).toBe(prismCount(stage));
      for (const group of prismGroups) {
        const escorts = group.filter((slot) => slot.kind === "shard");
        expect(escorts).toHaveLength(PRISM_ESCORTS);
        expect(escorts.map((slot) => slot.band).sort()).toEqual([
          "cyan",
          "magenta",
        ]);
      }
    }
  });

  it("puts every drone above the field, unreleased, when the wave opens", () => {
    const state = freshState();
    buildWave(state, 1);
    expect(state.drones.length).toBe(waveSlots(1).length);
    for (const drone of state.drones) {
      expect(drone.phase).toBe("entering");
      expect(drone.released).toBe(false);
      expect(drone.y).toBeLessThan(FIELD_TOP);
      expect(drone.ofWave).toBe(true);
      expect(drone.path).not.toBeNull();
    }
    // Every drone of one group enters from the same side, so an escort stays
    // alongside the Prism it escorts.
    const byGroup = new Map<number, number[]>();
    for (const drone of state.drones) {
      byGroup.set(drone.group, [...(byGroup.get(drone.group) ?? []), drone.x]);
    }
    for (const xs of byGroup.values()) {
      const spread = Math.max(...xs) - Math.min(...xs);
      expect(spread).toBeLessThan(520);
    }
  });
});

describe("a challenge stage's flyover", () => {
  it("holds its stated groups, one band each, alternating", () => {
    const state = freshState();
    buildChallenge(state);
    expect(state.drones).toHaveLength(CHALLENGE_TOTAL);
    const bands: string[] = [];
    for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
      const members = state.drones.filter((drone) => drone.group === group);
      expect(members).toHaveLength(CHALLENGE_PER_GROUP);
      const unique = [...new Set(members.map((drone) => drone.band))];
      expect(unique).toHaveLength(1);
      bands.push(unique[0] as string);
    }
    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index]).not.toBe(bands[index - 1]);
    }
  });

  it("starts every drone off the field and marks it as the wave's", () => {
    const state = freshState();
    buildChallenge(state);
    for (const drone of state.drones) {
      expect(drone.challenge).toBe(true);
      expect(drone.ofWave).toBe(true);
      expect(drone.released).toBe(false);
      expect(drone.x < 0 || drone.x > 1280).toBe(true);
    }
  });
});
