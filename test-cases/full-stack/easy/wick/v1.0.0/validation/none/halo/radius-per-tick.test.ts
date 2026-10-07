// Wick — halo/radius-per-tick: the aura's radius follows the level on every
// tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): the aura is "a
// circle of `radius`" whose "`radius` and `damage` are recomputed on every
// tick from the level, `areaMul`, and `damageMul` in force on that tick"; rows
// 1 and 2 of `HALO_LEVELS` carry radius `80` and `90`, and `areaMul` is `1`
// with no Glass held (`specs/passives.md`). `specs/world.md` (phase 5, "The
// placement, on every `playing` tick") recomputes "the aura's radius and
// damage ... from the level ... in force", and `specs/instrumentation.md`
// (`setWeapon`) leaves the same aura in place when "only the level changes".
// So the aura reads `80` at level 1 and, on the tick after Halo rises to
// level 2, the same aura reads `90`.
//
// THE POSE. Halo held at level 1 on an isolated night and one tick stepped, so
// the placement creates the aura; its radius is read. Then the same slot set to
// level 2 through `setWeapon` and one more tick, so the placement recomputes;
// its radius is read again. Every faculty is held, `weaponFire` included,
// because the requirement is the figure the zone carries rather than a pulse,
// and there is nothing to pulse on.
//
// TOLERANCE. `FLOAT_TOL`: each is a table figure times `1`; the alternative a
// fixed-at-creation build reads is `10` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  mustZone,
  type Harness,
} from "../harness";
import { HALO, auraOf } from "./stage";

/** The level Halo is held at first: radius `80`. */
const FIRST_LEVEL = 1;

/** The level it rises to: radius `90`. */
const SECOND_LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the aura's radius at 80 and then at 90 on the tick after Halo rises to level 2", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, HALO, FIRST_LEVEL);

  const placed = await h.step(1);
  const aura = auraOf(placed, "after the first tick Halo is held");
  assertNear(
    aura.radius,
    weaponRow(HALO, FIRST_LEVEL).radius!,
    FLOAT_TOL,
    `the aura's radius at level ${FIRST_LEVEL}`,
  );

  await h.debug.setWeapon(slot, HALO, SECOND_LEVEL);
  const resized = await h.step(1);
  await captureStill(h, "resized");
  assertNear(
    mustZone(resized, aura.id).radius,
    weaponRow(HALO, SECOND_LEVEL).radius!,
    FLOAT_TOL,
    `the aura's radius on the tick after Halo rises to level ${SECOND_LEVEL}`,
  );
});
