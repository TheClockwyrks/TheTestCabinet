// progression/pool-new-passives-with-free-slot — the pool offers new passives
// while a passive slot is free.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// "when a passive slot is free, every passive not held, each as a new item".
// "Slots" fixes "Passive slots | `PASSIVE_SLOTS` | `6`" and "A run starts with
// ... every other slot empty", and specs/passives.md lists "the ten in this
// order" as `PASSIVE_IDS`. So with no passive held, six passive slots are free
// and the pool holds all ten.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no passive held at all, which is the arrangement every run
// starts in. All ten are asserted rather than one, because the rule is about the
// whole set of passives a build has to enumerate, and a build that offers only
// some of them fails here and nowhere else.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PASSIVE_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds all ten passives with no passive held", async () => {
  await isolate(h);

  const overlay = await openLevelUp(h);
  await captureStill(h, "new");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(overlay.run.passives.length, 0, "the passive slots held");
  assertDeepEqual(
    PASSIVE_IDS.filter((id) => !overlay.run.pool.includes(id)),
    [],
    "the passives the pool left out with every slot free",
  );
});
