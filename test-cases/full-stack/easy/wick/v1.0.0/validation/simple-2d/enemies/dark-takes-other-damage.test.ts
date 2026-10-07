// Wick — enemies/dark-takes-other-damage: every weapon but Flare damages the
// Dark exactly as it damages any enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Elites and the Dark"): "`FLARE_IMMUNE` ... holds
//     `dark` alone ... Every other weapon damages the Dark exactly as it
//     damages any enemy"; the Dark's row gives HP `10000`.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`".
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed bolt's `damage`
//     is "that row's damage times the `damageMul` in force at the call", read
//     "at level `1`" when the weapon is not held, and it "first ... hits on the
//     next tick"; `specs/weapons.md` ("Ember") row 1 gives damage `10`, and
//     with no passive held `damageMul` is `1` (`specs/passives.md`).
//   - `specs/instrumentation.md` (`setEffectMotion`): with the switch off
//     "`ttl` and every re-hit entry still count, and hits still resolve", so
//     the bolt hits from the center it was posed on.
//
// WHAT IS READ. The Dark's `hp` after the one tick an Ember bolt on its center
// hits it: 10000 − 10. The bolt's own `damage` is read from the snapshot as
// well, so the figure the hit is compared against is the one the build gave the
// bolt rather than one this check assumed. A build that extends the Flare
// immunity to every weapon leaves the Dark at 10000 and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. The Dark 150 units along +x and one bolt on
// its center, every switch off and no weapon held: nothing spawns, the Dark
// cannot move or reach the lamplighter, no other shape exists, and the bolt
// hits once. The Dark's 10000 health is far above the bolt's 10, so it survives
// the hit and its health can be read after it.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the health after the hit, the
// difference of two stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { EMBER_LEVELS, ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the Dark stands, along +x of the lamplighter's center. */
const DARK_DX = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the bolt's damage from the Dark's hp", async () => {
  isolate(h);
  const dark = spawnEnemyNear(h, "dark", DARK_DX, 0);
  const was = present(enemyById(h.snapshot(), dark), "the posed Dark");
  assertWithin(
    was.hp,
    ENEMIES.dark.hp,
    FIGURE_TOLERANCE,
    "the Dark's hp at its spawn",
  );
  const bolt = spawnProjectileAt(h, "ember", was.x, was.y, 0, 0, 0);
  const posed = present(projectileById(h.snapshot(), bolt), "the posed bolt");
  assertWithin(
    posed.damage,
    EMBER_LEVELS[0].damage,
    FIGURE_TOLERANCE,
    "the damage the posed bolt carries",
  );

  const after = await h.tick(1);
  captureStill(h, "hit");

  const now = present(enemyById(after, dark), "the Dark after the hit");
  assertWithin(
    now.hp,
    was.hp - posed.damage,
    FIGURE_TOLERANCE,
    "the Dark's hp after the bolt hit it",
  );
});
