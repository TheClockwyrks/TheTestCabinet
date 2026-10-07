// progression/overlay-opens-same-tick — the overlay opens on the tick the first
// level-up queues.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The level-up
// overlay"): "A `playing` tick that ends with `pendingLevelUps` above `0` runs
// to completion and then opens the overlay: `screen` becomes `levelup` with
// `menuIndex` `0`. The overlay therefore opens on the same tick the first
// level-up is queued". specs/world.md ("One tick") puts it last in the order:
// phase 12, "a tick that ends with a level-up queued and no chest collected
// opens the level-up overlay". So the tick that collects the gem crossing the
// threshold is itself the tick that ends on `levelup`, with `menuIndex` `0`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `progression` alone
// turned back on, which is the faculty that spends a gain on a level, and every
// other faculty held, nothing alive, and no slot held, so nothing but the gem
// happens on the tick that is read. Level `1` with `xp` one short of `XP_BASE` and a small gem at
// the lamplighter's center is the shortest real gain that crosses a threshold,
// and it is collected in phase 9 of the very tick whose end is read, so a build
// that defers the overlay to the following tick reads `playing`. No chest is on
// the field, so the phase 12 ordering that would put a chest first does not
// apply here; that ordering is `progression/chest-before-levelup`'s.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

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

it("ends the gaining tick on levelup with menuIndex 0", async () => {
  await isolate(h, { on: ["progression"] });
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);

  const after = await collectGem(h, "small");
  await captureStill(h, "opened");

  assertEqual(
    after.run.pendingLevelUps,
    1,
    "the level-ups the gaining tick queued",
  );
  assertEqual(after.screen, "levelup", "the screen the gaining tick left");
  assertEqual(after.menuIndex, 0, "the menu index the overlay opened at");
});
