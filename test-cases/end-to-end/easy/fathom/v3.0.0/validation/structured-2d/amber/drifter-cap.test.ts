// amber/drifter-cap — the maze holds no more than DRIFTER_MAX drifters.
//
// specs/gameplay.md: "The cadence tops the maze up to `DRIFTER_MAX` (`2`)
// drifters at once and stops there, so a maze already holding `DRIFTER_MAX` of
// them admits none until one is eaten." Two readings, and a build can break
// either alone: a ceiling that does not hold turns a maze left alone into a field
// of free bonuses, and a ceiling that never lifts stops the second amber light
// arriving for the rest of the dive however many the player eats.
//
// THE TWO DRIFTERS ARE SPAWNED RATHER THAN WAITED FOR. `spawnDrifter` adds one
// "whatever the cadence is doing and whatever the ceiling would otherwise allow"
// (specs/instrumentation.md), so the maze is standing at its ceiling in a couple
// of calls instead of fifty seconds. Both are spawned with their minds off, which
// holds each exactly where it was put while leaving it eaten by a forager that
// reaches it — so the one this check later eats is on a tile it chose, and neither
// can wander onto the forager and lift the ceiling by accident.
//
// THE CEILING IS TESTED AT THE INSTANT AN ADMISSION WOULD FIRE, not across a
// stretch of play in which one might have. specs/state.md puts `drifterIn` on the
// snapshot — the countdown that admits the next drifter — and
// specs/instrumentation.md's `setDrifterIn` poses it, so this check stands the
// countdown at `0` on a maze already holding DRIFTER_MAX, runs the game on, and
// reads the maze again. It does that CHECKPOINTS times over. Sitting through two
// and a half cadences asks the same question and answers it worse: it depends on
// where in its interval the build's own clock happened to be, and it costs seven
// and a half thousand ticks of a full board simulated and drawn to ask it.
//
// AND THE CEILING LIFTS ON A BITE. The drifter is held where it stands and the
// forager put on its tile, which is the contact specs/gameplay.md defines; the
// countdown is then posed a short lead from expiry, and the maze is back at
// DRIFTER_MAX when it runs out. That is "admits none UNTIL one is eaten" read in
// the other direction, and it is the same admission the cadence would have made.
//
// THE BOARD IS THE GAME'S OWN, because the cadence runs on the maze the build laid
// out and its condition is that "plankton remain" there. The roster is taken off
// it, which specs/instrumentation.md's `clearPredators` does without touching the
// plankton: a released hunter would otherwise reach the forager and end the dive
// under the measurement.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { DRIFTER_INTERVAL, DRIFTER_MAX } from "../constants";
import { spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { corridorTiles } from "../maze";
import { ticksFor } from "../harness";

/** How many times the ceiling is stood at the instant an admission would fire. */
const CHECKPOINTS = 4;

/**
 * Ticks the game runs on with the countdown standing at `0`, in ticks.
 *
 * A quarter of a second, thirty ticks of the real cadence code running with
 * nothing left on its clock. A build that admits regardless of the ceiling
 * admits on the first of them.
 */
const HOLD_TICKS = ticksFor(0.25);

/** Ticks allowed for the bite once the forager stands on a drifter's tile. */
const EAT_TICKS = ticksFor(0.25);

/**
 * The countdown the bite is taken under, in seconds.
 *
 * The full `DRIFTER_INTERVAL`, so nothing is admitted while the forager crosses
 * onto the drifter's tile and the reading below is the bite alone.
 */
const BITE_LEAD = DRIFTER_INTERVAL;

/** The lead the refill is then posed with, in seconds. */
const REFILL_LEAD = 0.5;

/** How far past that lead the refill is waited for, in ticks. */
const REFILL_TICKS = ticksFor(REFILL_LEAD + 1);

/** How often that wait reads, in ticks. */
const REFILL_POLL = 6;

/** Ticks of live play the clip carries once the maze is back at its ceiling. */
const CLIP_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("admits none while the maze holds DRIFTER_MAX, and one once it does not", async () => {
  const opened = startPlaying(h);
  /** The tile the forager opens on, which it goes back to after the bite. */
  const home = { tx: opened.forager.tx, ty: opened.forager.ty };
  h.debug.clearPredators();
  h.debug.clearDrifters();
  assertGreaterThan(
    opened.planktonRemaining,
    0,
    "plankton left in the maze the cadence is timed on, which is the " +
      "condition specs/gameplay.md admits a drifter under",
  );

  // Two tiles well apart on the board the game laid out, so neither drifter is
  // standing where the forager already is.
  const corridors = corridorTiles(opened);
  assertGreaterThan(
    corridors.length,
    DRIFTER_MAX,
    "corridor tiles on the board to stand the ceiling's worth of drifters on",
  );
  const stands = [
    corridors[Math.floor(corridors.length / 3)],
    corridors[Math.floor((2 * corridors.length) / 3)],
  ];
  for (const tile of stands) {
    await spawnDrifter(h, tile, { mind: false });
  }
  assertEqual(
    h.snapshot().drifters.length,
    DRIFTER_MAX,
    "the drifters standing on the board before the ceiling is watched",
  );

  // The ceiling, held against a spent countdown as many times over.
  for (let checkpoint = 1; checkpoint <= CHECKPOINTS; checkpoint += 1) {
    h.debug.setDrifterIn(0);
    await h.advance(HOLD_TICKS);
    const seen = h.snapshot();
    assertEqual(
      seen.drifters.length,
      DRIFTER_MAX,
      `the drifters in the maze ${String(HOLD_TICKS)} ticks after the ` +
        `cadence's countdown was stood at 0, on checkpoint ` +
        `${String(checkpoint)} of ${String(CHECKPOINTS)}, with the maze ` +
        `already holding DRIFTER_MAX (${String(DRIFTER_MAX)}) of them ` +
        "(specs/gameplay.md)",
    );
  }

  // And the ceiling lifts on the bite. The countdown is stood a whole interval
  // off first, so nothing is admitted under the bite itself and the reading is
  // the contact alone.
  h.debug.setDrifterIn(BITE_LEAD);
  const eaten = h.snapshot().drifters[0];
  h.debug.setForagerTile(eaten.tx, eaten.ty);
  await h.advance(EAT_TICKS);
  assertEqual(
    h.snapshot().drifters.length,
    DRIFTER_MAX - 1,
    "the drifters left once the forager stood on one of their tiles",
  );
  // And back where it began, off the tile the bite was taken on. specs/gameplay.md
  // admits the next drifter "at the den gate", and a forager left standing there
  // would eat each admission on the tick it arrived — so the refill this point is
  // waiting for would never be seen however long it waited.
  h.debug.setForagerTile(home.tx, home.ty);

  const refilled = await captureReplay(h, "cap", async () => {
    h.debug.setDrifterIn(REFILL_LEAD);
    const seen = await h.until((s) => s.drifters.length >= DRIFTER_MAX, {
      maxFrames: REFILL_TICKS,
      poll: REFILL_POLL,
    });
    await h.advance(CLIP_TICKS);
    return seen;
  });
  assertEqual(
    refilled.hit,
    true,
    `the maze was topped back up to DRIFTER_MAX (${String(DRIFTER_MAX)}) once ` +
      `one had been eaten, on the countdown posed ${String(REFILL_LEAD)} s ` +
      `from expiry — a maze under the ceiling admits again, on the ` +
      `DRIFTER_INTERVAL (${String(DRIFTER_INTERVAL)} s) cadence ` +
      "(specs/gameplay.md)",
  );
});
