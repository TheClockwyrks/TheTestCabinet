// insertion/no-contact-beyond — a fired core that stays outside the window passes by.
//
// THE SPEC LINE. The same sentence `contact-distance` rests on, read from its
// other side: "A core qualifies when the distance between its center and the
// projectile's center is at most the strike distance of 28 units"
// (specs/injector.md, "Striking a core"). A core the projectile never comes
// within 28 units of does not qualify, so nothing is struck, nothing is inserted,
// and "A projectile whose center leaves the field is discarded on that tick,
// changing nothing about the train" (specs/injector.md, "Flight") carries the
// shot away.
//
// WHY THIS IS A POINT OF ITS OWN. A build that seats every shot it fires passes
// `contact-distance` and plays a different game: the player's aim would stop
// mattering. Only a check on this side of the bound says so.
//
// THE TOLERANCE. The shot is arranged to pass 29 units from the core's centre —
// one unit outside a 28-unit bound, which sounds thin and is not, because of HOW
// it is arranged. The offset is measured PERPENDICULAR to the shot's path, and
// the core rides the channel AWAY from that path (leg 0's forward is `+x` and the
// core stands on the `+x` side of the shot), so 29 units is the smallest centre
// distance ANY tick of the flight can measure: every other sample adds the
// tick's own travel along the path, `hypot(29, 10.33) = 30.8` units at the
// neighbouring tick and more beyond it. A build that samples its flight on a
// different tick than the ideal therefore measures MORE than 29, never less. So
// the one unit of margin does not have to absorb a tick of travel the way
// `contact-distance`'s eight units do — nothing but a build reading the bound as
// something other than 28 can cross it.
//
// The pose is otherwise `contact-distance`'s, so the offset is the one thing that
// differs between the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STRIKE_DISTANCE } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  topRunS,
  type Harness,
} from "../harness";
import { approach, assertInFlight, PLUMB_SHOT_X, SHOT, UP_AIM } from "./stage";

/** The perpendicular distance the shot's path keeps from the core's centre. */
const OFFSET = 29;

/** The charge the posed core carries. */
const TARGET = "halide";

/**
 * Ticks driven past the crossing.
 *
 * The shot has 4 ticks of field left above the top run and is discarded on the
 * tick its centre leaves it; this is several times that, so the check reads a
 * hall the shot has certainly left rather than one it is still crossing.
 */
const CLEAR = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seats nothing when the shot stays outside the strike distance", async () => {
  assertGreaterThan(
    OFFSET,
    STRIKE_DISTANCE,
    "the offset is outside the window the spec fixes",
  );

  await poseHall(h, { feed: false, loaded: SHOT });

  const after = await captureReplay(h, "miss", async () => {
    const short = await approach(h, UP_AIM);
    assertInFlight(short);
    await h.debug.poseTrain([[topRunS(PLUMB_SHOT_X + OFFSET), TARGET, null]]);
    return h.step(CLEAR);
  });

  assertEqual(
    coreCount(after),
    1,
    "the channel still carries only the posed core: the shot seated nowhere " +
      "(specs/injector.md, Striking a core)",
  );
});
