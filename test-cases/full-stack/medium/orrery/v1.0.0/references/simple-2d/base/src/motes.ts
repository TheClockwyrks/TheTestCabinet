// Orrery — how a sigil reads a hex, and how it changes what rests there
// (specs/sigils.md "Terms used below", specs/field.md "Motes").
//
// Every sigil condition of specs/sigils.md is written over four readings of
// one hex, and they are written ONCE here so that twelve sigils, two
// apertures, and the debug surface all agree on what a hex holds:
//
//   * `moteAt` — the mote resting on a hex, a fixture included;
//   * `looseMoteAt` — the same, a fixture excluded, which is what every
//     condition but the `mirror` source asks for, since "a fixture satisfies
//     one condition only, the `mirror` source";
//   * `vacant` — the hex holds neither a mote nor a fixture;
//   * `unbonded` and `unheld` — the mote carries no filament, and no gripper
//     holds any mote of the mote's constellation.
//
// `unheld` is a question about the whole CONSTELLATION rather than the one
// mote: `sim.grips` records the single mote under each closed gripper, and the
// group is walked from `sim.filaments` at the moment of the question, so a
// gripper holding the far end of a chain holds every mote of it.
//
// The three edits below — spawn one mote, remove one mote, join a pair — are
// the only ways the sigil phase changes the field, so a filament is never left
// pointing at a mote that has been consumed.

import { constellationOf, filamentBetween } from "./constellation";
import { sameHex } from "./hex";
import type { Hex, MoteState, MoteType, SimState, W } from "./types";

/** Whether a mote is one of a wheel's six fixtures rather than a loose mote. */
export function isFixture(mote: W<MoteState>): boolean {
  return mote.wheel !== null;
}

/** The mote resting on a hex, a fixture included, or `null`. */
export function moteAt(sim: W<SimState>, cell: Hex): W<MoteState> | null {
  return sim.motes.find((mote) => sameHex(mote, cell)) ?? null;
}

/**
 * The loose mote resting on a hex, or `null`. A fixture reads as nothing here,
 * which is what makes it satisfy no sigil condition but the `mirror` source.
 */
export function looseMoteAt(sim: W<SimState>, cell: Hex): W<MoteState> | null {
  const mote = moteAt(sim, cell);
  return mote === null || isFixture(mote) ? null : mote;
}

/** Whether a hex holds neither a mote nor a fixture (specs/sigils.md). */
export function vacant(sim: W<SimState>, cell: Hex): boolean {
  return moteAt(sim, cell) === null;
}

/** Whether a mote carries no filament (specs/sigils.md). */
export function unbonded(sim: W<SimState>, mote: W<MoteState>): boolean {
  return !sim.filaments.some(
    (filament) => filament.a === mote.id || filament.b === mote.id,
  );
}

/**
 * Whether no gripper holds any mote of the mote's constellation
 * (specs/sigils.md). A gripper holding one mote of a group holds them all, so
 * the whole group is walked rather than the one mote asked about.
 */
export function unheld(sim: W<SimState>, mote: W<MoteState>): boolean {
  const group = constellationOf(sim, mote.id);
  return !sim.grips.some((grip) => group.includes(grip.mote));
}

/** Whether a loose mote on a hex is unbonded and unheld, as most sigils ask. */
export function freeMoteAt(sim: W<SimState>, cell: Hex): W<MoteState> | null {
  const mote = looseMoteAt(sim, cell);
  if (mote === null) return null;
  return unbonded(sim, mote) && unheld(sim, mote) ? mote : null;
}

/**
 * Add one mote of `type` resting on `cell`, unbonded and unheld, with a fresh
 * id. Callers check the hex is vacant first; nothing here does.
 */
export function addMote(
  sim: W<SimState>,
  cell: Hex,
  type: MoteType,
): W<MoteState> {
  const mote: W<MoteState> = {
    id: sim.nextMoteId,
    q: cell.q,
    r: cell.r,
    type,
    wheel: null,
  };
  sim.nextMoteId += 1;
  sim.motes.push(mote);
  return mote;
}

/** Remove one mote, and with it every filament and grip touching it. */
export function dropMote(sim: W<SimState>, moteId: number): void {
  sim.motes = sim.motes.filter((mote) => mote.id !== moteId);
  sim.filaments = sim.filaments.filter(
    (filament) => filament.a !== moteId && filament.b !== moteId,
  );
  sim.grips = sim.grips.filter((grip) => grip.mote !== moteId);
}

/**
 * Join two motes with one filament of `weight`, unless a filament already
 * joins that pair — at most one filament joins a given pair (specs/field.md).
 * Reports whether one was created.
 */
export function joinMotes(
  sim: W<SimState>,
  a: number,
  b: number,
  weight: number,
): boolean {
  if (a === b || filamentBetween(sim, a, b) !== null) return false;
  sim.filaments.push({ a, b, weight });
  return true;
}
