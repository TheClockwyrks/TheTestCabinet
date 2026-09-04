// Wick — pickups/all-drafts-collected: every draft meeting the condition is collected that tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "Every bread
// and draft that meets the condition on a tick is collected on that tick. Of
// the chests that meet it on one tick, the one with the lowest `id` alone is
// collected, and the others wait." The condition is a distance "less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", which all three pickups
// meet at the lamplighter's own center, distance 0. So one tick with two bread
// and a draft on the center leaves no pickup on the field, and the one-at-a-
// time rule that governs chests does not reach these two kinds.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// else can remove a pickup and nothing can drop another over the reading. No
// chest is placed, so no overlay can end the tick early and leave the rest
// waiting for a reason other than the rule. `hp` is posed to `POSED` (20), 80
// under the `maxHp` of 100 that no Tallow leaves, so both breads' heals of 30
// land clear of the cap and the health gained names how many of them were
// taken. The draft attracts gems, and no gem is on the field, so its collection
// changes nothing but the pickup count.
//
// WHAT IS READ. After one tick: no pickup on the field, and `hp` risen by two
// bread heals, which says both breads were taken rather than one of them twice
// counted.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `hp`, a sum of stated figures read
// back as a double; none on the counts.
//
// The other kind is `pickups/all-bread-collected`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** How many of the kind lie on the lamplighter's center. */
const POSED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("collects two drafts on the same tick", async () => {
  isolate(h);
  h.debug.setHp(10);
  const { player } = h.snapshot().run;
  for (let i = 0; i < POSED; i += 1) {
    spawnPickupAt(h, "draft", player.x, player.y);
  }
  assertLength(
    h.snapshot().run.pickups,
    POSED,
    "pickups on the center before the tick",
  );

  const after = await h.tick(1);
  captureStill(h, "all");

  assertLength(after.run.pickups, 0, "pickups left after the tick");
});
