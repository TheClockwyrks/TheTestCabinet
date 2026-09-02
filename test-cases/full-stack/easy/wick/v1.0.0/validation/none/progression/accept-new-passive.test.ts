// progression/accept-new-passive — accepting a new passive fills the first free
// passive slot at level 1.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A weapon or passive not held | It enters the first free slot of its
// kind at level `1`." "Slots" states it for every acquisition: "An item enters
// the first free slot of its kind at level `1`", and "A run starts with ...
// every other slot empty", so the first free passive slot is the first one. A
// passive slot "holds one passive at one level", which the snapshot reports as
// "`passives: [{ id, level }]`" (specs/instrumentation.md).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no passive held, so the whole passive list after the
// acceptance is the one entry it created and a build that appended it in the
// wrong place or at the wrong level shows. The offer is fixed with
// `setNextOffers`, so the accepted item is known rather than drawn. Brass is
// chosen because its effect is armor, which nothing in an empty night reads, so
// the acceptance changes only the slot.
//
// THE TOLERANCE. None: an id and a level are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The offer the overlay is made to present: a passive the run does not hold. */
const OFFERED: OfferId[] = ["brass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the accepted passive in the first passive slot at level 1", async () => {
  await isolate(h);
  await h.debug.setNextOffers(OFFERED);

  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    overlay.run.offers,
    OFFERED,
    "the offers the overlay presents",
  );
  assertEqual(
    overlay.run.passives.length,
    0,
    "the passive slots held before the acceptance",
  );

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "passive");

  assertDeepEqual(
    after.run.passives,
    [{ id: "brass", level: 1 }],
    "the passive slots after the acceptance",
  );
});
