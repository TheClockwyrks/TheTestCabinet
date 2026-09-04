// instrumentation/set-xp — `setXp(4.5)` reads back xp 4.5, `setXp(100)` at
// level 1 reads back xp 100 with level still 1 and pendingLevelUps 0, and the
// next gem collected then queues the level-ups the total earns.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setXp`: "Sets `xp`
// to `xp`, a real number of at least `0`. No level-up is derived from it: a
// level-up comes from the next gain". specs/progression.md, "Levels and
// experience": "After every gain, while `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1`, and one level-up is queued", with
// the table 5, 15, 25, 35, 45: a total of 101 from level 1 leaves level 5
// with 21 over and four level-ups queued.
//
// THE POSE. An isolated run at level 1, the two poses read back, then a small
// gem placed at the lamplighter's center: the next tick collects it (a gem
// within COLLECT_RADIUS is collected), the gain is 1, and the rule runs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, GEM_VALUES, xpToNext } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

const SMALL_XP = 4.5;
const POSED_XP = 100;

/** What the rule leaves after a gain lands on the posed total. */
function afterGain(
  level: number,
  xp: number,
): { level: number; xp: number; queued: number } {
  let queued = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    queued += 1;
  }
  return { level, xp, queued };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets xp without a level-up, and the next gain queues what the total earns", async () => {
  isolate(h, { level: 1 });
  h.debug.setXp(SMALL_XP);
  assertEqual(h.snapshot().run.xp, SMALL_XP, "xp read back");

  h.debug.setXp(POSED_XP);
  const posed = h.snapshot();
  assertEqual(posed.run.xp, POSED_XP, "xp read back past the threshold");
  assertEqual(posed.run.level, 1, "level after the pose");
  assertEqual(posed.run.pendingLevelUps, 0, "pendingLevelUps after the pose");

  const { x, y } = posed.run.player;
  spawnGemAt(h, "small", x, y);
  const after = await h.tick(1);
  captureStill(h, "posed");

  const expected = afterGain(1, POSED_XP + GEM_VALUES.small);
  assertEqual(after.run.level, expected.level, "level after the gain");
  assertWithin(
    after.run.xp,
    expected.xp,
    FIGURE_TOLERANCE,
    "xp after the gain",
  );
  assertEqual(
    after.run.pendingLevelUps,
    expected.queued,
    "the level-ups queued",
  );
});
