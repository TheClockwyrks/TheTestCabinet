// enemies/weave-holds-at-center — a weaver whose anchor stands on the
// lamplighter's center keeps its heading and its place for that tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave"): "A weaver
// whose anchor coincides with the lamplighter's center keeps its heading and
// stays where it is that tick; its age still counts, so on the next tick its
// anchor is recovered from the new age as on any tick." The heading the tick
// would recompute is "unit(lamplighter - anchor)", undefined between two
// coincident points, and this is the rule that says what happens instead: the
// heading it already had, and no move. Both readings are therefore the values
// the wisp carried BEFORE the tick, exact up to `MOTION_EPS`.
//
// WHY THE ANCHOR IS POSED AT AGE ZERO. "At spawn the offset is `0`, so the
// anchor is the spawn position", so a wisp that has not yet aged carries its
// anchor exactly where its position is, and moving the position with
// `setEnemyPosition` — under which "A weaver's anchor follows from the new
// position" (`specs/instrumentation.md`) — puts the anchor exactly on the
// lamplighter's center rather than a rounding away from it. The lamplighter of
// an isolated run stands at the origin it started at and no key is held, so
// the coincidence is the same pair of doubles and the rule certainly applies.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one wisp, with
// `enemyMotion` the one switch on, so the tick that runs is a tick of the
// weave and nothing else. The wisp is spawned `SPAWN` (300) units straight
// above the lamplighter, so it takes the heading `(0, 1)`, a direction of its
// own that a build falling back to the lamplighter's `right` facing would not
// produce, and is then moved onto the center. `enemyContact` is off, so the
// overlap the pose creates lands no hit; nothing else is alive.
//
// WHAT IS NOT READ HERE. The age, which "still counts" through the hold, is
// `age-counts-per-tick`'s point.
//
// THE TOLERANCE. `MOTION_EPS`, the bound for one integration step, on both
// readings: a build that swung the wisp out to the offset its new age carries
// would be `40 × sin(2π / 60)`, over four units, out.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { requireEnemy } from "./roster";

/** How far above the lamplighter the wisp is spawned, before it is moved in. */
const SPAWN = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a wisp whose anchor is on the lamplighter's center with the heading and place it had", async () => {
  isolate(h);
  const wisp = placeEnemyNear(h, "wisp", 0, -SPAWN);
  const { player } = h.snapshot().run;
  h.debug.setEnemyPosition(wisp, player.x, player.y);
  enable(h, "enemyMotion");
  const before = requireEnemy(h.snapshot(), wisp);

  const after = requireEnemy(await advanceTicks(h, 1), wisp);
  captureStill(h, "center");

  assertLessThanOrEqual(
    Math.hypot(
      after.heading.x - before.heading.x,
      after.heading.y - before.heading.y,
    ),
    MOTION_EPS,
    "how far the coincident weaver's heading moved across the tick (specs/enemies.md, Weave)",
  );
  assertLessThanOrEqual(
    distance(after, before),
    MOTION_EPS,
    "how far the coincident weaver moved across the tick (specs/enemies.md, Weave)",
  );
});
