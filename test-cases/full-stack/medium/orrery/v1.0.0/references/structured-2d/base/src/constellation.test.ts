import { describe, expect, it } from "vitest";

import {
  constellationOf,
  constellations,
  filamentBetween,
  filamentNeighbors,
  linked,
  sameConstellation,
} from "./constellation";
import { emptySim } from "./state";
import type { SimState } from "./types";

/** A run holding `count` motes in a row, with the filaments `links` names. */
function field(count: number, links: [number, number, number][]): SimState {
  const sim = emptySim(1);
  for (let i = 0; i < count; i += 1) {
    sim.motes.push({ id: i + 1, q: i, r: 0, type: "dust", wheel: null });
  }
  sim.nextMoteId = count + 1;
  for (const [a, b, weight] of links) sim.filaments.push({ a, b, weight });
  return sim;
}

describe("filaments and constellations (specs/field.md)", () => {
  it("finds a filament in either direction and none where there is none", () => {
    const sim = field(3, [[1, 2, 1]]);
    expect(filamentBetween(sim, 1, 2)).toEqual({ a: 1, b: 2, weight: 1 });
    expect(filamentBetween(sim, 2, 1)?.weight).toBe(1);
    expect(filamentBetween(sim, 2, 3)).toBeNull();
    expect(linked(sim, 1, 2)).toBe(true);
    expect(linked(sim, 1, 3)).toBe(false);
  });

  it("carries a triune filament's weight of three", () => {
    const sim = field(2, [[1, 2, 3]]);
    expect(filamentBetween(sim, 1, 2)?.weight).toBe(3);
  });

  it("makes a lone mote a constellation of one", () => {
    const sim = field(3, []);
    expect(constellationOf(sim, 2)).toEqual([2]);
    expect(constellations(sim)).toEqual([[1], [2], [3]]);
  });

  it("takes the maximal group the filaments connect", () => {
    const sim = field(4, [
      [1, 2, 1],
      [2, 3, 3],
    ]);
    expect(constellationOf(sim, 3)).toEqual([1, 2, 3]);
    expect(constellationOf(sim, 1)).toEqual([1, 2, 3]);
    expect(constellations(sim)).toEqual([[1, 2, 3], [4]]);
    expect(filamentNeighbors(sim, 2)).toEqual([1, 3]);
  });

  it("splits the group when a filament is removed", () => {
    const sim = field(3, [
      [1, 2, 1],
      [2, 3, 1],
    ]);
    expect(constellationOf(sim, 1)).toEqual([1, 2, 3]);
    sim.filaments = sim.filaments.filter((filament) => filament.b !== 3);
    expect(constellationOf(sim, 1)).toEqual([1, 2]);
    expect(constellationOf(sim, 3)).toEqual([3]);
  });

  it("merges two groups when a filament joins them", () => {
    const sim = field(4, [
      [1, 2, 1],
      [3, 4, 1],
    ]);
    expect(sameConstellation(sim, 2, 3)).toBe(false);
    sim.filaments.push({ a: 2, b: 3, weight: 1 });
    expect(constellationOf(sim, 4)).toEqual([1, 2, 3, 4]);
    expect(sameConstellation(sim, 2, 3)).toBe(true);
    expect(sameConstellation(sim, 1, 1)).toBe(true);
  });
});
