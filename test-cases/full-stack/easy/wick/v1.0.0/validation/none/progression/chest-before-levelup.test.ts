// progression/chest-before-levelup — a chest collected on a level-up tick opens
// first.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The level-up
// overlay"): "A tick that collects a chest opens the chest overlay instead, and
// the level-ups queued on that tick open their overlay at the end of the next
// `playing` tick." Its chest section repeats it: "Level-ups queued on the tick
// that collected the chest open their overlay at the end of the next `playing`
// tick." specs/world.md ("One tick") fixes the order in phase 12: "a tick that
// collected a chest opens the chest overlay, and a tick that ends with a
// level-up queued and no chest collected opens the level-up overlay". So the
// collecting tick ends on `chest` with `pendingLevelUps` still `1`, and the
// level-up overlay opens at the end of the first `playing` tick after the chest
// overlay closes.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `progression` alone
// turned back on, which is the faculty that spends a gain on a level, every
// other faculty held, and nothing alive, so the only two things that happen on
// the read tick are the two collections. A chest and a small gem are both placed at the lamplighter's
// center: the chest is collected in phase 8 and the gem in phase 9, so one tick
// does both. Level `1` with `xp` one short of `XP_BASE` makes that gem cross a
// threshold. The game is stood back on `playing` through `setScreen("playing")`,
// which "Sets `screen` to `name` ... Nothing else changes"
// (specs/instrumentation.md), so a build with a broken menu key fails the menu
// points rather than this one. No weapon
// and no passive is held, so the chest's result is the heal of rule 3 in
// specs/evolutions.md and nothing about the loadout moves under it.
//
// THE TOLERANCE. None: a screen name and a queue length are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEM_VALUES, xpToNext } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The level the gain is read from: the first, whose threshold is `XP_BASE`. */
const POSED_LEVEL = 1;

/** One short of that threshold, so one small gem crosses it. */
const POSED_XP = xpToNext(POSED_LEVEL) - GEM_VALUES.small;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the chest overlay on the tick and the level-up on the next", async () => {
  const posed = await isolate(h, { on: ["progression"] });
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);
  const at = posed.run.player;
  await h.debug.spawnPickup("chest", at.x, at.y);
  await h.debug.spawnGem("small", at.x, at.y);

  const { collected, opened } = await captureReplay(h, "chest", async () => {
    const collected = await h.step(1);
    await h.debug.setScreen("playing");
    const opened = await h.step(1);
    return { collected, opened };
  });

  assertEqual(
    collected.run.level,
    POSED_LEVEL + 1,
    "the level the collecting tick left, so a level-up was earned",
  );
  assertEqual(
    collected.screen,
    "chest",
    "the screen the tick that collected both left",
  );
  assertEqual(
    collected.run.pendingLevelUps,
    1,
    "the level-ups still queued under the chest overlay",
  );
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the first playing tick after the chest overlay closed left",
  );
});
