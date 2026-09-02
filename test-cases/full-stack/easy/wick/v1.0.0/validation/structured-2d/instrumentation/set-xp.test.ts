// Wick — instrumentation/set-xp: `setXp(4.5)` reads back 4.5, `setXp(100)` at
// level 1 reads back 100 with level still 1 and nothing queued, and the next
// gem collected queues the level-ups the total earns.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setXp(xp)`: "Sets `xp` to `xp`, a real number of at least `0`. No level-up
// is derived from it: a level-up comes from the next gain." `specs/
// progression.md`, "Levels and experience": "After every gain, while
// `xp >= xpToNext(level)`: `xp` falls by `xpToNext(level)`, `level` rises by
// `1`, and one level-up is queued" — from 101 at level 1: 96 at 2, 81 at 3, 56
// at 4, 21 at 5, and 21 < 45 stops: level 5, xp 21, four queued.
// `specs/world.md`, "Gems": a small gem grants 1, and a gem at the
// lamplighter's center is within `COLLECT_RADIUS` and collected on the tick.
//
// THE DRIVE. An isolated run at level 1, the two poses read at the call, a
// small gem spawned at the lamplighter's center, and one tick. `REAL_EPS` on
// xp 21, a sum and four differences of stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const FIRST_XP = 4.5;
const SECOND_XP = 100;
const EXPECTED_LEVEL = 5;
const EXPECTED_XP = 21;
const EXPECTED_QUEUED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses xp without a level-up, and the next gem queues what the total earns", async () => {
  isolate(h, { level: 1 });
  h.debug.setXp(FIRST_XP);
  assertEqual(h.snapshot().run.xp, FIRST_XP, "run.xp after setXp(4.5)");

  h.debug.setXp(SECOND_XP);
  const posed = h.snapshot();
  assertEqual(posed.run.xp, SECOND_XP, "run.xp after setXp(100)");
  assertEqual(posed.run.level, 1, "run.level after setXp(100)");
  assertEqual(posed.run.pendingLevelUps, 0, "pendingLevelUps after setXp(100)");

  h.debug.spawnGem("small", 0, 0);
  const gained = await advanceTicks(h, 1);
  captureStill(h, "posed");
  assertEqual(gained.run.gems.length, 0, "gems after the collecting tick");
  assertEqual(gained.run.level, EXPECTED_LEVEL, "run.level after the gain");
  assertNear(gained.run.xp, EXPECTED_XP, REAL_EPS, "run.xp after the gain");
  assertEqual(
    gained.run.pendingLevelUps,
    EXPECTED_QUEUED,
    "pendingLevelUps after the gain",
  );
});
