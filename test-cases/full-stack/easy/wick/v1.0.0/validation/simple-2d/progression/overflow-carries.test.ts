// progression/overflow-carries — experience past the threshold carries into the
// next level rather than being discarded.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Levels and experience: "After
// every gain, while xp >= xpToNext(level): xp falls by xpToNext(level), level
// rises by 1 ... The overflow carries into the next level". The threshold at
// level 1 is XP_BASE (5), and specs/world.md, Gems, gives a medium gem
// GEM_VALUES.medium (3), collected as "xp rises by GEM_VALUES[tier] × xpMul",
// which is 3 with no Soot held. From xp 4 the gain reaches 7, the level rises
// once, and 7 − 5 = 2 is left standing.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the gem the scenario places is the only
// experience of the run. Level 1 and xp 4 are posed through setLevel and setXp,
// which derives no level-up of its own, and one medium gem is placed at the
// lamplighter's center, where phase 9 of specs/world.md attracts, flies, and
// collects it on the next tick.
//
// THE TOLERANCE. FIGURE_TOLERANCE on xp, a real number the spec states exactly
// (4 + 3 − 5 = 2). A build that discards the overflow reads 0, two whole units
// away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, GEM_VALUES, XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The level the overflow is read at: XP_BASE is the threshold there. */
const POSED_LEVEL = 1;

/** The experience posed: one short of the threshold. */
const POSED_XP = XP_BASE - 1;

/** What is left over the threshold once the medium gem lands: 4 + 3 − 5. */
const CARRIED = POSED_XP + GEM_VALUES.medium - XP_BASE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads level 2 with xp 2 when a medium gem carries xp 4 past the threshold", async () => {
  isolate(h);
  // Spending experience on levels is the requirement, so `progression` is the one faculty turned back on.
  enable(h, "progression");
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "medium", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "overflow");

  assertEqual(after.run.gems.length, 0, "the gem was collected");
  assertEqual(after.run.level, POSED_LEVEL + 1, "level after the gain");
  assertWithin(after.run.xp, CARRIED, FIGURE_TOLERANCE, "the carried overflow");
});
