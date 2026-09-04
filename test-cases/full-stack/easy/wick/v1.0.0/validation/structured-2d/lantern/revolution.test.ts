// lantern/revolution — a lantern revolves at LANTERN_ANGULAR_SPEED, clockwise.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "From the
// next tick they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees per
// second clockwise, so lantern `i` sits at angle
// `i × 360 / amount + LANTERN_ANGULAR_SPEED × t` after `t` seconds." The
// angle convention is the same file's ("The nearest enemy"): "positive angles
// turning toward `+y`, which is clockwise on screen." Thirty ticks is
// `30 / TICK_HZ` = 0.5 seconds (`specs/world.md`, The plane), so the turn is
// `180 × 0.5` = 90 degrees toward `+y` from wherever the lantern started, and
// the whole of the turn is what this check reads: the offset from the angle
// the set was created at to the angle it holds thirty ticks later.
//
// WHY LEVEL 1. Row 1 places one lantern, so there is exactly one angle to
// follow and no question of which id turned. Its duration is 3.0 seconds,
// `round(3 × 60)` = 180 ticks (`specs/world.md`, Timers), so the lantern is
// still in the world thirty ticks in.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Lantern. The firing tick runs with `effectMotion` OFF, so the starting
// angle is read before anything can have turned ("every lantern holds its
// angle", `specs/instrumentation.md`), and `effectMotion` is turned on only
// then, which "resumes that faculty from the next tick, with no catching up
// for the ticks it missed" — so the thirty ticks that follow are thirty ticks
// of revolving and the reading is the RATE alone, not the question of whether
// the creation tick turns. `weaponFire` is turned off after the firing, so
// nothing refires under the reading; the next firing would be 360 ticks out
// in any case. The lantern is followed by its own id.
//
// THE TOLERANCE. `ANGLE_EPS` (a millionth of a degree) on the turn, which the
// build integrates over thirty steps of `180 × TICK_DT` degrees; the constant
// itself is checked in the direction the spec states, so a build revolving
// counter-clockwise reads −90 and fails, and one at half or double the rate
// misses by 45 degrees.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear, assertTrue } from "../assert";
import {
  ANGLE_EPS,
  LANTERN_ANGULAR_SPEED,
  LANTERN_LEVELS,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  angularOffset,
  captureReplay,
  createHarness,
  disable,
  enable,
  zoneById,
  type Harness,
} from "../harness";
import { angleAbout, fireLantern } from "./set";

/** Row 1: one lantern, duration 3.0 (180 ticks), well past the span read here. */
const LEVEL = 1;

/** How many ticks of revolving the check runs. */
const TICKS = 30;

/** The turn those ticks make: `180 × 30 / 60` = 90 degrees toward `+y`. */
const TURN = LANTERN_ANGULAR_SPEED * TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns a level-1 lantern 90 degrees toward +y over 30 ticks of revolving", async () => {
  const firing = await fireLantern(h, LEVEL);
  const lantern = firing.lanterns[0];
  assertDefined(
    lantern,
    `the one lantern a level-${LEVEL} set is made of (specs/weapons.md, Lantern), amount ${LANTERN_LEVELS[LEVEL - 1].amount}`,
  );
  const started = angleAbout(firing.after, lantern);

  disable(h, "weaponFire");
  enable(h, "effectMotion");

  const turned = await captureReplay(h, "revolving", async () => {
    const after = await advanceTicks(h, TICKS);
    const zone = zoneById(after, lantern.id);
    return {
      present: zone !== undefined,
      angle: zone === undefined ? Number.NaN : angleAbout(after, zone),
    };
  });

  assertTrue(
    turned.present,
    `whether the lantern is still in zones after ${TICKS} ticks of revolving, within its 3.0-second life`,
  );
  assertNear(
    angularOffset(started, turned.angle),
    TURN,
    ANGLE_EPS,
    `the degrees the lantern turned toward +y over ${TICKS} ticks, from ${started.toFixed(3)} (specs/weapons.md, Lantern)`,
  );
});
