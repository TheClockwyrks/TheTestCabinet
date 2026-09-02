// enemies/chase-holds-at-center — a chaser standing on the lamplighter's
// center keeps its heading and its place for that tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Chase"): "A chaser
// whose center coincides with the lamplighter's keeps its heading and stays
// where it is that tick; its age still counts." The unit vector the chase
// would recompute is undefined between two coincident points, and this is the
// rule that says what happens instead: the heading it already had, and no
// step. Both readings are therefore the values the moth carried BEFORE the
// tick, and the threshold is exact equality up to `MOTION_EPS`: a build that
// divided by a zero length and left `NaN`, or one that fell back to some
// direction of its own and took a step, fails.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one moth, with
// `enemyMotion` the one switch on, so the tick that runs is a tick of the
// chase and nothing else. The moth is spawned `SPAWN` (300) units straight
// above the lamplighter, which `specs/instrumentation.md` (`spawnEnemy`) gives
// "the unit vector toward the lamplighter's center", `(0, 1)` — a heading of
// its own, distinguishable from the `(1, 0)` a build falling back to the
// lamplighter's `right` facing would take — and then moved onto the
// lamplighter's center with `setEnemyPosition`, which moves it while "its
// heading, age, and health are untouched". The two centers are then the same
// pair of doubles, since the lamplighter of an isolated run stands at the
// origin it started at and no key is held, so the coincidence is exact rather
// than nearly so. `enemyContact` is off, so the overlap the pose creates lands
// no hit; nothing else is alive.
//
// WHAT IS NOT READ HERE. The age, which "still counts" through the hold, is
// `age-counts-per-tick`'s point.
//
// THE TOLERANCE. `MOTION_EPS`, the bound for one integration step, on both
// readings: a build that took its step would be a whole `100 / 60` units out.

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

/** How far above the lamplighter the moth is spawned, before it is moved in. */
const SPAWN = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth posed on the lamplighter's center with the heading and place it had", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", 0, -SPAWN);
  const { player } = h.snapshot().run;
  h.debug.setEnemyPosition(moth, player.x, player.y);
  enable(h, "enemyMotion");
  const before = requireEnemy(h.snapshot(), moth);

  const after = requireEnemy(await advanceTicks(h, 1), moth);
  captureStill(h, "center");

  assertLessThanOrEqual(
    Math.hypot(
      after.heading.x - before.heading.x,
      after.heading.y - before.heading.y,
    ),
    MOTION_EPS,
    "how far the coincident moth's heading moved across the tick (specs/enemies.md, Chase)",
  );
  assertLessThanOrEqual(
    distance(after, before),
    MOTION_EPS,
    "how far the coincident moth moved across the tick (specs/enemies.md, Chase)",
  );
});
