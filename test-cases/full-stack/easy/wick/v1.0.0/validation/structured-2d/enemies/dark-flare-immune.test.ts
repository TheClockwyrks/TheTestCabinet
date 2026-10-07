// enemies/dark-flare-immune — a Flare burst leaves the Dark's health where it
// found it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Elites and the Dark"):
// "`FLARE_IMMUNE` lists the types a Flare burst leaves untouched, and it holds
// `dark` alone: a Flare burst deals the Dark no damage."
// `specs/weapons.md` ("Flare") states the exception where the burst is
// applied: "On firing, every enemy within `radius` of the player's center
// takes `damage` on that tick, except the enemies listed in `FLARE_IMMUNE`
// (`["dark"]`), which a flare leaves untouched." So the threshold is no
// threshold at all: the removal is exactly `0`, and the Dark's `hp` after the
// firing tick is the `hp` it carried before it.
//
// WHY THE BURST IS READ BEFORE THE HEALTH. A build whose Flare never fires
// would leave the Dark untouched for a reason that has nothing to do with
// immunity, and would pass a check that only compared two healths. So the
// firing tick is required to have produced its burst, and the Dark is required
// to stand inside the `radius` that burst carries: `specs/state.md` makes a
// zone's `kind` `burst` for a Flare burst, and "every enemy within `radius` of
// the player's center" is the reach the same tick's damage had. Only with the
// burst raised over the Dark is the unchanged health the immunity.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the Dark alone and
// Flare at level 1 in the one weapon slot, its timer posed to `0` so it fires
// on the next tick ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), with `weaponFire` the one switch on. The Dark
// stands `INSIDE` (100) units from the lamplighter, well within every row's
// radius of `640` and well outside the `52` its own circle would need to touch
// the lamplighter, so nothing but the burst can reach it: `enemyMotion` and
// `enemyContact` are off, no other weapon is held, and no other enemy exists.
// Level 1 is the row read because a build that damaged the Dark at all is
// wrong at every row; which row a burst carries is `flare/row-1`'s point.
//
// THE TOLERANCE. `REAL_EPS`, and the comparison is against the health read
// from the same run a tick earlier: the level-1 burst's damage is `100`, so a
// build that hit the Dark misses by fourteen orders of magnitude more.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNear, fail } from "../assert";
import { FLARE_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  distance,
  holdWeapon,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { requireEnemy } from "./roster";

/** How far from the lamplighter the Dark stands: inside every Flare radius. */
const INSIDE = 100;

/** The level Flare is held at. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the Dark's hp exactly where it was after a Flare burst it stood inside", async () => {
  isolate(h);
  const dark = placeEnemyNear(h, "dark", INSIDE, 0);
  armWeapon(h, holdWeapon(h, "flare", LEVEL));
  const before = requireEnemy(h.snapshot(), dark);

  const fired = await advanceTicks(h, 1);
  captureStill(h, "immune");

  const bursts = fired.run.zones.filter(
    (zone) => zone.kind === "burst" && zone.weapon === "flare",
  );
  if (bursts.length !== 1) {
    fail(
      "exactly one zone of kind burst with weapon flare on the firing tick (specs/weapons.md, Flare)",
      bursts.length,
    );
  }
  assertLessThanOrEqual(
    distance(before, bursts[0]),
    bursts[0].radius,
    `how far the Dark stood from the burst's center, against the ${FLARE_LEVELS[LEVEL - 1].radius} its row reaches (specs/weapons.md, Flare)`,
  );

  assertNear(
    requireEnemy(fired, dark).hp,
    before.hp,
    REAL_EPS,
    "the Dark's hp after a firing tick whose burst covered it (specs/enemies.md, Elites and the Dark)",
  );
});
