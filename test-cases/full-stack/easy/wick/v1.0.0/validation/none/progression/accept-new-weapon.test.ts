// progression/accept-new-weapon — accepting a new weapon fills the first free
// weapon slot at level 1.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A weapon or passive not held | It enters the first free slot of its
// kind at level `1`. A weapon's cooldown timer starts at `0`". "Slots" says the
// same of every acquisition: "An item enters the first free slot of its kind at
// level `1` and keeps that slot for the rest of the run, so slot order is
// acquisition order." So with Taper alone held, an accepted Ember stands in the
// second slot at level `1` with its timer at `0`, and Taper stands untouched in
// the first.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and the loadout a run starts with, Taper alone, so exactly one slot is filled
// and the first free one is the second. The offer is fixed with `setNextOffers`,
// which "presents exactly that list in that order" when every id is a candidate,
// so the acceptance is of a known item rather than of whatever the draw
// produced. `weaponFire` is off throughout, so no timer counts and no weapon
// fires between the pose and the reading: the `0` read on the new slot is the
// acquisition's, not a coincidence of a timer that had run down.
//
// THE TOLERANCE. Ids and levels are exact; the cooldown timer is a real number
// of seconds, read within `TIMER_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { TIMER_TOL, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The offer the overlay is made to present: a base weapon the run does not hold. */
const OFFERED: OfferId[] = ["ember"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends the accepted weapon at level 1 with its timer at 0", async () => {
  await isolate(h, { keepTaper: true });
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

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "weapon");

  assertEqual(
    after.run.weapons.length,
    2,
    "the weapon slots held after the acceptance",
  );
  assertEqual(
    after.run.weapons[0]?.id,
    "taper",
    "the weapon in the first slot",
  );
  assertEqual(
    after.run.weapons[1]?.id,
    "ember",
    "the weapon in the first free slot",
  );
  assertEqual(
    after.run.weapons[1]?.level,
    1,
    "the level the new weapon entered at",
  );
  assertNear(
    after.run.weapons[1]?.cooldown ?? Number.NaN,
    0,
    TIMER_TOL,
    "the cooldown timer the new weapon entered with",
  );
});
