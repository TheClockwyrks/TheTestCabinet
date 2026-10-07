// Wick — instrumentation/set-kills: `setKills(250)` reads back `kills` 250,
// and the next kill reads 251.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setKills(kills)`: "Sets `kills` to `kills`, a whole number of at least
// `0`." `specs/enemies.md`, "The life of an enemy": a hit removes the weapon's
// damage, and an enemy whose hp is at or below 0 dies: "the kill count rises
// by one". `specs/world.md`, phase 6: a posed projectile hits at the position
// it was created at on its first tick.
//
// THE DRIVE. An isolated run, the pose read at the call, then a moth (5 hp)
// with a posed Ember bolt (10 damage with Ember not held) on its center, and
// one tick: the bolt's hit kills it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

const POSED_KILLS = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the kill count and the next kill adds one", async () => {
  isolate(h);
  h.debug.setKills(POSED_KILLS);
  assertEqual(
    h.snapshot().run.kills,
    POSED_KILLS,
    "run.kills after setKills(250)",
  );

  placeEnemy(h, "moth", 100, 0);
  placeProjectile(h, "ember", 100, 0, 0, 0, 0);
  const after = await advanceTicks(h, 1);
  captureStill(h, "posed");
  assertEqual(after.run.enemies.length, 0, "enemies after the killing tick");
  assertEqual(
    after.run.kills,
    POSED_KILLS + 1,
    "run.kills after the next kill",
  );
});
