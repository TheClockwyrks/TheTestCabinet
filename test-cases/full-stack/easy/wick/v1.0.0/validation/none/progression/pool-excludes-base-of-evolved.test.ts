// progression/pool-excludes-base-of-evolved — the base of a held evolved weapon
// is not a candidate.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// "when a weapon slot is free, every base weapon not held WHOSE EVOLUTION IS NOT
// HELD, each as a new item", and "An evolved weapon is never a candidate, and
// neither is the base weapon it came from". specs/evolutions.md: "The base
// weapon it replaced is gone from the loadout, and while the evolved weapon is
// held that base weapon is not a level-up candidate either." `EVOLUTIONS` gives
// Pyre's base as Taper. So with Pyre held and weapon slots free, Taper is in no
// pool.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and Pyre alone held, so five weapon slots are free and the
// new-item clause is open: every base weapon but Taper is a candidate, and
// Taper is barred by its evolution alone rather than by a full loadout. Ember is
// read alongside it as the control, because a build that closed the new-item
// clause entirely would leave Taper out for the wrong reason and must fail a
// different point rather than pass this one.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { EVOLUTIONS, WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The base weapon Pyre comes from, as `EVOLUTIONS` gives it. */
const PYRE_BASE = EVOLUTIONS.pyre.from;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Taper out of the pool while Pyre is held and a slot is free", async () => {
  await isolate(h);
  await holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h);
  await captureStill(h, "base");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.weapons.length < WEAPON_SLOTS,
    true,
    "whether a weapon slot is free with Pyre alone held",
  );
  assertContains(
    overlay.run.pool,
    "ember",
    "the pool, for a base weapon whose evolution is not held",
  );
  assertEqual(
    overlay.run.pool.includes(PYRE_BASE),
    false,
    "whether the pool holds the base weapon Pyre came from",
  );
});
