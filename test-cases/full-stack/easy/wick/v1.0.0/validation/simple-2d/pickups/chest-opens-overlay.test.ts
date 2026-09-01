// pickups/chest-opens-overlay — collecting a chest opens the chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups") gives the chest's
// effect, "Opens the chest overlay, as `specs/progression.md` states", and
// ("Collection") the condition, a distance "less than `PICKUP_ITEM_RADIUS`
// (`16`) plus `PLAYER_RADIUS`", which a chest at the lamplighter's own center
// meets at distance 0. specs/progression.md ("The chest overlay"): "On the tick
// it is collected the tick runs to completion, the chest's result is applied as
// `specs/evolutions.md` states, `chestResult` records it, and `screen` becomes
// `chest` with `menuIndex` `0`." So one tick with a chest on the center ends on
// `chest`, `menuIndex` 0, `chestResult` set, and no pickup left on the field.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// else can open a screen, queue a level-up, or end the run over the reading,
// and phase 12's other two outcomes cannot happen. With no weapon and no
// passive held the chest's result is the heal of specs/evolutions.md's third
// rule, which needs no draw and no loadout, so the reading is about the overlay
// rather than about which result was rolled. `isolate` poses `ISOLATE_LEVEL`
// (50) and nothing grants experience, so no level-up overlay competes with the
// chest's.
//
// WHAT IS READ. The snapshot of that single tick: `screen` `chest`, `menuIndex`
// 0, `chestResult` set, and the chest gone from the field.
//
// TOLERANCE. None: a screen, an index, a count, and whether a result is present
// are all decided exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the tick on the chest overlay when a chest is collected", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the chest is collected on");
  const { player } = posed.run;
  spawnPickupAt(h, "chest", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "opened");

  assertLength(after.run.pickups, 0, "pickups left after the collecting tick");
  assertEqual(after.screen, "chest", "the screen the collecting tick ended on");
  assertEqual(after.menuIndex, 0, "menuIndex on the chest overlay");
  assertNotNull(after.run.chestResult, "the chest result the tick recorded");
});
