// progression/pool-new-weapons-with-free-slot — the pool offers new base
// weapons while a weapon slot is free.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// "when a weapon slot is free, every base weapon not held whose evolution is not
// held, each as a new item", and "The base weapons are the ten in
// `BASE_WEAPON_IDS`". "Slots" fixes "Weapon slots | `WEAPON_SLOTS` | `6`", and
// "A run starts with Taper at level `1` in the first weapon slot, every other
// slot empty". So with Taper alone held, five weapon slots are free and no
// evolution is held, and the pool holds all nine base weapons that are not
// Taper.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, over the loadout a run starts with: Taper alone, kept
// rather than removed, so the free-slot clause is read against the arrangement
// every run begins in. All nine are asserted rather than one, because the rule
// is about the whole set of base weapons a build has to enumerate, and a build
// that offers only some of them fails here and nowhere else.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BASE_WEAPON_IDS, WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The nine base weapons a run does not start holding. */
const NOT_HELD = BASE_WEAPON_IDS.filter((id) => id !== "taper");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds all nine base weapons a run does not start with", async () => {
  await isolate(h, { taper: true });

  const overlay = await openLevelUp(h);
  await captureStill(h, "new");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.weapons.length < WEAPON_SLOTS,
    true,
    "whether a weapon slot is free with Taper alone held",
  );
  assertDeepEqual(
    NOT_HELD.filter((id) => !overlay.run.pool.includes(id)),
    [],
    "the unheld base weapons the pool left out with a slot free",
  );
});
