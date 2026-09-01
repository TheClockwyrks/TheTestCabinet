// progression/pool-no-new-weapon-when-full — the pool offers no new weapon with
// every weapon slot filled.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// a base weapon not held enters the pool "WHEN a weapon slot is free", and
// "Slots" fixes "Weapon slots | `WEAPON_SLOTS` | `6`" with "An item enters the
// first free slot of its kind". With six weapons held there is no free slot, so
// no base weapon that is not held is a candidate.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, with six base weapons held at level `1`. Level `1` rather
// than the cap, so every held weapon is still a `+1` candidate and the pool is
// not empty: what this point reads is the absence of the four weapons that are
// not held, not an empty pool. The passive slots are untouched and every passive
// is still a candidate, so a build that empties the pool wholesale rather than
// closing the weapon clause fails a different point than this one.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { FULL_WEAPONS, SPARE_WEAPONS } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every unheld base weapon out once six are held", async () => {
  await isolate(h);
  for (const id of FULL_WEAPONS) await holdWeapon(h, id, 1);

  const overlay = await openLevelUp(h);
  await captureStill(h, "full");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.weapons.length,
    WEAPON_SLOTS,
    "the weapon slots held",
  );
  assertDeepEqual(
    SPARE_WEAPONS.filter((id) => overlay.run.pool.includes(id)),
    [],
    "the unheld base weapons the pool offered with every slot filled",
  );
});
