// pickups/drop-at-most-one — a common kill drops at most one of bread and
// draft.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "A first
// draw, uniform on `[0, 1)`, drops bread when it is below `BREAD_CHANCE`. Only
// when it did not, a second draw drops a draft when it is below `DRAFT_CHANCE`.
// A kill therefore drops at most one of the two, and the pickup lands at the
// enemy's position beside its gem." So over any number of kills made at
// distinct points, no two pickups can share a center: a shared center would be
// one kill that dropped both. A build that draws for the draft unconditionally
// drops both on about one kill in ten thousand, so the sample is
// `DROP_TRIALS` (`4000`) kills, where such a build leaves a shared center with
// probability about a third and a conformant build never does.
//
// WHY THE WORLD IS POSED AS IT IS. `pickups/roll` makes the sample: an isolated
// night, every driver switch off, and four thousand moths killed by their own
// level-1 Oil Splash puddles on a lattice `200` units apart, each kill at its
// own point, far enough from the lamplighter that nothing is attracted or
// collected. The seed is fixed, so a build's answer here is the same on every
// run of the check.
//
// THE TOLERANCE. None: two centers are the same point or they are not, and
// every point of the lattice is a sum of exact whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEFAULT_SEED, DROP_TRIALS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sampleDrops } from "./roll";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no two pickups sharing a center over 4000 seeded kills", async () => {
  const sample = await sampleDrops(h, DEFAULT_SEED, DROP_TRIALS);
  // The still is the last batch's own frame: the field its kills left.
  captureStill(h, "one");

  assertEqual(sample.kills, DROP_TRIALS, "the common kills the sample made");
  const centers = new Set(sample.drops.map((drop) => `${drop.x},${drop.y}`));
  assertEqual(
    centers.size,
    sample.drops.length,
    `the distinct pickup centers among the ${sample.drops.length} pickups ${DROP_TRIALS} kills dropped, which must equal the count (specs/world.md, The drop roll)`,
  );
});
