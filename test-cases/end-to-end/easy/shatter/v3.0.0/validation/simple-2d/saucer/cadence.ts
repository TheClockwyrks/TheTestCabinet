// saucer — the routes this group reaches the saucer's own clocks by.
// LOCAL TO THIS GROUP.
//
// The saucer is the one entity in this case whose scenarios are mostly WAITS: it
// arrives on a clock (`SAUCER_FIRST_DELAY`, then a gap), it leaves on a clock
// (`SAUCER_LIFETIME`), and it fires on a clock (`SAUCER_FIRE_INTERVAL`). Most of
// this group therefore wants the same three things — open a game with the game's
// OWN arrival running, catch the next arrival, catch the next shot — and each of
// them is a compound the debug surface deliberately does not carry, so it is
// built once here.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `saucer` waits on the saucer's cadence: every other group that wants a saucer
// poses one with `poseSaucer` and reads it standing still.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is a sampling stride, a
// ceiling on a wait, or a route; every tolerance stays in the check that asserts
// it, derived there from the figure `specs/saucer.md` fixes for it.

import { fail } from "../assert";
import { FIELD_W } from "../../src/constants";
import { secondsFor, startPlaying, ticksFor, type Harness } from "../harness";
import type {
  BulletSnapshot,
  SaucerSnapshot,
  ShatterSnapshot,
} from "../surface";

/* -------------------------------------------------------------------------- */
/* Opening a game the saucer arrives into                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pose a quiet, live field with the game's OWN saucer arrival running, from a
 * `reset` at `seed`.
 *
 * `reset` is what returns the arrival clock to the start of a game's cadence
 * (`specs/instrumentation.md`), which is the whole precondition of
 * `first-arrives-at-18s`: an arrival "18 seconds of game time after the game
 * begins" needs a game that has just begun. `startPlaying` then empties the
 * field, shuts the wave loop and the ship's contact test, and puts the screen on
 * `playing`, which is where `specs/saucer.md` says arrivals happen — and it
 * shuts the arrival gate too, which is why it is turned back on last. The gate
 * is this handful of checks' own requirement, so turning it on here is not a
 * widening of the isolation: it is the faculty under test.
 *
 * The field it leaves holds no rock, no bullet and no saucer, so the only thing
 * that can put a saucer on it is the build's own spawner.
 */
export function openSaucerGame(h: Harness, seed?: number): void {
  h.debug.reset(seed === undefined ? undefined : { seed });
  startPlaying(h);
  h.debug.setSaucerSpawning(true);
}

/* -------------------------------------------------------------------------- */
/* Catching an arrival                                                         */
/* -------------------------------------------------------------------------- */

/** How long a wait for an arrival runs before the scenario is unreachable. */
const ARRIVAL_CEILING_TICKS = ticksFor(90);

/** What a caught arrival is: the saucer as first seen, and when it was seen. */
export interface Arrival {
  saucer: SaucerSnapshot;
  /** Ticks of game time from the start of the wait to the sample that caught it. */
  ticks: number;
  snapshot: ShatterSnapshot;
}

/**
 * Run until a saucer is on the field whose id is not `afterId`, and report it.
 *
 * THE ID RATHER THAN THE PRESENCE, because a wait that began while the PREVIOUS
 * visit was still up would otherwise return that one: `specs/saucer.md` gives
 * every arrival a fresh id "distinct among every entity live at that moment", so
 * a different id is what makes this a different visit. `afterId` is `null` for
 * the first wait of a game, where any saucer at all is the arrival.
 *
 * `stride` is the caller's, because what a stride costs a reading differs by
 * check: the entry ROW is fixed for the first `SAUCER_WEAVE_INTERVAL` of a visit
 * and a coarse stride reads it exactly, while the entry COLUMN moves at
 * `SAUCER_SPEED` from the first tick and wants {@link closeUpFirstArrival}.
 */
export async function nextArrival(
  h: Harness,
  afterId: number | null,
  options: { stride?: number; maxTicks?: number } = {},
): Promise<Arrival> {
  const stride = options.stride ?? 1;
  const maxTicks = options.maxTicks ?? ARRIVAL_CEILING_TICKS;
  const found = await h.until(
    (snapshot) => snapshot.saucer !== null && snapshot.saucer.id !== afterId,
    { poll: stride, maxFrames: maxTicks },
  );
  if (!found.hit || found.snapshot.saucer === null) {
    fail(
      `a saucer arriving within ${secondsFor(maxTicks)} seconds of game ` +
        "time (specs/saucer.md)",
      afterId === null
        ? "no saucer ever appeared on the field"
        : `the saucer on the field was still visit ${afterId}`,
    );
  }
  return {
    saucer: found.snapshot.saucer,
    ticks: found.frames,
    snapshot: found.snapshot,
  };
}

/**
 * Catch a game's FIRST arrival on the tick it is first reported, whenever it
 * comes.
 *
 * TWO PASSES, AND THE REASON IS A READING THAT MOVES. A saucer crosses at
 * `SAUCER_SPEED` from the moment it enters, so a sweep that samples every
 * `stride` ticks reports an entry column up to `stride / TICK_HZ` seconds of
 * travel inside the edge it entered at — 14 units at a tenth of a second — and
 * `enters-at-an-edge` is a check on exactly that column.
 *
 * So the wait is run twice. The first pass strides coarsely and learns WHEN the
 * arrival happened; the second re-opens the same game at the same seed, skips in
 * one call to a stride short of that moment, and then samples every tick.
 * `specs/instrumentation.md` fixes that the same seed and the same elapsed game
 * time reach the same state every time, so the second pass replays the first,
 * and `snapshot` is a pure read that no number of extra calls can move.
 *
 * Nothing here assumes WHEN the arrival comes: the coarse pass finds it wherever
 * it is, and a build whose first saucer is late is caught just as exactly as one
 * whose first saucer is on time. That is `first-arrives-at-18s`'s requirement,
 * not this route's.
 */
export async function closeUpFirstArrival(
  h: Harness,
  seed: number,
  options: { stride?: number } = {},
): Promise<Arrival> {
  const stride = options.stride ?? 30;

  openSaucerGame(h, seed);
  const coarse = await nextArrival(h, null, { stride });

  openSaucerGame(h, seed);
  const lead = Math.max(0, coarse.ticks - stride);
  await h.advance(lead);
  const fine = await nextArrival(h, null, { stride: 1, maxTicks: stride * 2 });
  return { ...fine, ticks: lead + fine.ticks };
}

/** How near an edge a centre stands, across the seam, in logical units. */
export function edgeDistance(x: number): number {
  return Math.min(x, FIELD_W - x);
}

/* -------------------------------------------------------------------------- */
/* Catching a shot                                                             */
/* -------------------------------------------------------------------------- */

/** How long a wait for a shot runs before the scenario is unreachable. */
const SHOT_CEILING_TICKS = ticksFor(6);

/** A caught volley: the rounds that appeared, and the tick they appeared on. */
export interface Volley {
  /** Every saucer bullet on the field this tick that was not there the tick before. */
  fired: BulletSnapshot[];
  /** The saucer as it stood on that tick, or `null` if it had gone. */
  saucer: SaucerSnapshot | null;
  /** Ticks of game time from the start of the wait to the tick they appeared on. */
  ticks: number;
  snapshot: ShatterSnapshot;
}

/**
 * Run one tick at a time until the saucer-bullet roster gains a round it did not
 * hold the tick before, and report that tick.
 *
 * A ROUND IS NEW WHEN IT WAS NOT THERE LAST TICK, never when its id has not been
 * seen before. `specs/instrumentation.md` forbids reusing an id only "while any
 * live entity holds it", so a build whose ids come from a small pool may hand a
 * fresh round the id of one that has just expired, and a cumulative set of ids
 * would then never see it arrive.
 *
 * THE COMPARISON IS SEEDED FROM THE STATE THE SWEEP STARTS ON, read before a
 * single tick has run, so a round left in flight by an earlier sweep — or by the
 * visit before this one — is never mistaken for a shot this sweep saw fired.
 *
 * NO TICK IS EVER SKIPPED, so no check in this group can pass over a shot. The
 * whole sweep is one tick at a time: in-process stepping runs a tick of this
 * game in a fifth of a millisecond, so the sixty shots the three aim items read
 * — ninety-six seconds of game time — cost a couple of seconds sampled
 * exhaustively, and a lead-in that skipped most of each interval would buy
 * nothing while letting a build that fires faster than the lead-in have its
 * extra rounds passed over.
 */
export async function nextVolley(
  h: Harness,
  options: { maxTicks?: number } = {},
): Promise<Volley> {
  const maxTicks = options.maxTicks ?? SHOT_CEILING_TICKS;

  let held = h.snapshot().enemyBullets.map((round) => round.id);
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    const fired = snapshot.enemyBullets.filter(
      (round) => !held.includes(round.id),
    );
    if (fired.length > 0) {
      return { fired, saucer: snapshot.saucer, ticks: tick, snapshot };
    }
    held = snapshot.enemyBullets.map((round) => round.id);
  }
  fail(
    `a saucer firing within ${secondsFor(maxTicks)} seconds of game time ` +
      "(specs/saucer.md)",
    "no saucer bullet appeared on the field",
  );
}
