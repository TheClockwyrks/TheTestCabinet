// passives/brass-armor-derived — Brass sets `armor` to one per level held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `BRASS_ARMOR_PER_LEVEL` is `1`, and
// "armor = BRASS_ARMOR_PER_LEVEL × brass", so Brass 3 is `3` and Brass 1 is
// `1`. The same file's Armor section names the ceiling: "Brass tops out at
// level `3`, so armor is at most `3`". `armor` is a field of the snapshot's
// run (`specs/instrumentation.md`, Snapshot shape), read straight off it, so
// this check reads the derived stat itself; what the stat does to a contact
// hit is `contact/armor-reduces-hit`'s point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing at all, so
// `armor` reads `0` before either pose and the only thing that moves it is the
// Brass level. Two levels are posed into the same slot in turn, the maximum
// and the minimum, so a build that read the level as a flag rather than as a
// count fails on one of them. No tick is needed: `setPassive` says "`armor`
// ... follow[s] from the next read" (`specs/instrumentation.md`).
//
// THE TOLERANCE. Whole numbers, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES, armorOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The slot Brass is posed into: the first, which an isolated run leaves free. */
const SLOT = 0;

/** Brass's max level, `3`, and the least level a held passive can carry. */
const HIGH = PASSIVES.brass.maxLevel;
const LOW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads armor 3 with Brass 3 held and 1 with Brass 1", async () => {
  const start = isolate(h);
  assertEqual(
    start.run.armor,
    0,
    "armor with no Brass held (specs/passives.md, The derived stats)",
  );

  h.debug.setPassive(SLOT, "brass", HIGH);
  assertEqual(
    h.snapshot().run.armor,
    armorOf(HIGH),
    "armor with Brass 3 held (specs/passives.md, The derived stats)",
  );

  h.debug.setPassive(SLOT, "brass", LOW);
  const low = h.snapshot();
  await h.frameDraw();
  captureStill(h, "armor");
  assertEqual(
    low.run.armor,
    armorOf(LOW),
    "armor with Brass 1 held (specs/passives.md, The derived stats)",
  );
});
