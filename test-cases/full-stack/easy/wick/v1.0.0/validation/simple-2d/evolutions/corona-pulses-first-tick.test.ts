// Wick — evolutions/corona-pulses-first-tick: Corona pulses on the first
// `playing` tick it is held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "Corona pulses on its first tick and on
//     every tick its cooldown timer is due; each pulse deals `damage` to every
//     enemy whose circle overlaps the aura". The fixed row has damage `12` and
//     radius `150`.
//   - `specs/evolutions.md` ("Corona"): the aura is created "On the first
//     `playing` tick Corona is held", and `specs/world.md` ("One tick"), phase
//     5 creates it while phase 6 has "every projectile and zone hit, this
//     tick's new ones included", so the pulse of the creating tick lands on
//     that tick.
//   - `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer is `0`,
//     so a weapon fires on the first `playing` tick it is held".
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii", so a
//     moth of radius `10` standing 40 units out is inside an aura of 150;
//     ("Hits and death"): a hit removes damage from `hp`, and an enemy whose
//     `hp` is at or below `0` after the hits "dies on that tick".
//
// WHAT IS READ. The moth after the one tick: it took a hit, either gone or with
// its `hp` below the `5` it was posed with. The timer is left exactly as
// acquisition set it, `0`, and only `weaponFire` is turned on, so a build whose
// aura waits for a full cooldown before its first pulse leaves the moth
// untouched. The reading is that a pulse landed rather than the figure it
// carried, which the row point decides.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone and one moth 40 units along
// `+x`, inside the fixed radius of 150; every driver switch off but
// `weaponFire`, so nothing moves the moth, nothing touches it, no director
// removes it, and the pulse is the only thing that can lower its hp.
//
// TOLERANCE. None: the probe is read as hit or not hit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved, assertHit } from "./evolved";
import { PROBE_DX } from "./corona";

/** The probe: a moth, HP 5 and radius 10. */
const PROBE = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits an overlapping moth on the first playing tick Corona is held", async () => {
  const { slot } = armEvolved(h, "corona");
  const moth = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  enable(h, "weaponFire");
  const posed = h.snapshot();
  assertEqual(
    posed.run.weapons[slot]?.cooldown,
    0,
    "Corona's timer on acquisition",
  );

  const after = await h.tick(1);
  captureStill(h, "first");

  assertHit(posed, after, moth, "the moth after the first playing tick");
});
