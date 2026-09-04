// progression/level-up-at-threshold — a gain that reaches xpToNext raises the
// level, resets the experience, and queues one level-up.
//
// THE THRESHOLD, FROM THE SPEC. specs/progression.md, Levels and experience:
// "After every gain, while xp >= xpToNext(level): xp falls by xpToNext(level),
// level rises by 1, and one level-up is queued in pendingLevelUps." At level 1
// the threshold is XP_BASE (5), by the same section's formula and its table.
// specs/world.md, Gems: a small gem is worth GEM_VALUES.small (1), and a
// collected gem raises "xp ... by GEM_VALUES[tier] × xpMul", which is 1 with no
// Soot held.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the only experience of the scenario is the one
// gem it places. The run is posed to level 1 with xp 4 through setLevel and
// setXp, of which "No level-up is derived from it: a level-up comes from the
// next gain" (specs/instrumentation.md), so the state stands one small gem
// short of the threshold. One small gem is placed at the lamplighter's center,
// where it is attracted, flown, and collected by the tests of phase 9 of
// specs/world.md on the next tick, and that tick is run.
//
// THE TOLERANCE. FIGURE_TOLERANCE on xp, a real number the spec states exactly
// (4 + 1 − 5 = 0); level and pendingLevelUps are whole counts and are read
// exactly. A build that levels one gain late reads level 1 with xp 5.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The level the threshold is read at: XP_BASE, the first level's own figure. */
const POSED_LEVEL = 1;

/** The experience posed: one small gem short of XP_BASE. */
const POSED_XP = XP_BASE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads level 2, xp 0, and pendingLevelUps 1 when a small gem carries xp 4 to the threshold", async () => {
  isolate(h);
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "levelup");

  assertEqual(after.run.gems.length, 0, "the gem was collected");
  assertEqual(after.run.level, POSED_LEVEL + 1, "level after the gain");
  assertWithin(after.run.xp, 0, FIGURE_TOLERANCE, "xp after the gain");
  assertEqual(after.run.pendingLevelUps, 1, "level-ups queued by the gain");
});
