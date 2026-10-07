// progression/pool-excludes-maxed-weapon — a base weapon at MAX_WEAPON_LEVEL is
// not a candidate.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// the pool holds "every held base weapon BELOW `MAX_WEAPON_LEVEL` ... as a
// `+1 level` offer", and "Slots" fixes "Max level of a base weapon |
// `MAX_WEAPON_LEVEL` | `8`" with "A base weapon levels up to
// `MAX_WEAPON_LEVEL`". A weapon standing at `8` is therefore neither a `+1`
// candidate nor a new item, because it is held.
//
// WHY THE WORLD IS POSED AS IS. An isolated night with every faculty held,
// nothing alive, and Taper alone held at exactly `MAX_WEAPON_LEVEL`. The
// boundary is posed at the cap itself rather than past it, because the cap is
// the value the rule turns on: a build whose comparison is `<=` rather than `<`
// offers a ninth level here and nowhere else. The weapon slots are otherwise
// free, so a build that dropped the maxed weapon out of the loadout entirely
// would show it back as a new item, which this reading also catches.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
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

it("leaves a weapon standing at the cap out of the pool", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL);

  const overlay = await openLevelUp(h);
  await captureStill(h, "maxed");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.weapons[0]?.level,
    MAX_WEAPON_LEVEL,
    "the level the Taper stands at",
  );
  assertEqual(
    overlay.run.pool.includes("taper"),
    false,
    "whether the pool holds the Taper at MAX_WEAPON_LEVEL",
  );
});
