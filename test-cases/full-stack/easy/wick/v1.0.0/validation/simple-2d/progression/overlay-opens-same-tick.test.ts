// progression/overlay-opens-same-tick — the tick that queues the first level-up
// is the tick that ends on the overlay.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The level-up overlay: "A
// playing tick that ends with pendingLevelUps above 0 runs to completion and
// then opens the overlay: screen becomes levelup with menuIndex 0. The overlay
// therefore opens on the same tick the first level-up is queued, and the
// simulation does not tick while it is open". Phase 12 of specs/world.md, One
// tick, places that opening at the end of the tick, after every other phase.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the gem the scenario places is the run's only
// experience and no other faculty can end the tick differently. Level 1 and xp
// 4 are posed, one small gem (GEM_VALUES.small, 1, by specs/world.md) short of
// the XP_BASE (5) threshold, and the gem is placed at the lamplighter's center,
// which phase 9 of specs/world.md attracts, flies, and collects on the next
// tick. Exactly one tick is run, so what it ends on is the reading.
//
// THE TOLERANCE. None: after one tick the screen is levelup or it is not, and
// menuIndex is a whole count. A build that opens the overlay on the tick after
// the gain reads playing here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The level the gain is read at, whose threshold is XP_BASE. */
const POSED_LEVEL = 1;

/** The experience posed: one small gem short of the threshold. */
const POSED_XP = XP_BASE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the gem's own tick on levelup with menuIndex 0", async () => {
  isolate(h);
  // Spending experience on levels is the requirement, so `progression` is the one faculty turned back on.
  enable(h, "progression");
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnGemAt(h, "small", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "opened");

  assertEqual(after.run.level, POSED_LEVEL + 1, "the gain the tick made");
  assertEqual(after.screen, "levelup", "the screen the gain's tick ended on");
  assertEqual(after.menuIndex, 0, "the highlight the overlay opened at");
});
