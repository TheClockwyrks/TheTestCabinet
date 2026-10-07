// Wick — halo/pulses-first-tick: Halo pulses on the first `playing` tick it is
// held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "Halo pulses on the first `playing` tick it
//     is held", and "on each tick the cooldown timer is due it pulses, every
//     enemy whose circle overlaps the aura takes `damage`".
//   - `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer is `0`,
//     so a weapon fires on the first `playing` tick it is held; Taper, Lantern,
//     Halo ... need no target and fire the same way, Halo by pulsing".
//   - `specs/world.md` ("One tick"): phase 5 creates the aura and pulses it,
//     and phase 6 has "every projectile and zone hit, this tick's new ones
//     included", so the pulse of the tick that created the aura lands on that
//     tick.
//   - `specs/weapons.md` ("Halo"): level 1 has damage `3`; `specs/enemies.md`:
//     a moth has HP `5`, radius `10`; ("Hits and death") "A hit removes the
//     shape's damage per hit from the enemy's `hp`", with `damageMul` `1` when
//     no Wick is held (`specs/passives.md`).
//
// WHAT IS READ. The moth's `hp` after the one tick: 5 less 3, which is 2. The
// timer is left exactly as acquisition set it, `0`, and only `weaponFire` is
// turned on, so a build whose acquisition timer starts at the cooldown rather
// than `0` leaves the moth at 5.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1 and one moth 40 units
// along +x, inside the level-1 radius of 80; every switch off but
// `weaponFire`, so nothing moves the moth, nothing touches it, and the pulse is
// the only thing that can lower its hp.
//
// TOLERANCE. `FIGURE_TOLERANCE`: 5 − 3 is exact arithmetic on two stated
// figures, so 1e-9 is headroom for a build holding hp as a real number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  present,
  type Harness,
} from "../harness";
import { assertProbeTook, haloRow, poseHalo } from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** Row 1's damage, the whole of what one pulse removes with no Wick held. */
const DAMAGE = haloRow(LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes 3 from an overlapping moth on the first playing tick Halo is held", async () => {
  const { slot, probe, posed } = poseHalo(h, LEVEL);
  const moth = present(probe, "the posed moth's id");
  assertEqual(
    posed.run.weapons[slot]?.cooldown,
    0,
    "Halo's timer on acquisition",
  );
  enable(h, "weaponFire");

  const after = await h.tick(1);
  captureStill(h, "first");

  assertProbeTook(posed, after, moth, DAMAGE, "the moth after the first tick");
});
