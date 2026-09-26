// progression/multiple-level-ups-queue — one gem carrying enough experience for
// two levels raises the level twice and queues two level-ups.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Levels and experience: "After
// every gain, while xp >= xpToNext(level): xp falls by xpToNext(level), level
// rises by 1, and one level-up is queued in pendingLevelUps ... one gem can
// queue several level-ups when it carries enough experience for them." The
// thresholds are XP_BASE (5) at level 1 and 15 at level 2, from the same
// section's formula and table, and a small gem is worth GEM_VALUES.small (1)
// by specs/world.md, Gems. From xp 19 the gain reaches 20, which clears 5 and
// then clears the 15 that follows, leaving 0 at level 3.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the gem is the run's only experience. Level 1 and
// xp 19 are posed through setLevel and setXp, of which "No level-up is derived
// from it: a level-up comes from the next gain" (specs/instrumentation.md), and
// one small gem is placed at the lamplighter's center, where phase 9 of
// specs/world.md collects it on the next tick.
//
// THE TOLERANCE. FIGURE_TOLERANCE on xp, a real number the spec states exactly
// (19 + 1 − 5 − 15 = 0); level and pendingLevelUps are whole counts. A build
// that applies one level-up per gain reads level 2 with xp 15 and one queued.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, xpToNext } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The level the gem is collected at. */
const POSED_LEVEL = 1;

/** The experience posed: one short of both thresholds together, 5 + 15 − 1. */
const POSED_XP = xpToNext(1) + xpToNext(2) - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads level 3, xp 0, and pendingLevelUps 2 when one small gem clears two thresholds", async () => {
  isolate(h);
  // Spending experience on levels is the requirement, so `progression` is the one faculty turned back on.
  enable(h, "progression");
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "queued");

  assertEqual(after.run.gems.length, 0, "the gem was collected");
  assertEqual(after.run.level, POSED_LEVEL + 2, "level after the gain");
  assertWithin(after.run.xp, 0, FIGURE_TOLERANCE, "xp after the gain");
  assertEqual(after.run.pendingLevelUps, 2, "level-ups queued by the gain");
});
