// Wick — progression/overlay-opens-same-tick: the overlay opens at the end of
// the very tick the first level-up is queued.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// level-up overlay": "A `playing` tick that ends with `pendingLevelUps` above
// `0` runs to completion and then opens the overlay: `screen` becomes
// `levelup` with `menuIndex` `0`. The overlay therefore opens on the same tick
// the first level-up is queued". `specs/world.md` puts the overlays in phase
// 12, after the gems of phase 9, so one tick both collects the gem and opens
// the overlay.
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `4`, and one small gem on the lamplighter's own center: `4 + 1` reaches
// `xpToNext(1)` (`5`), so the collecting tick queues the level-up. Exactly one
// tick is run, so a build that opens the overlay on the tick after the gain
// reads `playing` here and fails.
//
// THE TOLERANCE. Exact: a screen name and a whole menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const LEVEL = 1;
const XP_BEFORE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the collecting tick on levelup with menuIndex 0", async () => {
  const { player } = isolate(h).run;
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placeGem(h, "small", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "opened");

  assertEqual(
    after.run.pendingLevelUps,
    1,
    "run.pendingLevelUps the collecting tick queued",
  );
  assertEqual(
    after.screen,
    "levelup",
    "screen at the end of the tick that queued the level-up",
  );
  assertEqual(after.menuIndex, 0, "menuIndex on the opened overlay");
});
