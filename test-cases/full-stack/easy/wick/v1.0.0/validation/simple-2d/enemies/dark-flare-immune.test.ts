// Wick — enemies/dark-flare-immune: a Flare burst leaves the Dark untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Elites and the Dark"): "`FLARE_IMMUNE` lists the
//     types a Flare burst leaves untouched, and it holds `dark` alone: a Flare
//     burst deals the Dark no damage".
//   - `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius` of
//     the player's center takes `damage` on that tick, except the enemies
//     listed in `FLARE_IMMUNE` (`["dark"]`), which a flare leaves untouched.
//     Flare fires whether or not any enemy exists"; row 1 gives damage `100`
//     and radius `640`.
//   - `specs/weapons.md` ("Shapes and overlap"): "An enemy is within `d` of a
//     point when the distance from that point to the enemy's center is at most
//     `d`", so a Dark 100 units out stands well inside the burst.
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(
//     slot, 0)` makes that the next tick" the weapon fires on.
//
// WHAT IS READ. The firing tick, twice over. The burst is there: exactly one
// zone of kind `burst` from `flare`, carrying a damage above zero and a radius
// that reaches past where the Dark stands, so the reading is of a burst that
// went off over the Dark and not of a weapon that never fired. And the Dark's
// `hp` after that tick is the `hp` it held before it. A build that treats the
// Dark as any other enemy takes 100 off its 10000 and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. The Dark 100 units along +x, Flare at level 1
// in the only weapon slot, and `weaponFire` the only switch on: no other weapon
// fires, no enemy moves, no contact lands, and nothing else on the field can
// change the Dark's health. The Dark is the only enemy, so the burst has nothing
// else to spend itself on.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the health held across the tick, a
// stated figure read back twice; none on the burst's presence.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  distance,
  enemyById,
  holdWeapon,
  isolate,
  present,
  spawnEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";

/** Where the Dark stands: well inside every row's radius of 640. */
const DARK_DX = 100;

/** The level Flare is held at: row 1, damage 100, radius 640. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the Dark's hp exactly as it was across the burst's firing tick", async () => {
  isolate(h);
  const dark = spawnEnemyNear(h, "dark", DARK_DX, 0);
  const slot = holdWeapon(h, "flare", LEVEL);
  const posed = h.snapshot();
  const was = present(enemyById(posed, dark), "the posed Dark");
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "immune");

  const bursts = zonesOfKind(after, "burst").filter(
    (zone) => zone.weapon === "flare",
  );
  assertEqual(bursts.length, 1, "the Flare bursts on the firing tick");
  assertGreaterThan(bursts[0].damage, 0, "the damage the burst carries");
  assertGreaterThanOrEqual(
    bursts[0].radius,
    distance(posed.run.player, { x: was.x, y: was.y }),
    "the burst's radius against the distance to the Dark's center",
  );
  const now = present(enemyById(after, dark), "the Dark after the burst");
  assertWithin(
    now.hp,
    was.hp,
    FIGURE_TOLERANCE,
    "the Dark's hp across the burst's firing tick",
  );
});
