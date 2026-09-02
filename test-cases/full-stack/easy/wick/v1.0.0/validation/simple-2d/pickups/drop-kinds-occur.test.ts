// pickups/drop-kinds-occur — both bread and drafts are actually dropped.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") gives both
// branches a probability above zero, `BREAD_CHANCE` (0.02) and `DRAFT_CHANCE`
// (0.005), and specs/world.md ("Pickups") lists bread and draft as kinds "A
// common enemy" drops "by the roll below". Over `DROP_SAMPLE` (4000) kills the
// expected counts are 80 bread and 19.6 drafts, so a build that has wired
// either branch up at all leaves at least one of each: the chance a conformant
// build drops no bread is 0.98^4000, and no draft 0.99510^4000, each below
// 1e-9. This is the point that catches a build implementing one branch and not
// the other, which the two count points cannot separate from a rate that is
// merely low.
//
// THE WORLD. The seeded sample of `pickups/sample.ts`: 4000 moths killed by
// posed Ember bolts, each on a point no other kill uses, with every driver
// switch off and no weapon held, so the drop roll is the only thing that can
// leave a pickup anywhere.
//
// WHAT IS READ. The number of bread and the number of drafts the sample left,
// each at least one.
//
// TOLERANCE. None on a count. The bound is the weakest one the sample admits,
// so no conformant build fails it for a reason of luck.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { drawDrops } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops at least one bread and at least one draft across 4000 seeded kills", async () => {
  const sample = await drawDrops(h, "kinds");

  assertGreaterThanOrEqual(
    sample.counts.bread,
    1,
    `bread dropped over ${sample.kills} seeded common kills`,
  );
  assertGreaterThanOrEqual(
    sample.counts.draft,
    1,
    `drafts dropped over ${sample.kills} seeded common kills`,
  );
});
