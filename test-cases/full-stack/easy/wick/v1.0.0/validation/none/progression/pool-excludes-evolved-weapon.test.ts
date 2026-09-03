// progression/pool-excludes-evolved-weapon — an evolved weapon is never a
// candidate.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// "An evolved weapon is never a candidate", and the pool's own clauses reach
// only "every held BASE weapon below `MAX_WEAPON_LEVEL`" and "every BASE weapon
// not held". specs/evolutions.md agrees: "An evolved weapon has a single level
// and no level table ... it is never leveled further. It is never a level-up
// offer". Pyre is one of "the six ids ... `EVOLUTION_IDS`". So a held Pyre is
// in no pool.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and Pyre alone held, placed through `setWeapon`, whose `id` is
// "a weapon id, base or evolved". Pyre is posed alone so the reading is about
// the evolved weapon itself; that holding it also bars Taper is
// `progression/pool-excludes-base-of-evolved`'s point.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
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

it("leaves a held evolved weapon out of the pool", async () => {
  await isolate(h);
  await holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h);
  await captureStill(h, "evolved");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.weapons[0]?.id,
    "pyre",
    "the weapon held in the first slot",
  );
  assertEqual(
    overlay.run.pool.includes("pyre"),
    false,
    "whether the pool holds the held Pyre",
  );
});
