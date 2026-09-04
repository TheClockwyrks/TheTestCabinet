// torpedo/lifetime — a torpedo that hits nothing is removed at TORPEDO_LIFE.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The flight, the Lifetime row:
// "`TORPEDO_LIFE` (`3.5` seconds), after which a torpedo that has hit nothing is
// removed." `specs/instrumentation.md` gives a torpedo placed through
// `addTorpedo` "a full `TORPEDO_LIFE`", so the clock starts at the pose and the
// removal is due `3.5` seconds of game time later.
//
// BOTH SIDES, BECAUSE ONE ALONE DECIDES NOTHING. A build that removes a torpedo
// the moment it is placed passes "gone by `3.6` s", and a build that never
// removes one passes "still there at `3.4` s". Together they place the removal
// inside a window `0.2` s wide around a `3.5` s figure, which separates it from
// the `1.5` s `BULLET_LIFE` a build might have reused and from every neighbouring
// round number.
//
// THE TENTH OF A SECOND IS A READING ALLOWANCE, NOT ROOM ON THE FIGURE. A life
// counted down by `TICK_DT` a tick lands on the tick whose accumulated time first
// reaches `3.5` s, which floating-point addition can put a tick either side of
// tick 420; and a build is free to test its life before or after the tick's
// decrement, which is one more tick. Twelve ticks is far more than either needs
// and far less than the gap to any other figure.
//
// THE TORPEDO MEETS NOTHING, AND STAYS CLEAR. `specs/collision.md` removes a
// torpedo that lands or that the core absorbs, so a torpedo that met either would
// leave the roster for a reason that is not its life. `startPlaying` leaves no
// rock and no saucer on the field and shuts both world gates, and the lane is the
// very bottom of the field, `y = 690`, so every point of the flight is at least
// `330` units from the star's centre — nine times the `36` at which the core
// absorbs a torpedo. The flight crosses the right seam once on its way, which
// `specs/field.md` makes an ordinary part of travelling and `torpedo/wraps`
// decides on its own.
//
// THE GUIDANCE IS HELD OFF so the lane holds for the whole flight: with an empty
// field nothing conforming could turn it, and the gate stops a build that treats
// the star as an acquirable body from steering out of the lane this check chose.

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_LIFE } from "../constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  torpedoById,
  type Harness,
} from "../harness";
import { holdItsHeading, poseTorpedo, standTheShipClear } from "./scenario";

/** The lane the torpedo is flown along: the very bottom of the field. */
const LANE_Y = 690;
const START_X = 60;
/** Along `+x`. */
const HEADING = 0;

/** When it must still be in flight, and when it must be gone, in seconds. */
const ALIVE_AT = TORPEDO_LIFE - 0.1;
const GONE_AT = TORPEDO_LIFE + 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a torpedo in flight to 3.4 s of game time and removes it by 3.6 s", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const id = poseTorpedo(h, START_X, LANE_Y, HEADING);
  holdItsHeading(h, id);

  await h.advance(ticksFor(ALIVE_AT));
  const early = h.snapshot();

  await h.advance(ticksFor(GONE_AT) - ticksFor(ALIVE_AT));
  const late = h.snapshot();
  // The field the instant after the torpedo expired.
  captureStill(h, "expiry");

  assertTrue(
    torpedoById(early, id) !== undefined,
    `the torpedo still in flight at ${ALIVE_AT} s of game time, a tenth of a ` +
      `second short of TORPEDO_LIFE (${TORPEDO_LIFE} s), on an empty field ` +
      "where it can have hit nothing (specs/weapons.md); the roster held " +
      `${JSON.stringify((early.torpedoes ?? []).map((t) => t.id))}`,
  );
  assertTrue(
    torpedoById(late, id) === undefined,
    `the torpedo removed by ${GONE_AT} s of game time, a tenth of a second ` +
      `past TORPEDO_LIFE (${TORPEDO_LIFE} s) (specs/weapons.md); the roster ` +
      `held ${JSON.stringify((late.torpedoes ?? []).map((t) => t.id))}`,
  );
});
