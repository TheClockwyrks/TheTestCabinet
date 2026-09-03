// Wick — enemies/weave-holds-at-center: a weaver whose anchor coincides with
// the lamplighter's center keeps the heading it had and stays where it is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Weave"): "A weaver whose anchor coincides with the
//     lamplighter's center keeps its heading and stays where it is that tick;
//     its age still counts, so on the next tick its anchor is recovered from
//     the new age as on any tick".
//   - `specs/enemies.md` ("Chase"), the sentence this one is written against,
//     word for word: "A chaser whose center coincides with the lamplighter's
//     keeps its heading and stays where it is that tick; its age still counts".
//     What a chaser keeps where it is is its position, so what a weaver keeps
//     where it is is its position, and the clause that follows is what tells an
//     implementer the anchor recovered on the NEXT tick will differ, since the
//     age it is recovered at has risen.
//   - `specs/enemies.md` ("Weave"): "At spawn the offset is `0`, so the anchor
//     is the spawn position", so a wisp spawned on the lamplighter's center is
//     a wisp whose anchor is on it; `specs/instrumentation.md` (`spawnEnemy`)
//     gives such a spawn "the facing direction when the two coincide", so there
//     is a heading of unit length for the tick to keep.
//   - `specs/enemies.md` ("The life of an enemy"): "every tick adds `TICK_DT`"
//     to `age`, which the hold leaves untouched.
//
// WHAT IS READ. The tick after a wisp is spawned exactly on the lamplighter's
// center, with `enemyMotion` on: its `x` and `y` are the ones it held before the
// tick, its `heading` is the one it held before the tick, and its `age` has
// risen by `TICK_DT`, so the reading is of a tick that ran. A build that divides
// by a zero-length vector reads `NaN` and fails; one that swings the position by
// the new age's offset moves it about 4 units and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One wisp on the lamplighter's center and
// nothing else, `enemyMotion` the only switch on. `enemyContact` is off, so the
// overlap the pose creates lands no hit and cannot end the run under the wisp;
// nothing else can move either body.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the position the tick must leave where
// it was, `DIRECTION_TOLERANCE` (1e-9) on each component of the kept heading,
// and `FIGURE_TOLERANCE` on the age, a single `TICK_DT` added.

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

/** The weaver this point reads: a wisp, behavior `weave`. */
const TYPE = "wisp";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the wisp's heading and position untouched with its anchor on the lamplighter", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const wisp = spawnEnemyNear(h, TYPE, 0, 0);
  const posed = present(enemyById(h.snapshot(), wisp), "the posed wisp");

  const after = await h.tick(1);
  captureStill(h, "center");

  const now = present(enemyById(after, wisp), "the wisp after the tick");
  assertWithin(now.x, posed.x, MOTION_TOLERANCE, "the wisp's x after the tick");
  assertWithin(now.y, posed.y, MOTION_TOLERANCE, "the wisp's y after the tick");
  assertWithin(
    now.heading.x,
    posed.heading.x,
    DIRECTION_TOLERANCE,
    "x of the heading the wisp kept",
  );
  assertWithin(
    now.heading.y,
    posed.heading.y,
    DIRECTION_TOLERANCE,
    "y of the heading the wisp kept",
  );
  assertWithin(
    now.age,
    posed.age + TICK_DT,
    FIGURE_TOLERANCE,
    "the wisp's age after the tick",
  );
});
