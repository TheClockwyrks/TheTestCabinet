// Wick — enemies/mothwing-drops-chest: a mothwing killed by a weapon leaves
// exactly one chest where it died, and no gem.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Elites and the Dark"): Mothwing's row is rank
//     `elite` and drops a `chest`.
//   - `specs/enemies.md` ("Drops"): "A death leaves its drop at the enemy's
//     center on the tick it dies", and an `elite` leaves "One chest".
//   - `specs/world.md` ("Pickups"): a `chest` is dropped by "An elite, at its
//     position, on the tick it dies"; ("The drop roll"): "Elites and the Dark
//     make no draw; an elite drops its chest", so the chest is the whole of
//     what the death leaves.
//
// WHAT IS READ. The one tick the bolt kills the mothwing on: `pickups` holds
// exactly one entry, its kind is `chest`, it lies at the center the mothwing
// stood on, and `gems` is empty.
//
// HOW THE NIGHT IS POSED, AND THE TOLERANCE. `enemies/kill`: one mothwing 150
// units along +x with its hp posed to 1, one Ember bolt on its center, every
// switch off, and the field read on the tick it died. 150 units is past the
// `PICKUP_ITEM_RADIUS` plus `PLAYER_RADIUS` a chest is collected within
// (specs/world.md, "Collection"), so the chest lies where it fell rather than
// opening the overlay. The position is compared against the posed center within
// `FIGURE_TOLERANCE`; the counts and the kind are compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, present, type Harness } from "../harness";
import { assertDroppedAt, killByBolt } from "./kill";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves one chest and no gem where the mothwing died", async () => {
  const { after, at } = await killByBolt(h, "mothwing", "chest");

  assertEqual(after.run.pickups.length, 1, "the pickups the mothwing left");
  const chest = present(after.run.pickups[0], "the chest the mothwing dropped");
  assertEqual(chest.kind, "chest", "the kind of what the mothwing left");
  assertDroppedAt(chest, at, "the mothwing's chest");
  assertEqual(after.run.gems.length, 0, "the gems the mothwing left");
});
