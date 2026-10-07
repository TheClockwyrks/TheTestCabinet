// Wick — flare/no-lingering-damage: the burst damages nothing after the tick
// it fired on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius` of
//     the player's center takes `damage` on that tick ... The burst is drawn
//     for `FLARE_FLASH` (`0.4`) seconds and has no hitbox after the tick it
//     fires."
//   - `specs/weapons.md` ("Flare"): "Flare fires whether or not any enemy
//     exists", which is what lets the burst be raised on an empty field, so
//     the moth posed afterwards is the only enemy the burst ever saw.
//   - `specs/state.md` (`ZoneState`, `ttl`): "a burst `FLARE_FLASH` (`0.4`),
//     each drawn for that long and dealing its damage on the tick it appears
//     alone", so the zone stands for the whole flash and hits on none of the
//     ticks after the first.
//   - `specs/instrumentation.md` (`spawnEnemy`): a posed enemy "first moves,
//     first hits, and first pulses on the next tick, exactly as one a tick
//     created", so a moth posed after the firing tick is a live enemy for the
//     tick that follows.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a moth has HP `5` (`specs/enemies.md`)
//     against the row's damage of `100`, so a hit that landed would kill it.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. The moth posed 100 units along +x after the firing tick, well
// inside the burst's radius of 640, stands after the next tick with its HP of
// 5 untouched, while the burst is still in `zones`.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 1 fires on an empty
// field, so the burst is the only shape in the world; `weaponFire` is then
// turned off, so no second firing can reach the moth and only the standing
// burst can, which is exactly the requirement. Every other switch was off
// throughout: nothing spawns, nothing moves, nothing else hits. The burst's
// own `ttl` counts down whatever `weaponFire` holds (`specs/world.md`, phase
// 6), so the zone is read beside the moth to show the requirement was not
// answered by a burst that had already expired.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the moth's hp, a stated figure read
// back; none on presence, which the specification decides exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  disable,
  enemyById,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { flareBursts, poseFlare, PROBE_DX } from "./burst";

/** The level this point holds Flare at: radius 640, damage 100. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth posed inside the standing burst untouched on the next tick", async () => {
  const { slot } = poseFlare(h, LEVEL, null);
  armWeapon(h, slot);
  const fired = await h.tick(1);
  assertEqual(
    flareBursts(fired).length,
    1,
    "burst zones with weapon flare after the firing tick",
  );

  disable(h, "weaponFire");
  const moth = spawnEnemyNear(h, "moth", PROBE_DX, 0);

  const after = await h.tick(1);
  captureStill(h, "once");

  assertEqual(
    flareBursts(after).length,
    1,
    "burst zones with weapon flare on the tick after the firing",
  );
  const standing = present(
    enemyById(after, moth),
    "the moth posed inside the standing burst",
  );
  assertWithin(
    standing.hp,
    ENEMIES.moth.hp,
    FIGURE_TOLERANCE,
    "the moth's hp on the tick after the firing",
  );
});
