// Orrery — one cycle of the machine, and the boundary sequence that closes it
// (specs/simulation.md).
//
// A cycle is resolved ATOMICALLY, at the moment it begins. Fetch reads every
// tape cell, drops open, grabs close, and the motion step is planned in full:
// where every mote lands, and whether any of the eight sample fractions of
// specs/simulation.md finds two motes within `2 * MOTE_COLLIDE_R`. What the
// clock then does is sweep `sim.fraction` from `0` to `1` so the frame can draw
// the motion, and apply the plan's landing when it reaches the boundary.
//
// Resolving the cycle at its start rather than at its end is what makes the
// run frame-division independent, which specs/instrumentation.md requires: the
// outcome is a function of the machine and the cycle number, never of how many
// frames happened to cross the cycle. A faulting cycle is frozen at the sample
// fraction the fault names, whatever frame reached it.
//
// SEAM: this module is the simulation phase of this build. The three functions
// below carry the shape the clock in `src/sim.ts` drives them through — a plan
// with an optional fault and a landing, and a boundary sequence run before the
// area bank and the completion check — and the fetch, motion, collision, and
// sigil rules are written into them there. Until then a cycle plans no motion,
// so a run advances its clock and nothing else moves.

import { hexCenter } from "./hex";
import type { CyclePlan, MoteState, PartState, SimState } from "./types";
import type { SimContext } from "./simcontext";

/** A cycle that does nothing and faults on nothing. */
export const IDLE_CYCLE: CyclePlan = {
  fault: null,
  land: (): void => {},
};

/**
 * Resolve the cycle `ctx.sim.cycle` is about to run: fetch, drops, grabs, and
 * the motion sweep with its torn check and its collision samples.
 */
export function planCycle(_ctx: SimContext): CyclePlan {
  return IDLE_CYCLE;
}

/**
 * The transforming, binding, sundering, and voiding waves in order, then every
 * set, then every rise, each in reading order (specs/simulation.md "The sigil
 * phase"). Run at every boundary, the settle included, before the area bank
 * and the completion check.
 */
export function runSigilsSetsAndRises(_ctx: SimContext): void {}

/**
 * Where a mote is DRAWN at the run's current fraction: its hex at the last
 * boundary, carried along the motion its cycle imposes (specs/simulation.md
 * "Motion and carrying"). A mote held by nothing rests on its hex for the whole
 * cycle, which is what every mote does until the motion step lands.
 */
export function moteStagePosition(
  mote: MoteState,
  _sim: SimState,
  _parts: readonly PartState[],
): { x: number; y: number } {
  return hexCenter({ q: mote.q, r: mote.r });
}
