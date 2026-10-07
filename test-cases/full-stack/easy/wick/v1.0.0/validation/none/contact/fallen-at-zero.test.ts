// contact/fallen-at-zero — health at 0 ends the run fallen.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "A run
// ends at the end of a tick, after every other phase of that tick has been
// applied, in one of two ways", with the row "Fallen | `hp` is `0` or below. |
// `fallen`". The ending is phase 11 of "One tick", after contact at phase 7,
// so the tick a hit takes `hp` below 0 on is the tick the run ends on. The end
// screen arrives with "`menuIndex` is `0` on arriving" (specs/ui.md — "`fallen`
// and `dawn`").
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off,
// `hp` posed to 5 through `setHp`, and one rat 5 units from the lamplighter's
// center, well inside its radius 12 plus `PLAYER_RADIUS` 12. Its damage is 8
// (specs/enemies.md) and its cooldown the 0 it spawned with, so its hit lands
// on the first tick and takes `hp` to -3. The tick is run and the screen read
// off its snapshot; the replay runs on for a second so the end screen is seen.
//
// THE TOLERANCE. None: a screen name and a menu index are exact. That the hit
// took `hp` to or below 0 is read as well, so a build whose rat never hit is
// told apart from one whose ending never fired.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The health posed before the hit: short of a rat's 8. */
const POSED_HP = 5;

/** How far from the center the rat is posed: well inside 12 + 12. */
const RAT_OFFSET = 5;

/** Frames run on the end screen after the ending tick, for the replay. */
const TRAIL_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the tick a hit takes hp below 0, on fallen with menuIndex 0", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await h.debug.setHp(POSED_HP);
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);

  const ended = await captureReplay(h, "fallen", async () => {
    const after = await h.step(1);
    await h.step(TRAIL_FRAMES);
    return after;
  });

  assertLessThanOrEqual(
    player(ended).hp,
    0,
    "hp after the rat's hit on an hp of 5",
  );
  assertEqual(ended.run.tick, 1, "the run clock on the ending tick");
  assertEqual(ended.screen, "fallen", "the screen the ending tick left");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at fallen");
});
