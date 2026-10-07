// cursor/bolt-cap — no more than MAX_BOLTS bolts are ever in flight at once.
//
// specs/cursor.md: "While the fire action is held, a bolt is fired whenever the
// cooldown is at `0` and fewer than `MAX_BOLTS` (`3`) bolts are in flight".
//
// THE HOLD RUNS FAR PAST THE CAP BINDING, which is what separates this point from
// `cursor.fire-interval`. At `FIRE_INTERVAL` the third bolt is up 0.30 s in, and
// the first does not leave the board until 0.68 s in, so from 0.30 s onward the
// gun is asking for a bolt it must be refused. Two seconds of held fire puts that
// refusal to the build a dozen times over, across the whole cycle of bolts
// leaving at the top and the roster refilling behind them.
//
// THE COLUMN IS EMPTY, so nothing resolves a bolt early and shortens the stretch
// over which the cap is under pressure: `startPlaying` clears the field and all
// three rosters, and the scenario adds nothing to them.
//
// THE ROSTER IS COUNTED EVERY FRAME. "In flight at once" is a statement about
// every instant of the hold, and a build that briefly put a fourth bolt up before
// one left the board would show it on one frame and on no other.
//
// THE LOWER READING IS A GUARD, NOT THE REQUIREMENT. The requirement is the
// ceiling, so a build that capped at two would satisfy it and be docked by
// `cursor.fire-interval` instead. What the second assertion refuses is a VACUOUS
// pass: a build that fired nothing at all would never exceed a cap either, and
// this point must not read that as compliance.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL, MAX_BOLTS } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key bound to `a` and `b`, the two fire actions (specs/controls.md). */
const FIRE_KEY = "Space";

/**
 * The hold, in frames of the harness's 120 Hz clock: two seconds.
 *
 * Thirteen `FIRE_INTERVAL`s, against a board a bolt crosses in 0.68 s, so the
 * cap is asked to refuse a bolt over and over while bolts leave at the top and
 * the roster refills.
 */
const HOLD_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never holds more than MAX_BOLTS bolts in flight under a long held fire", async () => {
  startPlaying(h);
  h.debug.setFireCooldown(0);

  let peak = 0;
  h.hold(FIRE_KEY);
  try {
    for (let frame = 0; frame < HOLD_TICKS; frame += 1) {
      await h.advance(1);
      const inFlight = h.snapshot().bolts.length;
      if (inFlight > peak) {
        peak = inFlight;
        // The still is rewritten each time the roster reaches a new high, so
        // what it ends up holding is the frame the build had the most bolts up
        // — the picture the review item asks for.
        captureStill(h, "cap");
      }
    }
  } finally {
    h.release(FIRE_KEY);
  }

  assertLessThanOrEqual(
    peak,
    MAX_BOLTS,
    `the most bolts the roster held at once over ${HOLD_TICKS} frames ` +
      `(${seconds(HOLD_TICKS)} s) of held ${FIRE_KEY}, against MAX_BOLTS ` +
      `(${MAX_BOLTS}) — specs/cursor.md fires only while fewer than that many ` +
      "are in flight",
  );
  assertGreaterThan(
    peak,
    0,
    `the most bolts the roster held at once over the hold — a gun that fired ` +
      `nothing across ${seconds(HOLD_TICKS)} s of held ${FIRE_KEY} would never ` +
      `exceed a cap either, and specs/cursor.md fires one every FIRE_INTERVAL ` +
      `(${FIRE_INTERVAL} s) while the action is held`,
  );
});
