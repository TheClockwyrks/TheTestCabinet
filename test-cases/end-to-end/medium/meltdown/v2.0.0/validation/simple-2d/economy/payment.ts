// economy/payment — how this group reaches the events its figures are paid on,
// and nothing about what any of them pays. CASE-PROVIDED.
//
// specs/economy.md pays money and score on four events, and every one of them is
// a TRANSITION rather than a field: a unit's hp reaching `0`, a unit reaching its
// exhaust, a wave clearing, and a send. None of them can be posed — `setUnitHp`
// "does not kill the unit: death belongs to the damage path", and
// `setScreen`/`setPhase` "set that field alone and run no entry effect"
// (specs/instrumentation.md) — so each is reached the way the run reaches it, and
// the three arrangements that reach them live here.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own beside the figure
// specs/economy.md fixes for it.
//
// WHY A LEAK IS THIS GROUP'S CLEAR. specs/waves.md clears a wave "on the frame in
// which its last live unit dies or leaks with none of it left to release", so
// either event reaches the transition. A leak is what the clear points use,
// because specs/economy.md gives a leak no payment of its own: "A unit that
// reaches its exhaust pays no bounty", and it scores nothing. So a leak-cleared
// wave moves the money and the score by the clear's own figures and by nothing
// else, where a kill-cleared one would move both by the bounty as well and every
// clear point would be reading two figures at once.
//
// Local to this group on purpose. Nothing outside `economy/` reaches a payment
// event, so none of these belongs in the shared harness.

import { COLS, RIGHT_EXHAUST_ROWS } from "../constants";
import { tileCentre } from "../geometry";
import {
  poseTarget,
  posePinnedTower,
  poseWalker,
  ticksFor,
  type Harness,
  type SurgeType,
} from "../harness";

/* ---- The kill ------------------------------------------------------------ */

/** The Arc's footprint top-left: open floor, well clear of every opening. */
export const GUN = { col: 20, row: 10 } as const;

/**
 * The tile the mark stands on: three tiles right of the Arc's anchor, so it is
 * off the footprint and comfortably inside the Arc's `6.0`-tile range measured
 * from the footprint's centre (specs/combat.md).
 */
export const MARK = { col: 23, row: 10 } as const;

/**
 * The hp the mark is posed with: the least a live unit can carry.
 *
 * A kill is what these points are about, and the smallest possible target is what
 * makes the kill follow from the shot landing rather than from any figure
 * specs/combat.md gives the shot. specs/combat.md's "a unit at `0` hp is removed
 * on that frame" is what turns one shot into the death.
 */
export const MARK_HP = 1;

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. An Arc at its specified `2.0` shots per second
 * lands its first shot half a second in (specs/combat.md), so six seconds is a
 * dozen intervals: a build whose fire rate or per-shot damage is off still removes
 * a single hp inside the window, and the kill this group reads therefore rests on
 * the shot landing at all rather than on how hard or how often it lands.
 */
export const KILL_TICKS = ticksFor(6);

/**
 * An Arc at `GUN` whose guns run and whose heat cannot move, and its id.
 *
 * `setTowerThermal(id, false)` holds the tower's part in the heat model while it
 * goes on acquiring targets and firing at its rate (specs/instrumentation.md), so
 * the heat that scales its damage stays exactly where it is posed and no trip can
 * interrupt the drive. The heat posed is `0`, the heat a placed tower starts at,
 * because nothing in this group is about heat.
 */
export function poseGun(h: Harness): number {
  return posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
}

/**
 * Pose a `type` of one hp on `MARK`, holding its tile, and hand back its id.
 *
 * Motion off is what keeps the reading unambiguous: the mark cannot walk out of
 * the Arc's range, and it cannot reach an exhaust and leak instead of dying,
 * which would pay a different figure entirely.
 */
export function poseMark(h: Harness, type: SurgeType): number {
  return poseTarget(h, type, MARK.col, MARK.row, MARK_HP);
}

/**
 * Run until the surge roster is empty, and say whether it emptied.
 *
 * The caller reads its own figure across this drive. Whether the roster emptied is
 * handed back so a point can state, as its precondition, that the event it is
 * about actually happened.
 */
export async function runUntilGone(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 4,
  });
  return swept.hit;
}

/* ---- The leak ------------------------------------------------------------ */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * specs/floor.md puts the right exhaust on tiles `(49, 16)` through `(49, 19)`,
 * and a unit entering at the left vent is assigned the right exhaust for its whole
 * life. So a walker posed here has one tile left to travel and reaches its exhaust
 * in a fraction of a second, which is what keeps a leak point from spending game
 * time on a walk across the floor that specs/mazing.md already decides.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance. A Mote's specified `60` logical units per
 * second covers the one `TILE` (`19`) it has left in about a third of a second, so
 * three seconds carries a build walking at a ninth of that speed out through the
 * opening, and the leak this group reads rests on the unit reaching its exhaust
 * rather than on how fast it got there.
 */
export const LEAK_TICKS = ticksFor(3);

/**
 * A Mote walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (specs/instrumentation.md), so the walk out is the game's own.
 */
export function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCentre(LEAK_TILE.col, LEAK_TILE.row);
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

/* ---- The wave clear ------------------------------------------------------ */

/**
 * Pose the end of wave `wave`: the wave phase, on that wave, with nothing left to
 * release.
 *
 * The shape a clear is reached from. specs/waves.md clears a wave on the frame its
 * last live unit goes "with none of it left to release", so `wavePending` is `0`
 * and the one unit the caller poses is the wave's last. The phase is posed rather
 * than reached because `setPhase` runs no entry effect: it is the precondition,
 * and the CLEAR is what the drive then reaches through the game's own transition.
 *
 * It poses no unit. A caller adds exactly the one whose going clears the wave.
 */
export function poseWaveEnd(h: Harness, wave: number): void {
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
}
