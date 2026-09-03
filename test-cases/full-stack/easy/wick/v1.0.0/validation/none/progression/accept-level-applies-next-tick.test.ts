// progression/accept-level-applies-next-tick — a leveled item's row applies from
// the next tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A held weapon or passive | Its level rises by `1`. ITS TABLE ROW and
// its derived-stat terms READ THE NEW LEVEL FROM THE NEXT TICK." specs/weapons.md
// gives `TAPER_LEVELS`: row `1` has damage `10` and row `2` has damage `15`, and
// a slash's damage is the row's damage times `damageMul`, which specs/passives.md
// leaves at `1` with no Wick held. specs/instrumentation.md reports the figure
// on the shape: a zone's "`damage`". So a Taper raised from `1` to `2` cuts for
// `15` on its next slash.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing alive and
// Taper alone held at level `1`, its timer at `0` from the acquisition so it is
// due on the first tick it gets, and `weaponFire` held off until that tick, so
// exactly one slash happens and it happens after the acceptance. The offer is
// fixed with `setNextOffers` to Taper's own `+1`, and the acceptance takes the
// queue to `0` so the overlay closes and the simulation resumes. No enemy is
// posed, because Taper needs no target and the reading is the shape's own
// damage rather than what it did to anything.
//
// THE TOLERANCE. The damage is a real number, read within `FLOAT_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
} from "../assert";
import { FLOAT_TOL, weaponRow, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  newZones,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level the held weapon stands at before the acceptance. */
const HELD_LEVEL = 1;

/** The damage `TAPER_LEVELS` gives the level the acceptance leaves. */
const RAISED_DAMAGE = weaponRow("taper", HELD_LEVEL + 1).damage;

/** The offer the overlay is made to present: the held weapon's own `+1`. */
const OFFERED: OfferId[] = ["taper"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("cuts for the new row's damage on the slash after the level", async () => {
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

  await h.debug.choose(0);
  const accepted = await h.snapshot();
  assertEqual(
    accepted.screen,
    "playing",
    "the screen the last acceptance returned to",
  );
  assertEqual(
    accepted.run.weapons[0]?.level,
    HELD_LEVEL + 1,
    "the level the acceptance left",
  );

  await enable(h, "weaponFire");
  const fired = await h.step(1);
  await captureStill(h, "row");

  const slashes = newZones(accepted, fired);
  assertGreaterThan(
    slashes.length,
    0,
    "the slashes the first tick after the level made",
  );
  for (const slash of slashes) {
    assertEqual(slash.weapon, "taper", "the weapon the new slash belongs to");
    assertNear(
      slash.damage,
      RAISED_DAMAGE,
      FLOAT_TOL,
      "the damage the slash after the level carries",
    );
  }
});
