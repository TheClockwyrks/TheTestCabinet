// pickups/drop-at-most-one — a common kill drops at most one of bread and a
// draft.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"): "A first
// draw, uniform on `[0, 1)`, drops bread when it is below `BREAD_CHANCE`. Only
// when it did not, a second draw drops a draft when it is below
// `DRAFT_CHANCE`. A kill therefore drops at most one of the two, and the pickup
// lands at the enemy's position beside its gem." So over any number of kills,
// each at its own point, no kill point can carry two pickups.
//
// THE WORLD. The seeded sample of `pickups/sample.ts`: `DROP_SAMPLE` (4000)
// moths killed by posed Ember bolts, each on a point no other kill uses, with
// every driver switch off and no weapon held, so the drop roll is the only
// thing that can leave a pickup anywhere. Four thousand kills is a sample in
// which the bread branch is expected about 80 times and the draft branch about
// 20, so a build making both draws unconditionally has hundreds of chances to
// put two pickups on one point.
//
// WHAT IS READ. The most pickups any single kill point carries, at most one;
// and, as a guard on the sample itself, that no pickup fell on a point no kill
// happened at.
//
// TOLERANCE. None: this is a count over exact positions, and the kill points
// are 100 units apart, so the reading cannot confuse two neighbouring kills.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { drawDrops } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no kill point carrying two pickups across 4000 seeded kills", async () => {
  const sample = await drawDrops(h, "one");

  assertEqual(sample.strays, 0, "pickups that fell on no kill point");
  assertLessThanOrEqual(
    sample.mostPerPoint,
    1,
    `pickups on the busiest of ${sample.kills} kill points`,
  );
});
