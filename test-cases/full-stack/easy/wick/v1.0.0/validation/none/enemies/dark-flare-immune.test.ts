// Wick — enemies/dark-flare-immune: a Flare burst leaves the Dark untouched.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Elites and the Dark"):
// "`FLARE_IMMUNE` lists the types a Flare burst leaves untouched, and it holds
// `dark` alone: a Flare burst deals the Dark no damage." `specs/weapons.md`
// ("Flare") says the same from the weapon's side: "On firing, every enemy
// within `radius` of the player's center takes `damage` on that tick, except
// the enemies listed in `FLARE_IMMUNE` (`["dark"]`), which a flare leaves
// untouched. Flare fires whether or not any enemy exists". Row 1 of
// `FLARE_LEVELS` gives radius `640` and damage `100`, and the Dark's row gives
// it `10000` health, so the reading is exact either way: untouched it stands at
// `10000`, and reached it stands at `9900`.
//
// THE POSE. An isolated night holding nothing but the lamplighter at the origin
// and one Dark 100 units along `+x`, well inside the `640` — ("Shapes and
// overlap") "An enemy is within `d` of a point when the distance from that
// point to the enemy's center is at most `d`", and 100 is one coordinate on an
// axis, exact in floating point whichever way a build compares it. Flare is
// then held at level 1 and fired through the shared `fireWeapon`: "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held" (`specs/weapons.md`), so one tick is the firing.
//
// The check also reads the burst the tick created — `specs/state.md` lists
// `burst` among a zone's kinds — so a build that fired nothing at all fails
// here rather than passing for the wrong reason. `enemyMotion` and
// `enemyContact` are held, so the Dark stands where it was posed and takes
// nothing from the lamplighter.
//
// TOLERANCE. `FLOAT_TOL` on the Dark's hp, which is exactly the table `10000`.
// The wrong answer, `9900`, is a hundred units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

/** The Flare level fired: row 1, radius `640` and damage `100`. */
const LEVEL = 1;

/** How far along `+x` the Dark stands: well inside the `640` radius. */
const TARGET_OFFSET = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the Dark at its full 10000 through a Flare burst it stands inside", async () => {
  await isolate(h);
  const dark = await placeEnemy(h, "dark", TARGET_OFFSET, 0);

  const firing = await fireWeapon(h, "flare", LEVEL);
  await captureStill(h, "immune");

  assertEqual(
    firing.zones.filter(
      (zone) => zone.kind === "burst" && zone.weapon === "flare",
    ).length,
    1,
    "the Flare bursts the firing tick created",
  );
  assertNear(
    mustEnemy(firing.after, dark.id).hp,
    ENEMIES.dark.hp,
    FLOAT_TOL,
    "the Dark's hp after the burst it stood inside",
  );
});
