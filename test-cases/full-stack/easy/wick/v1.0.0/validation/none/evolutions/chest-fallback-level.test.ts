// Wick — evolutions/chest-fallback-level: a chest with nothing eligible to
// evolve raises one held item by one level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen uniformly at
// random and rises by `1`, exactly as accepting a `+1 level` offer does. The result is `{ kind: "level", item, level }`, with
// `level` the level it became." With Taper at level `3` and Brass at level `1`,
// nothing is eligible to evolve — Taper is below `MAX_WEAPON_LEVEL` (`8`) — and
// both items are below their max, Brass topping out at `3`
// (`specs/passives.md`). So the chest raises exactly one of the two by one, the
// other stands where it was, and the result names the item raised and the level
// it became.
//
// WHICH OF THE TWO IS NOT PINNED. The draw is "uniformly at random", so the
// specification fixes that one of the two rises rather than which. That the
// choice varies at all is `chest-level-choice-varies`; that it skips a maxed
// item is `chest-level-skips-maxed`; which item a posed chest levels is
// `instrumentation/set-next-chest-item`.
//
// THE POSE. An isolated night with Taper at level 3 and Brass at level 1, and
// the chest reached the real way through the harness's `openChest`.
//
// TOLERANCE. None: the levels and the result's fields are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  passiveIn,
  weaponIn,
  type Harness,
} from "../harness";
import { chestOutcome } from "./stage";

/** Taper's posed level: below `MAX_WEAPON_LEVEL`, so nothing is eligible to evolve. */
const TAPER_LEVEL = 3;

/** Brass's posed level: below its max of `3`. */
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises one of Taper 3 and Brass 1 by a level and reports the item and the level it became", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", TAPER_LEVEL, 0);
  await holdPassive(h, "brass", BRASS_LEVEL, 0);

  const opened = await openChest(h);
  await captureStill(h, "leveled");

  const result = chestOutcome(opened, "the chest with Taper 3 and Brass 1");
  assertEqual(result.kind, "level", "the chest result's kind");
  if (result.kind !== "level") return;
  assertContains(["taper", "brass"], result.item, "the item the chest leveled");
  const taper = weaponIn(opened, "taper")?.level;
  const brass = passiveIn(opened, "brass")?.level;
  if (result.item === "taper") {
    assertEqual(result.level, TAPER_LEVEL + 1, "the level Taper became");
    assertEqual(taper, TAPER_LEVEL + 1, "Taper's level after the chest");
    assertEqual(brass, BRASS_LEVEL, "Brass's level after the chest");
  } else {
    assertEqual(result.level, BRASS_LEVEL + 1, "the level Brass became");
    assertEqual(brass, BRASS_LEVEL + 1, "Brass's level after the chest");
    assertEqual(taper, TAPER_LEVEL, "Taper's level after the chest");
  }
});
