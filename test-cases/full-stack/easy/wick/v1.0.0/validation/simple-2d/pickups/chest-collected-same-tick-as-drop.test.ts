// pickups/chest-collected-same-tick-as-drop — a chest dropped at the
// lamplighter is collected on the tick it drops.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick") puts the death in
// phase 6, "its drop and its bread or draft land at its center", and the
// collection in phase 8: "Every pickup meeting the collection condition is
// collected, this tick's drops included"; then phase 12, "a tick that collected
// a chest opens the chest overlay". specs/enemies.md ("Drops") gives an elite
// "One chest", and specs/progression.md ("The chest overlay"): "On the tick it
// is collected the tick runs to completion, the chest's result is applied ...
// `chestResult` records it, and `screen` becomes `chest` with `menuIndex` 0."
// So a mothwing killed on the lamplighter's own center leaves no pickup in that
// tick's snapshot and the tick ends on `chest` with `chestResult` set.
//
// THE WORLD. An isolated `playing` run: nothing else alive, nothing on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// but this kill can leave anything on the field. The mothwing stands on the
// lamplighter's center with its `hp` posed to 1 and one Ember bolt on that
// point, so the death is the tick's and not the pose's; `enemyContact` is off,
// so the elite standing there costs no health, and `enemyMotion` is off, so it
// stays put. The chest therefore lands at distance 0, inside
// `PICKUP_ITEM_RADIUS` (16) plus `PLAYER_RADIUS` (12), which is the case phase
// 8 is being read for. With no weapon and no passive held, the result is the
// heal of specs/evolutions.md's third rule, so the reading needs no draw and no
// loadout.
//
// WHAT IS READ. The snapshot of that single tick: the mothwing gone, no pickup
// on the field, `screen` `chest`, and `chestResult` set. A build that leaves
// the tick's own drops for the next tick ends the tick on `playing` with a
// chest lying at the center.
//
// TOLERANCE. None: a screen, a count, and whether a result is present are all
// decided exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { armKill } from "./night";

/** The elite whose drop is read: specs/enemies.md gives an elite a chest. */
const TYPE = "mothwing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no chest and ends on the chest overlay on the tick a mothwing dies at the lamplighter", async () => {
  isolate(h);
  // The chest the elite drops is what this tick is about.
  enable(h, "drops");
  armKill(h, TYPE, 0, 0);
  assertLength(h.snapshot().run.pickups, 0, "pickups before the killing tick");

  const after = await h.tick(1);
  captureStill(h, "same");

  assertLength(after.run.enemies, 0, "enemies after the killing tick");
  assertLength(
    after.run.pickups,
    0,
    "pickups in the snapshot of the killing tick",
  );
  assertEqual(after.screen, "chest", "the screen the killing tick ended on");
  assertNotNull(after.run.chestResult, "the chest result the tick recorded");
});
