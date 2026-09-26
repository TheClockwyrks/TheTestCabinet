// Wick — flare/burst-flash: a burst zone holds `FLARE_FLASH` as its ttl and is
// removed on the tick that ttl is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Flare"): "The burst is drawn for `FLARE_FLASH`
//     (`0.4`) seconds"; row 1 of the table has radius `640`; "Flare fires
//     whether or not any enemy exists", which is what lets the burst be read
//     on a field holding nothing else.
//   - `specs/state.md` (`ZoneState`, `ttl`): "the seconds the zone has left, a
//     timer as `specs/world.md` defines one ... A zone is removed on the tick
//     `ttl` is due ... and a burst `FLARE_FLASH` (`0.4`)"; ("radius") "a
//     burst's is its Flare `radius`".
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a ttl of
//     0.4 is due 24 ticks after the firing tick.
//   - `specs/world.md` ("One tick", phase 6): "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it is
//     due", so the burst stands through the 23rd tick after its firing and is
//     gone on the 24th.
//   - `specs/weapons.md` ("Derived stats"): radius is the "table value ×
//     `areaMul`"; with no passive held every multiplier is `1`
//     (`specs/passives.md`).
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. The burst's `radius` and `ttl` on its firing tick, 640 and
// 0.4; then the zone is followed by id across the twenty-four ticks after:
// present after each of the first twenty-three, absent after the
// twenty-fourth.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 1 on an empty field,
// every switch but `weaponFire` off, so the burst is the only zone in the
// world and nothing else is created or removed while it stands. Flare's timer
// reads 60 after the firing, so no second burst arrives inside the
// twenty-four ticks.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the ttl and the radius, stated
// figures read back; none on the tick count, which the specification states
// exactly through `round`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertUndefined, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, FLARE_FLASH, ticksFor } from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  zoneById,
  type Harness,
} from "../harness";
import { flareRow, poseFlare, theBurst } from "./burst";

/** The level this point holds Flare at: radius 640, cooldown 60. */
const LEVEL = 1;

/** Row 1's radius. */
const RADIUS = flareRow(LEVEL).radius;

/** Ticks from the firing to the removal: round(0.4 × 60) = 24. */
const FLASH_TICKS = ticksFor(FLARE_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 640 and ttl 0.4 on the firing tick and is gone on the 24th tick after", async () => {
  const { slot } = poseFlare(h, LEVEL, null);
  armWeapon(h, slot);

  const outcome = await captureReplay(h, "flash", async () => {
    const fired = await h.tick(1);
    const burst = theBurst(fired, "after the firing tick");
    const following = await h.trace(FLASH_TICKS);
    return { burst, following };
  });

  assertWithin(
    outcome.burst.radius,
    RADIUS,
    FIGURE_TOLERANCE,
    "the burst's radius on its firing tick",
  );
  assertWithin(
    outcome.burst.ttl ?? Number.NaN,
    FLARE_FLASH,
    FIGURE_TOLERANCE,
    "the burst's ttl on its firing tick",
  );
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertDefined(
      zoneById(outcome.following[tick - 1], outcome.burst.id),
      `the burst on the tick ${tick} after its firing`,
    );
  }
  assertUndefined(
    zoneById(outcome.following[FLASH_TICKS - 1], outcome.burst.id),
    `the burst on the tick ${FLASH_TICKS} after its firing`,
  );
});
