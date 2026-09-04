// Wick — instrumentation/set-xp: `setXp(4.5)` reads back `xp` 4.5, `setXp(100)`
// at level 1 reads back `xp` 100 with `level` still 1 and `pendingLevelUps` 0,
// and the next gem collected then queues the level-ups the total earns.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setXp(xp)`):
// "Sets `xp` to `xp`, a real number of at least `0`. No level-up is derived
// from it: a level-up comes from the next gain." specs/progression.md: "After
// every gain, while `xp >= xpToNext(level)`: `xp` falls by `xpToNext(level)`,
// `level` rises by `1`, and one level-up is queued"; a small gem is worth 1
// (specs/world.md, `GEM_VALUES`). From 101 at level 1 the thresholds 5, 15,
// 25, 35 are crossed and 45 is not, so level 6, `xp` 21, and 5 queued; the
// gain is an exact integer sum, so `xp` is read exactly.
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated at level 1 with no
// Soot and `progression` turned back on, which is the faculty that spends a
// gain on a level, so a gem is worth exactly its table value; the gem is posed
// at the lamplighter's center and collected by the real tick, which is the gain
// the sentence defers the level-up to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEM_VALUES, xpToNext } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const SMALL_XP = 4.5;
const LARGE_XP = 100;

/** The level, xp, and queued level-ups the rule leaves after a gain to `total` from level 1. */
function afterGain(total: number): {
  level: number;
  xp: number;
  queued: number;
} {
  let level = 1;
  let xp = total;
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

afterEach(async () => {
  await h.dispose();
});

it("poses experience without a level-up, which the next gain then derives", async () => {
  await isolate(h, { level: 1, on: ["progression"] });
  await h.debug.setXp(SMALL_XP);
  assertEqual((await h.snapshot()).run.xp, SMALL_XP, "xp after setXp(4.5)");

  await h.debug.setXp(LARGE_XP);
  const posed = await h.snapshot();
  await captureStill(h, "posed");
  assertEqual(posed.run.xp, LARGE_XP, "xp after setXp(100)");
  assertEqual(posed.run.level, 1, "level after setXp(100)");
  assertEqual(posed.run.pendingLevelUps, 0, "pendingLevelUps after setXp(100)");

  const gained = await collectGem(h, "small");
  const expected = afterGain(LARGE_XP + GEM_VALUES.small);
  assertEqual(gained.run.level, expected.level, "level after the next gain");
  assertEqual(gained.run.xp, expected.xp, "xp after the next gain");
  assertEqual(
    gained.run.pendingLevelUps,
    expected.queued,
    "pendingLevelUps queued by the next gain",
  );
});
