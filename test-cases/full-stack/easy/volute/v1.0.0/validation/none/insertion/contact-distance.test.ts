// insertion/contact-distance — a fired core seats once it comes within reach.
//
// THE SPEC LINE. `specs/injector.md`, "Striking a core": "After it advances, a
// projectile is checked against every core on the channel, at the positions the
// train holds after its own advance for that tick. A core qualifies when the
// distance between its center and the projectile's center is at most the strike
// distance of 28 units." `STRIKE_DISTANCE` is that 28, from the file's own
// figures table. What follows a qualifying core is the insertion: the projectile
// stops being a projectile and the core it carried joins the train
// (specs/injector.md, "Insertion"), so a shot that qualified leaves no projectile
// and one more core than the channel held.
//
// WHAT THIS POINT DECIDES, AND WHAT IT LEAVES TO ITS SIBLINGS. Only that contact
// inside the window seats. Which side of the struck core it seats on is
// `insert-ahead` and `insert-behind`; which core is picked out of several is
// `nearest-core`; what the rest of the train does to make room is
// `backward-shift`. So the hall holds ONE core, and the check reads two things:
// no projectile is left in flight, and the channel carries one more core.
//
// THE OFFSET, AND WHY IT SITS WHERE IT DOES. The threshold is a bound, not a
// target, so the reading is a margin inside it — and that margin has to be as
// SMALL as the drive's own slack allows, or the point stops grading the 28 at
// all. The slack is bounded by the shared stage rather than by a whole tick:
// `stage.ts`'s `approach` stops the shot on the last sample at or below `y = 55`
// and the single tick that follows carries it `620 / 60 = 10.33` units further
// (specs/injector.md), so the projectile's centre resolves the strike somewhere
// in `y` in `(34.33, 44.67]`. The core stands on the straight top run at
// `y = 40` (specs/channel.md's first leg), so the component along the shot's
// path is at most 5.67 units however a build lands its samples. With the core
// placed 24 units to the SIDE of that path, the worst centre distance a build
// can measure at the strike is `hypot(24, 5.67) = 24.7` units, 3.3 inside the
// 28-unit window, and the best is 24 exactly. So every build whose strike
// distance is the specified 28 seats the shot, and a build that seats only
// within 24 units of a core's centre does not.
//
// `no-contact-beyond` is this check's complement, posing the same hall 29 units
// off the path, so the pair brackets the bound to (24, 29] and neither alone
// pins it. The two are posed identically, so the offset is the one thing that
// differs between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  CORE_RADIUS,
  PROJECTILE_SPEED,
  STRIKE_DISTANCE,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  topRunS,
  type Harness,
} from "../harness";
import { approach, assertInFlight, PLUMB_SHOT_X, STAGE, UP_AIM } from "./stage";

/**
 * How far to the side of the shot's path the core's centre stands when the
 * strike resolves. See the note above: the closest the check can stand to the
 * 28-unit bound while every sample the shared stage can land on is still inside
 * it, which is 3.3 units of headroom rather than 8.
 */
const OFFSET = 24;

/** One tick of the projectile's flight, quoted in the reasoning above. */
const SHOT_STEP = PROJECTILE_SPEED * TICK_DT;

/** The charge the posed core carries: not the shot's, so nothing can extract. */
const TARGET = "halide";

/** Ticks driven after the strike, so the replay shows the seated core riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seats a fired core that comes within the strike distance", async () => {
  // The offsets this check reasons with, stated against the spec's own figures so
  // a change to either is read against the other.
  assertLessThan(OFFSET, STRIKE_DISTANCE, "the offset is inside the window");
  assertGreaterThan(
    OFFSET,
    2 * CORE_RADIUS - STRIKE_DISTANCE,
    "the offset is outside a build that seats only on overlap",
  );
  assertLessThan(
    Math.hypot(OFFSET, SHOT_STEP),
    STRIKE_DISTANCE,
    "a sample a whole tick off the ideal is still inside the window",
  );

  await poseHall(h, STAGE);

  const after = await captureReplay(h, "seat", async () => {
    const short = await approach(h, UP_AIM);
    assertInFlight(short);
    // One core, placed so that after the single tick that follows it stands
    // OFFSET units to the side of the shot's path, on the straight top run.
    await h.debug.poseTrain([[topRunS(PLUMB_SHOT_X + OFFSET), TARGET, null]]);
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(
    (after.projectiles ?? []).length,
    0,
    "no projectile left in flight: the shot seated on contact " +
      "(specs/injector.md, Striking a core)",
  );
  assertEqual(
    coreCount(after),
    2,
    "the channel carries the posed core and the seated one " +
      "(specs/injector.md, Insertion)",
  );
});
