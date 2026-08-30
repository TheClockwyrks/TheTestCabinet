// cursor/fire-interval — a held fire action produces a bolt every FIRE_INTERVAL.
//
// specs/cursor.md: "The cursor carries a fire cooldown in seconds, which counts
// down against the delta time of each update and rests at `0`. While the fire
// action is held, a bolt is fired whenever the cooldown is at `0` and fewer than
// `MAX_BOLTS` bolts are in flight, and firing sets the cooldown to
// `FIRE_INTERVAL` (`0.15` s). A held fire action therefore produces a bolt every
// `FIRE_INTERVAL` until the cap binds."
//
// THE WINDOW STOPS SHORT OF THE CAP BINDING, and that is what keeps this point
// and `cursor.bolt-cap` apart. Three bolts fit inside 0.35 s at the stated
// interval — at 0, 0.15 and 0.30 s — and a fourth would need 0.45 s, so
// `MAX_BOLTS` (3) never refuses one inside the reading. A longer hold would
// measure the cap instead, and the cap is its own item.
//
// NOTHING RESOLVES A BOLT INSIDE THE WINDOW EITHER. `startPlaying` empties the
// field and the rosters, and the board is only 640 units tall: from the cursor's
// muzzle a bolt at `BOLT_SPEED` needs 0.68 s to reach `BOARD_Y` and leave, twice
// the window. So the three bolts fired are three bolts still in flight, and the
// intervals are read off the frames they appeared on rather than off a roster
// that was quietly draining.
//
// THE INTERVALS ARE READ, NOT THE COUNT ALONE. A build that fired faster than the
// specification would put its three bolts up early and then be refused by the
// cap, so a count on its own would call it correct; a build that fired more
// slowly would put up fewer than three. Both readings are taken, so each wrong
// model is named by the number it produces.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL, MAX_BOLTS } from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
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
 * The hold, in frames of the harness's 120 Hz clock: 0.35 s.
 *
 * `FIRE_INTERVAL` is 18 frames of this clock exactly, so the three bolts the
 * window holds fall on frames 1, 19 and 37 of a build that honours it, and the
 * fourth would fall on 55 — thirteen frames past the end of the hold.
 */
const HOLD_TICKS = ticksFor(0.35);

/** Bolts the window holds at the stated interval. */
const EXPECTED_BOLTS = 3;

/**
 * The review item's margin on each interval, in seconds: ten percent of
 * `FIRE_INTERVAL`, which is 0.015 s.
 *
 * Just under two frames of the harness's clock, so a build whose cooldown is
 * decremented a frame earlier or later in its update than the reference's is not
 * docked for it, and a build a fifth off the stated interval is.
 */
const INTERVAL_TOLERANCE = FIRE_INTERVAL * 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts up three bolts a FIRE_INTERVAL apart while the fire key is held", async () => {
  startPlaying(h);
  h.debug.setFireCooldown(0);

  // Every bolt is identified by the id its roster entry carries, so the frame a
  // bolt APPEARED on is read rather than inferred from a roster length that
  // another bolt leaving could have moved.
  const seen = new Set<number>();
  const firedOn: number[] = [];
  h.hold(FIRE_KEY);
  try {
    for (let frame = 1; frame <= HOLD_TICKS; frame += 1) {
      await h.advance(1);
      for (const bolt of h.snapshot().bolts) {
        if (seen.has(bolt.id)) continue;
        seen.add(bolt.id);
        firedOn.push(frame);
      }
    }
  } finally {
    h.release(FIRE_KEY);
  }
  captureStill(h, "burst");

  assertLength(
    firedOn,
    EXPECTED_BOLTS,
    `bolts fired over ${HOLD_TICKS} frames (${seconds(HOLD_TICKS)} s) of held ` +
      `${FIRE_KEY} from a zero cooldown — specs/cursor.md fires one every ` +
      `FIRE_INTERVAL (${FIRE_INTERVAL} s), and MAX_BOLTS (${MAX_BOLTS}) does ` +
      "not bind inside the window",
  );

  for (let i = 1; i < firedOn.length; i += 1) {
    const gap = seconds((firedOn[i] as number) - (firedOn[i - 1] as number));
    assertLessThanOrEqual(
      Math.abs(gap - FIRE_INTERVAL),
      INTERVAL_TOLERANCE,
      `the gap in seconds between bolt ${i} and bolt ${i + 1} of the held ` +
        `burst, against FIRE_INTERVAL (${FIRE_INTERVAL}) — specs/cursor.md`,
    );
  }
});
