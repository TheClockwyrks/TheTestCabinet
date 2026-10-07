// Wick — instrumentation/clear-pickups: `clearPickups()` with a chest, bread,
// and a draft on the field leaves `pickups` empty, hp unchanged, no gem
// attracted, and no overlay opened.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearPickups()`: "Removes every pickup; nothing is collected." A collected
// bread would heal, a draft would attract every gem, and a chest would open
// the overlay (`specs/world.md`, "Pickups").
//
// THE POSE. An isolated run with hp posed to 50 and a far gem, the three
// pickups placed, the call read at the call, and one tick to show no overlay
// follows.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";

const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes every pickup and collects nothing", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  const gem = placeGem(h, "small", 300, 0);
  placePickup(h, "chest", 100, 0);
  placePickup(h, "bread", -100, 0);
  placePickup(h, "draft", 0, 100);
  assertLength(h.snapshot().run.pickups, 3, "pickups before the call");

  h.debug.clearPickups();
  const after = h.snapshot();
  assertDeepEqual(after.run.pickups, [], "pickups after clearPickups");
  assertEqual(after.run.player.hp, POSED_HP, "player.hp after clearPickups");
  assertEqual(
    gemById(after, gem)?.attracted,
    false,
    "the gem's attraction after clearPickups",
  );
  assertEqual(after.screen, "playing", "screen at the call");

  const ticked = await advanceTicks(h, 1);
  captureStill(h, "cleared");
  assertEqual(ticked.screen, "playing", "screen after the next tick");
  assertEqual(ticked.run.chestResult, null, "chestResult after the next tick");
});
