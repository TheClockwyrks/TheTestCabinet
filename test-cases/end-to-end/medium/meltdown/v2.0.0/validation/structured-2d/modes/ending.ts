// Meltdown — modes/ending: how this group reaches the transitions that end a
// wave and end a run, and nothing about what any of them pays. GROUP-LOCAL.
//
// Four points in this group are about what happens ON a transition rather than
// about a field: the onslaught clearing (`hundred-has-no-build-phases`,
// `hundred-victory`), a build phase opening (`deep-pockets-no-interest`), and a
// single leak ending a run (`sudden-death-ends-on-one-leak`). None of those can
// be posed — `specs/instrumentation.md` says `setScreen` and `setPhase` "set that
// field alone and run no entry effect", and `setLives` "triggers no game over:
// the loss belongs to the leak path" — so each is reached the way the run
// reaches it, and the one arrangement all four stand on lives here.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own beside the figure
// `specs/modes.md`, `specs/waves.md` or `specs/economy.md` fixes for it.
//
// WHY A LEAK IS THIS GROUP'S ENDING. `specs/waves.md` clears a wave "on the frame
// in which its last live unit dies or leaks with none of it left to release", so
// either event reaches the transition, and a leak reaches it without a tower: no
// range, no fire clock, no per-shot damage and no heat stand between the
// arrangement and the transition, so a point in this group grades the mode rather
// than the defence. `specs/economy.md` also gives a leak no payment of its own —
// "A unit that reaches its exhaust pays no bounty" — so a leak-cleared wave moves
// the money by the clear's own figures and by nothing else.
//
// Local to this group on purpose: `economy/payment.ts` reaches the same
// transitions for its own figures, and neither file belongs in the shared
// harness, which fixes no scenario a single group uses.

import { COLS, RIGHT_EXHAUST_ROWS } from "../../src/constants";
import { poseWalker, ticksFor, tileCenter, type Harness } from "../harness";

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * `specs/floor.md` puts the right exhaust on tiles `(49, 16)` through
 * `(49, 19)`, and a unit entering at the left vent is assigned the right exhaust
 * for its whole life. A walker posed here therefore has one tile left to travel
 * and reaches its exhaust in a fraction of a second, which is what keeps a point
 * in this group from spending game time on a walk across the floor that
 * `specs/mazing.md` already decides.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how
 * far a build may miss a figure by. A Mote's specified `60` logical units per
 * second (`specs/surge.md`) covers the one `TILE` (`19`) it has left in about a
 * third of a second, so three seconds carries a build walking at a ninth of that
 * speed out through the opening, and the transition this group reads rests on the
 * unit reaching its exhaust rather than on how fast it got there.
 */
export const LEAK_TICKS = ticksFor(3);

/**
 * A Mote walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * The Mote is the type `modes.sudden-death-ends-on-one-leak` names, and its leak
 * value is the smallest in the game (`1` life, `specs/surge.md`), so a run that
 * survives this leak survives the cheapest one there is. Nothing is posed beyond
 * the entry and the position: motion stays on and the route is recomputed from
 * the tile the position falls in (`specs/instrumentation.md`), so the walk out is
 * the game's own.
 */
export function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCenter(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** Run until the leaker is gone from the roster, and say whether it went. */
export async function runUntilLeaked(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  return swept.hit;
}

/**
 * Pose the end of wave `wave`: the wave phase, on that wave, with nothing left
 * to release.
 *
 * The shape a clear is reached from. `specs/waves.md` clears a wave on the frame
 * its last live unit goes "with none of it left to release", so `wavePending` is
 * `0` and the one unit the caller poses is the wave's last. The phase is posed
 * rather than reached because `setPhase` runs no entry effect: it is the
 * precondition, and the CLEAR is what the drive then reaches through the game's
 * own transition.
 *
 * It poses no unit. A caller adds exactly the one whose going clears the wave.
 */
export function poseWaveEnd(h: Harness, wave: number): void {
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
}
