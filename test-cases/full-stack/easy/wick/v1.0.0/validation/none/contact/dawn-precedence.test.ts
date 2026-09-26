// contact/dawn-precedence — dawn takes precedence over falling.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "Dawn is
// checked first, so a tick on which both conditions hold ends the run at dawn."
// specs/enemies.md ("Dawn") states it again: "Dawn takes precedence over falling
// on the same tick". Both conditions are made to hold on tick 36000: the clock
// reaches `DAWN_TIME x TICK_HZ` and a moth's hit of 5 (specs/enemies.md) takes an
// `hp` of 1 to -4, which is "`0` or below".
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off, the
// clock posed to 35999 through `setTick`, `hp` posed to 1 through `setHp`, and
// one moth 5 units from the lamplighter's center, well inside its radius 10
// plus `PLAYER_RADIUS` 12, with the cooldown 0 it spawned with. Contact is
// phase 7 and the endings phase 11 (specs/world.md — "One tick"), so the hit
// lands before the endings are checked and both hold at once. One tick is run.
// That the falling condition held at all is read too, so a build whose moth
// never hit, which would pass on dawn for the wrong reason, is told apart; how
// much the hit took is the enemy roster's point, not this one.
//
// THE TOLERANCE. None: the falling condition is "`0` or below", and a screen
// name is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { MAX_POSED_TICK } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The health posed before the hit: short of a moth's 5. */
const POSED_HP = 1;

/** How far from the center the moth is posed: well inside 10 + 12. */
const MOTH_OFFSET = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends at dawn rather than fallen when a hit takes hp below 0 on tick 36000", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await h.debug.setTick(MAX_POSED_TICK);
  await h.debug.setHp(POSED_HP);
  await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);

  const after = await h.step(1);

  // The screen the ending tick left. Captured before the assertions, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "precedence");

  assertLessThanOrEqual(
    player(after).hp,
    0,
    "hp after the moth's hit on tick 36000, which must meet the falling condition",
  );
  assertEqual(
    after.screen,
    "dawn",
    "the screen a tick on which both endings hold leaves",
  );
});
