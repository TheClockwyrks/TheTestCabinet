// Orrery — rises and sets: where a reagent enters the field and where a
// finished constellation leaves it (specs/sigils.md "Rises and sets").
//
// The two are mirror images. A rise watches its footprint for VACANCY and, when
// every hex of it is vacant, lays the reagent down at its placed pose: one new
// mote per pattern mote, one filament per pattern filament, unheld. A set
// watches the field for a CONSTELLATION that is exactly its product at its own
// placed pose, and consumes the whole of it, raising its tally.
//
// ACCEPTANCE IS EXACT, AND IT IS POSITIONAL. "Exactly the placed pattern" is
// read here as all four of: one mote of the pattern's type on each pattern hex,
// one filament of the pattern's weight for each pattern filament, no further
// mote, and no further filament. A constellation resting one hex off the set's
// hexes, or at another rotation, is a different arrangement and is not
// accepted — which is why the match below compares hexes rather than shapes.
//
// A repeating product accepts a chain instead: `k` copies of the placed
// pattern, `k >= REPEAT_MIN`, copy `i` translated by `i` times the placed
// repeat vector, consecutive copies joined by the placed link filament and its
// translates, and nothing further. `k` is never searched for — the
// constellation's mote count divided by the pattern's fixes it, and the whole
// chain is then checked against that one `k`.
//
// A fixture satisfies no condition of specs/sigils.md but the `mirror` source,
// so no set accepts a group holding one, and a fixture on a rise's footprint
// leaves that hex not vacant.

import { CUES, REPEAT_MIN } from "./constants";
import { constellations, filamentBetween } from "./constellation";
import { addHex, hexCenter, rotateHex, scaleHex } from "./hex";
import { addMote, dropMote, isFixture, joinMotes, vacant } from "./motes";
import { apertureMolecule, moleculeHexes, placeHex } from "./parts";
import type { SimContext } from "./simcontext";
import type {
  Hex,
  Molecule,
  MoteType,
  PartState,
  PatternFilament,
  SimState,
} from "./types";

/** A hex as a map key, so a placed pattern can be looked up by position. */
function keyOf(cell: Hex): string {
  return `${cell.q},${cell.r}`;
}

/** One mote of a placed pattern: the hex it stands on and its type. */
interface PlacedMote {
  readonly hex: Hex;
  readonly type: MoteType;
}

/** One filament of a placed pattern: its two hexes and its weight. */
interface PlacedFilament {
  readonly a: Hex;
  readonly b: Hex;
  readonly weight: number;
}

/** A whole placed chain: every mote of every copy, and every filament. */
interface PlacedChain {
  readonly motes: PlacedMote[];
  readonly filaments: PlacedFilament[];
}

/** A pattern filament placed at a pose and shifted by whole repeat vectors. */
function placeFilament(
  filament: PatternFilament,
  anchor: Hex,
  rotation: number,
  shift: Hex,
): PlacedFilament {
  return {
    a: addHex(placeHex(filament.a, anchor, rotation), shift),
    b: addHex(placeHex(filament.b, anchor, rotation), shift),
    weight: filament.weight,
  };
}

/**
 * The chain of `copies` copies of `molecule` at this pose: copy `i` is the
 * placed pattern translated by `i` times the placed repeat vector, carrying its
 * own pattern filaments, and consecutive copies are joined by the placed link
 * filament and its translates. One copy of a plain product is the pattern
 * itself.
 */
export function placedChain(
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
  copies: number,
): PlacedChain {
  const repeat = molecule.repeat;
  const vector =
    repeat === null ? { q: 0, r: 0 } : rotateHex(repeat.vector, rotation);
  const motes: PlacedMote[] = [];
  const filaments: PlacedFilament[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    const shift = scaleHex(vector, copy);
    for (const mote of molecule.motes) {
      motes.push({
        hex: addHex(placeHex(mote, anchor, rotation), shift),
        type: mote.type,
      });
    }
    for (const filament of molecule.filaments) {
      filaments.push(placeFilament(filament, anchor, rotation, shift));
    }
    if (repeat !== null && copy < copies - 1) {
      filaments.push(placeFilament(repeat.link, anchor, rotation, shift));
    }
  }
  return { motes, filaments };
}

/**
 * How many copies of the placed product the constellation `group` is, and
 * `null` when the set does not accept it (specs/sigils.md "set"). A plain
 * product accepts one copy alone; a repeating one accepts `k >= REPEAT_MIN`.
 */
export function acceptedCopies(
  sim: SimState,
  group: readonly number[],
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
): number | null {
  const size = molecule.motes.length;
  if (size === 0 || group.length % size !== 0) return null;
  const copies = group.length / size;
  if (molecule.repeat === null ? copies !== 1 : copies < REPEAT_MIN) {
    return null;
  }
  // A constellation any gripper holds is not accepted, however it matches.
  if (sim.grips.some((grip) => group.includes(grip.mote))) return null;

  // Where each mote of the group rests. A fixture belongs to no product.
  const byHex = new Map<string, number>();
  for (const id of group) {
    const mote = sim.motes.find((entry) => entry.id === id);
    if (mote === undefined || isFixture(mote)) return null;
    byHex.set(keyOf(mote), id);
  }

  const chain = placedChain(molecule, anchor, rotation, copies);
  // One mote of the pattern's type on each pattern hex. The chain's hexes are
  // as many as the group's motes, so the group holds no further mote either.
  if (
    new Set(chain.motes.map((mote) => keyOf(mote.hex))).size !== group.length
  ) {
    return null;
  }
  for (const wanted of chain.motes) {
    const id = byHex.get(keyOf(wanted.hex));
    if (id === undefined) return null;
    const mote = sim.motes.find((entry) => entry.id === id);
    if (mote === undefined || mote.type !== wanted.type) return null;
  }

  // One filament of the pattern's weight for each pattern filament, and no
  // further filament: a constellation's filaments are exactly those touching it.
  const carried = sim.filaments.filter(
    (filament) => group.includes(filament.a) || group.includes(filament.b),
  );
  if (carried.length !== chain.filaments.length) return null;
  for (const wanted of chain.filaments) {
    const a = byHex.get(keyOf(wanted.a));
    const b = byHex.get(keyOf(wanted.b));
    if (a === undefined || b === undefined) return null;
    const filament = filamentBetween(sim, a, b);
    if (filament === null || filament.weight !== wanted.weight) return null;
  }
  return copies;
}

/**
 * Evaluate every placed set, in the order given (specs/simulation.md "The sigil
 * phase"). An accepted constellation is consumed whole, and the set's tally
 * rises by `1` for a plain product and by `k` for a repeating one.
 */
export function runSets(ctx: SimContext, sets: readonly PartState[]): void {
  const { sim } = ctx;
  let consumed = false;
  for (const part of sets) {
    const molecule = apertureMolecule(part, ctx.challenge);
    const index = part.index;
    if (molecule === null || index === null) continue;
    const anchor = { q: part.q, r: part.r };
    let took = false;
    for (const group of constellations(sim)) {
      const copies = acceptedCopies(
        sim,
        group,
        molecule,
        anchor,
        part.rotation,
      );
      if (copies === null) continue;
      for (const mote of group) dropMote(sim, mote);
      sim.tallies[index] = (sim.tallies[index] ?? 0) + copies;
      took = true;
    }
    // The delivery effect plays on each set that took at least one accepted
    // constellation at this boundary, on its anchor hex (specs/assets.md).
    if (took) ctx.effect("deliver", hexCenter(anchor));
    consumed = consumed || took;
  }
  if (consumed) ctx.cue(CUES.constellation);
}

/**
 * Spawn every placed rise whose footprint is wholly vacant, in the order given.
 * The reagent appears at the placed pose: one new mote per pattern mote and one
 * filament per pattern filament, unheld.
 */
export function runRises(ctx: SimContext, rises: readonly PartState[]): void {
  const { sim } = ctx;
  for (const part of rises) {
    const molecule = apertureMolecule(part, ctx.challenge);
    if (molecule === null) continue;
    const anchor = { q: part.q, r: part.r };
    const cells = moleculeHexes(molecule, anchor, part.rotation);
    if (!cells.every((cell) => vacant(sim, cell))) continue;
    spawnReagent(sim, molecule, anchor, part.rotation);
  }
}

/** Lay one reagent down at a placed pose: its motes, then its filaments. */
export function spawnReagent(
  sim: SimState,
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
): void {
  const byHex = new Map<string, number>();
  for (const mote of molecule.motes) {
    const cell = placeHex(mote, anchor, rotation);
    byHex.set(keyOf(cell), addMote(sim, cell, mote.type).id);
  }
  for (const filament of molecule.filaments) {
    const a = byHex.get(keyOf(placeHex(filament.a, anchor, rotation)));
    const b = byHex.get(keyOf(placeHex(filament.b, anchor, rotation)));
    if (a === undefined || b === undefined) continue;
    joinMotes(sim, a, b, filament.weight);
  }
}
