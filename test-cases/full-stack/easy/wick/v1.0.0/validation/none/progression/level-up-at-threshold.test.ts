// progression/level-up-at-threshold — reaching xpToNext levels the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Levels and
// experience"): "After every gain, while `xp >= xpToNext(level)`: `xp` falls by
// `xpToNext(level)`, `level` rises by `1`, and one level-up is queued in
// `pendingLevelUps`." `xpToNext(1)` is `XP_BASE` (`5`) by the formula above it.
// specs/world.md ("Gems") gives the gain: a `small` gem is worth `1`
// experience, and collecting it raises `xp` by "`GEM_VALUES[tier] × xpMul`",
// with `xpMul` "`1` with no Soot held". So at level `1` with `xp` `4`, one
// small gem takes `xp` to exactly `5`, the threshold is met once, and the run
// reads level `2`, `xp` `0`, `pendingLevelUps` `1`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no passive: Soot is the only thing that scales a gain and
// no passive is held, so the gem is worth exactly its tier's value. The level
// and the experience are posed with `setLevel` and `setXp`, of which
// "No level-up is derived from it: a level-up comes from the next gain" — so
// the crossing this check reads is the gem's alone. The gem is placed at the
// lamplighter's center and collected by a real tick, which is the only path
// experience arrives by.
//
// THE TOLERANCE. `level` and `pendingLevelUps` are whole numbers, read exactly;
// `xp` is "a real number", so it is read within `FLOAT_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, GEM_VALUES, xpToNext } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The level the crossing is read at: the first, whose threshold is `XP_BASE`. */
const POSED_LEVEL = 1;

/** The experience posed: one short of `xpToNext(1)`, so one small gem meets it. */
const POSED_XP = xpToNext(POSED_LEVEL) - GEM_VALUES.small;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rises a level, spends the threshold, and queues one level-up", async () => {
  await isolate(h);
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);

  const after = await collectGem(h, "small");
  await captureStill(h, "levelup");

  assertEqual(after.run.level, POSED_LEVEL + 1, "the level after the gain");
  assertNear(after.run.xp, 0, FLOAT_TOL, "the experience after the gain");
  assertEqual(after.run.pendingLevelUps, 1, "the level-ups queued by the gain");
});
