// Wick — enemies/chase-holds-at-center: a chaser whose center coincides with
// the lamplighter's keeps the heading it had and stays where it is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Chase"): "A chaser whose center coincides with the
//     lamplighter's keeps its heading and stays where it is that tick; its age
//     still counts".
//   - `specs/instrumentation.md` (`spawnEnemy`): a spawn's "heading is the one
//     `specs/enemies.md` gives a spawn at that point, the unit vector toward
//     the lamplighter's center, or the facing direction when the two coincide",
//     so a moth spawned on the lamplighter's center holds a heading of unit
//     length before the tick and there is a value for the tick to keep.
//   - `specs/enemies.md` ("The life of an enemy"): "`age` is the seconds since
//     it spawned: every tick adds `TICK_DT`", which the hold leaves untouched.
//
// WHAT IS READ. The tick after a moth is posed exactly on the lamplighter's
// center, with `enemyMotion` on: its `x` and `y` are the ones it held before the
// tick, and its `heading` is the one it held before the tick, component for
// component. Its `age` has risen by `TICK_DT`, so the reading is of a tick that
// ran rather than of a moth the game stopped ticking. A build that divides by a
// zero-length vector reads `NaN` on one of the two and fails; one that nudges
// the moth to a default direction moves it 100 / 60 units and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth on the lamplighter's center and
// nothing else, `enemyMotion` the only switch on. `enemyContact` is off, so the
// overlap the pose creates lands no hit and the lamplighter's hp cannot end the
// run under the moth; nothing else can move either body.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the position, which the tick must
// leave where it was, and `DIRECTION_TOLERANCE` (1e-9) on each component of the
// kept heading; `FIGURE_TOLERANCE` on the age, a single `TICK_DT` added.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The chaser this point reads: a moth, behavior `chase`. */
const TYPE = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the moth's heading and position untouched on the lamplighter's center", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const moth = spawnEnemyNear(h, TYPE, 0, 0);
  const posed = present(enemyById(h.snapshot(), moth), "the posed moth");

  const after = await h.tick(1);
  captureStill(h, "center");

  const now = present(enemyById(after, moth), "the moth after the tick");
  assertWithin(now.x, posed.x, MOTION_TOLERANCE, "the moth's x after the tick");
  assertWithin(now.y, posed.y, MOTION_TOLERANCE, "the moth's y after the tick");
  assertWithin(
    now.heading.x,
    posed.heading.x,
    DIRECTION_TOLERANCE,
    "x of the heading the moth kept",
  );
  assertWithin(
    now.heading.y,
    posed.heading.y,
    DIRECTION_TOLERANCE,
    "y of the heading the moth kept",
  );
  assertWithin(
    now.age,
    posed.age + TICK_DT,
    FIGURE_TOLERANCE,
    "the moth's age after the tick",
  );
});
