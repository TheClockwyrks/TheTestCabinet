// screens/ending — how this group reaches a victory and a game over through the
// run's own transitions, and nothing about what either screen then reports.
//
// ONE item in this group is about an ENTRY EFFECT rather than about what a screen
// draws: `play-again-focused` asks what the highlight is "the moment either end
// screen opens". specs/instrumentation.md's `setScreen` "sets that field alone and
// runs no entry effect", so posing the screen would decide nothing — the highlight
// would be whatever the pose left. Both endings are therefore reached the way the
// run reaches them, and the two arrangements that reach them live here.
//
// THE END OF A RUN IS A TRANSITION, AND THE TWO ENDINGS ARE DIFFERENT ONES.
// specs/waves.md wins a run by clearing Wave `N` with at least one life left, and
// loses it the frame the lives reach `0` "whatever the phase". So the win is
// reached by clearing the final wave and the loss by a leak that takes the last
// life, and neither leg can stand in for the other.
//
// WHY BOTH LEGS END IN A LEAK. A leak needs no tower, no shot and no damage: a
// walker posed one tile from its exhaust walks out under its own power
// (specs/surge.md), so the transition rests on the run's own end conditions rather
// than on the combat model this group is not about. A kill would drag a tower, a
// fire rate and a per-shot damage into an item about a menu highlight.
//
// THIS FILE FIXES ARRANGEMENT ALONE. No figure a check asserts is decided here.
//
// Local to this group on purpose: `economy/payment.ts` reaches the same events for
// its own reasons and states them in its own terms, and neither group's
// arrangement is the other's to change.

import { COLS, RIGHT_EXHAUST_ROWS } from "../constants";
import { tileCentre } from "../geometry";
import {
  poseWalker,
  startRun,
  ticksFor,
  waveCountOf,
  type DifficultyName,
  type Harness,
  type ModeName,
} from "../harness";

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * specs/floor.md cuts the right exhaust into the casing beside `RIGHT_EXHAUST_ROWS`,
 * and a unit that entered at the left vent runs to the right exhaust for its whole
 * life (specs/mazing.md). A walker posed here therefore has one tile left to
 * travel, which is what keeps an item about a menu highlight from spending game
 * time on a walk specs/mazing.md already decides.
 */
const LEAK_TILE = { col: COLS - 2, row: RIGHT_EXHAUST_ROWS[1] } as const;

/**
 * How long the leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. A Mote's specified `60` logical units per second
 * covers the one `TILE` (`19`) it has left in about a third of a second, so three
 * seconds carries a build walking at a ninth of that speed out through the
 * opening.
 */
const LEAK_TICKS = ticksFor(3);

/**
 * The lives a won run is posed with.
 *
 * More than the one a leak costs and far short of a boundary: specs/waves.md is
 * explicit that a leak taking the lives to `0` on the final wave "ends the run in
 * loss, not in victory", and this drive must reach the victory, so the count has
 * room to lose one and still be well clear of zero.
 */
const LIVES_IN_HAND = 5;

/** A Mote walking under its own power with one tile left to its exhaust. */
function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCentre(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** Run until the leaker is gone from the roster, and say whether it went. */
async function runUntilLeaked(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    // Every frame, so the reading is taken on the transition rather than up to a
    // handful of frames past the screen the transition opened.
    poll: 1,
  });
  return swept.hit;
}

/**
 * Win the run: clear the final wave with lives still in hand, and say whether the
 * clear happened.
 *
 * The phase and the wave are posed, because `setPhase` and `setWave` run no entry
 * effect and both are the PRECONDITION here (specs/instrumentation.md). What is
 * reached through the game's own code is the CLEAR: specs/waves.md clears a wave
 * "on the frame in which its last live unit dies or leaks with none of it left to
 * release", so `wavePending` is `0` and the one posed walker is that last unit.
 */
export async function winTheRun(
  h: Harness,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): Promise<boolean> {
  startRun(h, mode, difficulty);
  h.debug.setWave(waveCountOf(mode, difficulty));
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  h.debug.setLives(LIVES_IN_HAND);
  poseLeaker(h);
  return runUntilLeaked(h);
}

/**
 * Lose the run: leak the last life away, and say whether the leak happened.
 *
 * One life is posed, so the single leak takes the lives to `0` and specs/waves.md
 * ends the run "at once, on the frame it happens". `wavePending` is `1`, so the
 * wave still has a unit to release and the leak does NOT also clear it — the run
 * ends on the loss alone rather than on two transitions landing together. Nothing
 * is released against the check either way, because `startRun` leaves the run's own
 * release of surge off (specs/instrumentation.md).
 */
export async function loseTheRun(h: Harness): Promise<boolean> {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(1);
  h.debug.setLives(1);
  poseLeaker(h);
  return runUntilLeaked(h);
}
