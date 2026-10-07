// Orrery — filaments, and the constellations they make (specs/field.md
// "Filaments and constellations").
//
// A filament is a rigid link between two motes on adjacent hexes, carrying a
// `weight` of `1` or `3`, and at most one filament joins a given pair. A
// constellation is the MAXIMAL group of motes those links connect: a lone mote
// with no filament is a constellation of one, removing a filament splits the
// group it joined, and adding one merges two.
//
// Membership is DERIVED, never stored. `sim.filaments` is the only record of
// what is joined to what, so every question about a group is answered by
// walking the links as they stand at the moment of the question — which is
// what lets a `sunder` at a boundary split a group that an arm was carrying a
// cycle earlier, with nothing to keep in step.

import type { SimFilament, SimState } from "./types";

/** The filament joining two motes, in either direction, or `null`. */
export function filamentBetween(
  sim: SimState,
  a: number,
  b: number,
): SimFilament | null {
  return (
    sim.filaments.find(
      (filament) =>
        (filament.a === a && filament.b === b) ||
        (filament.a === b && filament.b === a),
    ) ?? null
  );
}

/** Whether any filament joins two motes. */
export function linked(sim: SimState, a: number, b: number): boolean {
  return filamentBetween(sim, a, b) !== null;
}

/** Every mote one filament joins to `mote`, in filament order. */
export function filamentNeighbors(sim: SimState, mote: number): number[] {
  const found: number[] = [];
  for (const filament of sim.filaments) {
    if (filament.a === mote) found.push(filament.b);
    else if (filament.b === mote) found.push(filament.a);
  }
  return found;
}

/**
 * The constellation `mote` belongs to: its own id and every mote reachable
 * from it through filaments, in ascending id order. A mote the run no longer
 * holds carries a constellation of itself alone, which is what an id read off
 * a stale grip resolves to.
 */
export function constellationOf(sim: SimState, mote: number): number[] {
  const seen = new Set<number>([mote]);
  const queue: number[] = [mote];
  while (queue.length > 0) {
    const current = queue.pop() as number;
    for (const next of filamentNeighbors(sim, current)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Every constellation on the field, each as ascending mote ids, ordered by the
 * first mote of `sim.motes` that belongs to it. Every mote appears in exactly
 * one group.
 */
export function constellations(sim: SimState): number[][] {
  const placed = new Set<number>();
  const groups: number[][] = [];
  for (const mote of sim.motes) {
    if (placed.has(mote.id)) continue;
    const group = constellationOf(sim, mote.id);
    for (const id of group) placed.add(id);
    groups.push(group);
  }
  return groups;
}

/** Whether two motes belong to one constellation. */
export function sameConstellation(
  sim: SimState,
  a: number,
  b: number,
): boolean {
  return a === b || constellationOf(sim, a).includes(b);
}
