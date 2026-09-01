// pickups/gem-collected-same-tick-as-drop — a gem dropped at the lamplighter is
// collected on the tick it dropped.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick") orders the tick:
// phase 6 kills, where "an enemy whose `hp` is at or below `0` dies: its drop
// and its bread or draft land at its center, at rest for this tick", and phase
// 9 gems, "every gem within `pickupRadius` becomes attracted ... and every gem
// within `COLLECT_RADIUS` is collected, this tick's drops and the gems a draft
// attracted on this tick included. A gem dropped on this tick is attracted and
// collected by the same tests as any other and takes its first flight step on
// the next tick." A moth killed on the lamplighter's own center therefore drops
// its gem at distance `0`, which is at most `PICKUP_RADIUS` (`48`) and at most
// `COLLECT_RADIUS` (`8`), so the same tick attracts and collects it: the
// snapshot that tick leaves holds no gem, and `xp` has risen by
// `GEM_VALUES.small` (`1`), the moth's tier in specs/enemies.md.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so no Soot scales the gain
// and no other kill lands in the tick that is read. The kill is the real one:
// specs/enemies.md gives a moth `5` hp at the run clock's opening multiplier,
// and a level-1 Ember bolt carries `10` (specs/weapons.md), posed on the moth's
// center so the next tick's hit is the only thing that happens to it — a hit
// resolves whatever `effectMotion` holds. The moth is posed on the lamplighter's
// center, which is what puts the drop at distance `0`; `enemyContact` is off, so
// standing there costs no health.
//
// THE TOLERANCE. `FLOAT_TOL` on the experience, "a real number"; the kill count
// and the gem count are whole and read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, GEM_VALUES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** The gem tier specs/enemies.md gives a moth in its roster row. */
const MOTH_TIER = "small" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no gem and raises xp by the moth's tier on the tick of the kill", async () => {
  const opened = await isolate(h);
  assertEqual(
    ENEMIES.moth.drop,
    MOTH_TIER,
    "the gem tier specs/enemies.md gives a moth",
  );
  const at = opened.run.player;
  await placeEnemy(h, "moth", at.x, at.y);
  await placeProjectile(h, "ember", at.x, at.y, 0, 0, 0);

  const after = await h.step(1);
  await captureStill(h, "same");

  assertEqual(after.run.kills, opened.run.kills + 1, "the kills the tick made");
  assertEqual(after.run.gems.length, 0, "the gems left in the tick's snapshot");
  assertNear(
    after.run.xp - opened.run.xp,
    GEM_VALUES[MOTH_TIER],
    FLOAT_TOL,
    "the experience the drop granted on its own tick",
  );
});
