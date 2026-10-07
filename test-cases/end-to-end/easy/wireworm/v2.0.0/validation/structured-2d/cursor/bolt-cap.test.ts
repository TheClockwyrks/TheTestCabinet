// cursor/bolt-cap — no more than MAX_BOLTS bolts are ever in flight at once.
//
// specs/cursor.md: "While the fire action is held, a bolt is fired whenever the
// cooldown is at `0` and fewer than `MAX_BOLTS` [3] bolts are in flight". So a
// held fire action fills the roster to three and then waits for one to leave the
// board before firing again, and the roster never holds a fourth.
//
// WHY THE HOLD IS TWO SECONDS. At `FIRE_INTERVAL` (0.15 s) the cooldown alone
// would allow thirteen shots in that time, and a bolt fired from the band needs
// 0.66 s at `BOLT_SPEED` (900) to leave the board, so the cap is what has to
// refuse a shot again and again for the whole of the window. A window that ended
// at the third shot would never have tested it.
//
// THE HOLD IS REQUIRED TO HAVE PRODUCED MORE BOLTS THAN THE CAP ALLOWS. A build
// that fired nothing at all would satisfy "never more than three" without ever
// having put the rule to the test, and a check that cannot fail decides nothing.
// The bar is only that the cap had something to bind on: any build firing faster
// than one bolt every half-second clears it, so what is being read is still the
// cap and not the rate, which is `cursor.fire-interval`'s requirement.
//
// THE BOLTS FIRED ARE COUNTED BY WHERE THE ROSTER'S BOLTS ARE, not by the roster
// growing. A build that fires the replacement on the same frame the bolt above
// it leaves the board — which is exactly what a gun held against a full roster
// does, and what specs/cursor.md asks for the moment the roster falls below
// `MAX_BOLTS` — never grows the roster at all after the third shot, so counting
// the growth counts three however many bolts the hold really put up.
//
// What is counted instead is a bolt that is not the continuation of one the
// roster carried on the frame before. specs/cursor.md has a bolt created "in the
// cursor's column, at the cursor's center" and then travelling "straight up at
// `BOLT_SPEED`", so a bolt in flight only ever moves UP the board: an id the
// roster did not carry last frame is a bolt fired this frame, and so is an id it
// did carry that has appeared BELOW where it was, since no bolt travels back
// down. That second reading is what makes the count independent of how a build
// hands ids out — specs/state.md requires an id only to be "distinct among every
// entity live at that moment", so a build is free to give a fresh bolt the id a
// departed one carried, and counting the ids alone would read one short for it,
// exactly as counting the roster's growth reads short for a build that replaces
// a bolt on the frame it leaves.
//
// The column is empty, so nothing consumes a bolt early and every bolt that
// leaves the roster left it at the top of the board.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_BOLTS } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The window the fire action is held for, in frames: two seconds. */
const HOLD_TICKS = ticksFor(2);

/**
 * How far below its own last position a bolt may appear and still be the same
 * bolt, in logical units.
 *
 * specs/cursor.md has a bolt travel straight up, so a bolt in flight only ever
 * moves the other way and this is float noise rather than room the count
 * depends on: a fresh bolt wearing a departed one's id appears at the cursor,
 * the better part of the board's height below where that id last was.
 */
const SAME_BOLT_SLACK = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never holds more than MAX_BOLTS bolts in flight over a two-second hold", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setFireCooldown(0);

  let mostInFlight = 0;
  let fired = 0;
  let captured = false;
  // Where each bolt in flight was on the frame before, by id. As the hold opens
  // that is whatever the hold did not fire; `startPlaying` empties the roster,
  // so this is empty.
  let wasAt = new Map(
    h.snapshot().bolts.map((bolt) => [bolt.id, bolt.y] as const),
  );
  holdAction(h, "a");
  try {
    for (let frame = 1; frame <= HOLD_TICKS; frame += 1) {
      await h.advance(1);
      const bolts = h.snapshot().bolts;
      const now = bolts.length;
      // A bolt that is not the continuation of one the roster carried on the
      // frame before is one this frame fired, whether or not the roster grew:
      // one leaving on the same frame keeps the length where it was, and a
      // fresh bolt handed a departed one's id appears back down at the cursor.
      for (const bolt of bolts) {
        const before = wasAt.get(bolt.id);
        if (before === undefined || bolt.y > before + SAME_BOLT_SLACK) {
          fired += 1;
        }
      }
      wasAt = new Map(bolts.map((bolt) => [bolt.id, bolt.y] as const));
      mostInFlight = Math.max(mostInFlight, now);
      // The picture is the full roster, kept the first frame it is full.
      if (!captured && now >= MAX_BOLTS) {
        captureStill(h, "cap");
        captured = true;
      }
    }
  } finally {
    releaseAction(h, "a");
  }
  if (!captured) captureStill(h, "cap");

  assertGreaterThan(
    fired,
    MAX_BOLTS,
    "bolts fired over the hold, counted as the roster's bolts that are not " +
      "the continuation of one it carried the frame before, so the cap had " +
      "something to bind on",
  );
  assertLessThanOrEqual(
    mostInFlight,
    MAX_BOLTS,
    "the most bolts the roster held at once",
  );
});
