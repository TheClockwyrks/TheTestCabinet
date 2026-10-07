// pickups/one-chest-per-tick — of the chests meeting the condition on a tick,
// only the lowest id is collected, and the rest wait.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "Every bread
// and draft that meets the condition on a tick is collected on that tick. Of
// the chests that meet it on one tick, the one with the lowest `id` alone is
// collected, and the others wait for the next `playing` tick."
// specs/progression.md ("The chest overlay") adds what happens in between: the
// tick that collects one ends on `chest`, and "The simulation does not tick
// while the overlay is open; `confirm` closes it, setting `chestResult` to
// `null` and `screen` to `playing`." The screen is put back to `playing` here
// by `setScreen`, which "sets the screen and nothing else"
// (specs/instrumentation.md), so the next tick runs without this point passing
// through the overlay's own `confirm`, which another point decides. So two
// chests on the lamplighter's center are collected one tick apart, lowest id
// first, with the overlay between them.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// else can remove a chest or open a screen over the reading. Both chests are
// placed at the lamplighter's own center, distance 0, so both meet the
// condition on the same tick and the rule that separates them is the id rule
// alone; `spawnPickup` "Places one pickup of `kind` ... with the next id"
// (specs/instrumentation.md), so the first placed carries the lower id. With no
// weapon and no passive held each chest's result is the heal of
// specs/evolutions.md's third rule, so neither collection changes the loadout
// the next one is read against.
//
// WHAT IS READ. After the first tick: the lower-id chest gone, the higher-id
// chest still on the field, and the screen on `chest`. Then the overlay is
// closed and one more tick runs: the second chest gone and the overlay open
// again.
//
// TOLERANCE. None: a count, an id, and a screen are all decided exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertUndefined,
} from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { pickupById, pickupOf } from "./night";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("collects the lower-id chest alone and the other on the next playing tick", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const first = spawnPickupAt(h, "chest", player.x, player.y);
  const second = spawnPickupAt(h, "chest", player.x, player.y);
  assertLessThan(first, second, "the id of the chest placed first");

  const opened = await h.tick(1);
  captureStill(h, "one");

  assertLength(opened.run.pickups, 1, "chests left after the first tick");
  assertUndefined(
    pickupById(opened, first),
    "the lower-id chest after the first tick",
  );
  assertEqual(
    pickupOf(opened, second).id,
    second,
    "the chest the first tick left waiting",
  );
  assertEqual(opened.screen, "chest", "the screen the first tick ended on");

  h.debug.setScreen("playing");
  const next = await h.tick(1);

  assertLength(next.run.pickups, 0, "chests left after the next playing tick");
  assertEqual(
    next.screen,
    "chest",
    "the screen the next playing tick ended on",
  );
});
