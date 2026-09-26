// progression/accept-level-rises — accepting a held item raises its level by 1.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A held weapon or passive | Its level rises by `1`." The pool offers it
// as such: "every held base weapon below `MAX_WEAPON_LEVEL` ... each as a `+1
// level` offer". So a Taper held at `3` and accepted from the overlay stands at
// `4`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and Taper alone held at `3`, well under `MAX_WEAPON_LEVEL`, so
// the cap is not what this reading turns on. The offer is fixed with
// `setNextOffers` to the held weapon itself, so the acceptance is of a `+1`
// rather than of a new item. Level `3` rather than `1` so a build that sets an
// accepted item to level `1` instead of raising it reads `1` here rather than
// the right answer by accident. The slot is read whole, so a build that appended
// a second Taper rather than raising the one held shows.
//
// THE TOLERANCE. None: a level is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level the held weapon stands at before the acceptance. */
const HELD_LEVEL = 3;

/** The offer the overlay is made to present: the held weapon's own `+1`. */
const OFFERED: OfferId[] = ["taper"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the held weapon in its own slot by one level", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", HELD_LEVEL);
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
    overlay.run.weapons[0]?.level,
    HELD_LEVEL,
    "the level before the acceptance",
  );

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "level");

  assertEqual(
    after.run.weapons.length,
    1,
    "the weapon slots held after the acceptance",
  );
  assertEqual(
    after.run.weapons[0]?.id,
    "taper",
    "the weapon in the first slot",
  );
  assertEqual(
    after.run.weapons[0]?.level,
    HELD_LEVEL + 1,
    "the level after the acceptance",
  );
});
