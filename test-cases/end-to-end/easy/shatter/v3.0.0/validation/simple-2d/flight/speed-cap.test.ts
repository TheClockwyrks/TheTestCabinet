// flight/speed-cap — the speed cap holds under a thrust that would carry the ship
// past it.
//
// THE RULE. `specs/ship.md`, the last step of the ship's tick: "The speed is then
// clamped to `SHIP_MAX` (`680`). Thrust and carried momentum reach the cap but
// never pass it." So the scenario is the one that puts the rule under load — the
// ship posed AT the cap, thrusting along its own motion, for two seconds — and
// the reading is the HIGHEST speed it ever shows over that span, not the speed it
// happened to end on. A build that overshoots and settles back would pass an
// end-of-span reading and fails this one.
//
// WHY THE CAP IS THE ONLY THING THAT CAN HOLD IT. Without the clamp, a ship
// thrusting along its velocity settles at `SHIP_THRUST * TICK_DT * k / (1 - k)`,
// about 2075 units per second, and climbs toward it monotonically from the moment
// the burn starts: past 693 within the first twentieth of a second, and 768 by the
// end of the span. The drag alone cannot stop it and nothing else on an emptied
// field can. So a build with no clamp is over the bound at the FIRST tick and
// stays over it.
//
// BUT THE READING IS EVERY TICK, BECAUSE THE ITEM'S WORD IS NEVER. That argument
// holds for a build with NO clamp and says nothing about one whose clamp misses:
// a build that applies it on every second tick crosses the cap and comes back
// inside it, and a reading taken every few ticks can only say "not at the moments
// it looked". Every tick the snapshot can report is read instead.
//
// AND THE BURN IS PROVED TO BE ONE. A ship posed at `SHIP_MAX` and left to coast
// never reads above the cap, so a build that answers none of the thrust key clears
// the bound below by doing nothing. The ship must still be reporting thrust when
// the burn ends, and the pose must have landed on the cap before it began.
//
// WHY ONE UNIT PER SECOND. The item's own figure, and the smallest honest one: a
// conformant build clamps to `SHIP_MAX` exactly, and the only reading between
// `680` and `681` a specification-following build can produce is float rounding.
//
// ONE DIRECTION, AND ONLY ONE. The item is "never exceeds `SHIP_MAX` by more than
// 1 unit per second", so the reading is an upper bound and the check asserts
// nothing else. A build that clamps SOMEWHERE, but LOWER than `SHIP_MAX`, is not
// what this item is about and is not graded here: a ship posed at the cap under a
// build clamping at `600` simply reads `600`, which is under the bound. Adding a
// lower bound would make one item grade two requirements — and it would grade the
// wrong one, since a reviewer reads this verdict beside the item's own sentence.
// `flight/thrust-accelerates` does not catch it either: a burn from rest reaches
// only 428 units per second in the second it holds, well under either cap.
//
// WHERE IT IS FLOWN. Along a row 300 units below the star's, so that the 1360
// units the ship covers — a lap and a bit, wrapping once as `specs/field.md` says
// it must — never bring it within `CORE_R + SHIP_R` (`44`) of the star's centre,
// where `specs/collision.md` would slide it off the core and take the speed being
// measured with it. The well never pulls the ship (`specs/gravity.md`), and
// `startPlaying` has emptied the field and shut both world gates.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_MAX } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { speedOf } from "../geometry";
import {
  captureReplay,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The two seconds of held thrust the item names. */
const BURN_TICKS = ticksFor(2);

/**
 * How often the speed is read over that burn: every tick.
 *
 * The item's word is NEVER, and a reading taken every twentieth of a second can
 * only say "not at the forty moments it looked". A build with no clamp at all is
 * caught by any sample — it climbs monotonically past the bound from the first
 * one — but a build that clamps on some ticks and not others returns inside the
 * cap between reads, and only a reading of every tick the snapshot can report
 * excludes it.
 */
const SAMPLE_TICKS = 1;

/** The one unit per second of headroom the item allows over `SHIP_MAX`. */
const CAP_TOLERANCE = 1;

/** Where the burn is flown: a row well below the star, heading along it. */
const START = { x: 40, y: 660 };

/** Straight along the positive `x` axis, in radians, which is also the drift. */
const FACE_EAST = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never lets the speed pass SHIP_MAX under a burn along the motion", async () => {
  startPlaying(h);
  h.debug.setShipPosition(START.x, START.y);
  h.debug.setShipAngle(FACE_EAST);
  h.debug.setShipVelocity(SHIP_MAX, 0);

  const posed = h.snapshot();
  assertCloseTo(
    speedOf(posed.ship),
    SHIP_MAX,
    1,
    "the ship posed at SHIP_MAX before the burn, so the burn presses on the " +
      "cap from its first tick (specs/instrumentation.md: setShipVelocity)",
  );

  const thrust = keyFor("up");
  const burn = await captureReplay(h, "capped", async () => {
    let highest = speedOf(h.snapshot().ship);
    let thrusting = false;
    h.hold(thrust);
    try {
      for (let done = 0; done < BURN_TICKS; done += SAMPLE_TICKS) {
        await h.advance(Math.min(SAMPLE_TICKS, BURN_TICKS - done));
        const ship = h.snapshot().ship;
        highest = Math.max(highest, speedOf(ship));
        thrusting = ship.thrusting;
      }
    } finally {
      h.release(thrust);
    }
    return { highest, thrusting };
  });

  // THE BURN WAS REAL. Without this the item passes a build that never answers
  // the thrust key at all: a ship posed at SHIP_MAX and left to coast only ever
  // reads at or below the cap, so the bound below is met by doing nothing.
  assertEqual(
    burn.thrusting,
    true,
    "the ship still reporting thrust at the end of the burn, with the key held " +
      "throughout — thrust is read as a hold (specs/controls.md), and a build " +
      "that answers none of it coasts under the cap and clears the bound below " +
      "without ever pressing on it",
  );

  assertLessThanOrEqual(
    burn.highest,
    SHIP_MAX + CAP_TOLERANCE,
    "the highest speed two seconds of thrust from the cap, along the motion, " +
      "ever showed — thrust and carried momentum reach SHIP_MAX but never pass " +
      "it (specs/ship.md)",
  );
});
