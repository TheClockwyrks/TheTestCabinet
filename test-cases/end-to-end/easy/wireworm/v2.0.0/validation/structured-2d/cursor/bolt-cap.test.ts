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
// The column is empty, so nothing consumes a bolt early and every bolt that
// leaves the roster left it at the top of the board.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_BOLTS } from "../../src/constants";
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
  holdAction(h, "a");
  try {
    let inFlight = h.snapshot().bolts.length;
    for (let frame = 1; frame <= HOLD_TICKS; frame += 1) {
      await h.advance(1);
      const now = h.snapshot().bolts.length;
      if (now > inFlight) fired += now - inFlight;
      inFlight = now;
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
    "bolts fired over the hold, so the cap had something to bind on",
  );
  assertLessThanOrEqual(
    mostInFlight,
    MAX_BOLTS,
    "the most bolts the roster held at once",
  );
});
