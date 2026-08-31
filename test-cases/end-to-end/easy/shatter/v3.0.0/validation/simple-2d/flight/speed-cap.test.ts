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
// field can. So a build with no clamp is over the bound at the FIRST sample and
// stays over it, which is why sampling every `SAMPLE_TICKS` rather than every tick
// can hide nothing: the key is held for the whole span, so a breach persists
// rather than flashing between two readings.
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
import { SHIP_MAX } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
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

/** How often the speed is read over that burn: every twentieth of a second. */
const SAMPLE_TICKS = 6;

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

  const thrust = keyFor("up");
  const peak = await captureReplay(h, "capped", async () => {
    let highest = speedOf(h.snapshot().ship);
    h.hold(thrust);
    try {
      for (let done = 0; done < BURN_TICKS; done += SAMPLE_TICKS) {
        await h.advance(Math.min(SAMPLE_TICKS, BURN_TICKS - done));
        highest = Math.max(highest, speedOf(h.snapshot().ship));
      }
    } finally {
      h.release(thrust);
    }
    return highest;
  });

  assertLessThanOrEqual(
    peak,
    SHIP_MAX + CAP_TOLERANCE,
    "the highest speed two seconds of thrust from the cap, along the motion, " +
      "ever showed — thrust and carried momentum reach SHIP_MAX but never pass " +
      "it (specs/ship.md)",
  );
});
