// passives/brass-armor-derived — armor is derived from the Brass level held,
// one point per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "armor = BRASS_ARMOR_PER_LEVEL × brass", with BRASS_ARMOR_PER_LEVEL 1, and
// "A derived stat is computed from the levels held at the moment it is read".
// specs/instrumentation.md ("Snapshot shape") lists `armor` among the nine
// derived fields, "BRASS_ARMOR_PER_LEVEL (1) × the Brass level held". So Brass
// 3 reads 3 and Brass 1 reads 1, and the field is a read of the level rather
// than a stored number a pose could leave stale.
//
// THE WORLD. Two isolated playing runs, each posed from a reset: nothing on the
// field, no weapon held, every driver switch off, and Brass alone in the first
// passive slot, at level 3 in the first and at level 1 in the second. Nothing
// is ticked, because the reading is of the pose itself; what armor does to a
// contact hit belongs to another point.
//
// WHAT IS READ. `armor` off the snapshot at each of the two levels. Two levels
// rather than one, because a build that reports a constant 3, or the Brass
// level's maximum, passes a single reading.
//
// TOLERANCE. None: BRASS_ARMOR_PER_LEVEL is 1 and a level is a whole number, so
// armor is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { derived, type HeldPassives } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { holdPassives } from "./night";

/** The two Brass levels read, each posed from its own reset. */
const HIGH: HeldPassives = { brass: 3 };
const LOW: HeldPassives = { brass: 1 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads armor 3 with Brass 3 held and armor 1 with Brass 1 held", async () => {
  isolate(h);
  holdPassives(h, HIGH);
  const high = h.snapshot();
  assertEqual(high.run.armor, derived.armor(HIGH), "armor with Brass 3 held");

  isolate(h);
  holdPassives(h, LOW);
  const low = await h.tick(1);
  captureStill(h, "armor");
  assertEqual(low.run.armor, derived.armor(LOW), "armor with Brass 1 held");
});
