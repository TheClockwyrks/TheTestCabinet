// halo/radius-per-tick — the aura's radius follows the level every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): the aura's
// "`radius` and `damage` are recomputed on every tick from the level,
// `areaMul`, and `damageMul` in force on that tick". ("Derived stats"): the
// aura's radius is the one exception to lengths being "fixed when it is
// created". Row 1 of `HALO_LEVELS` gives radius 80 and row 2 gives 90, and
// with no Glass held `areaMul` is 1 (`specs/passives.md`), so the aura reads
// 80 at level 1 and 90 on the tick after Halo rises to level 2.
// `specs/instrumentation.md` (`setWeapon`): "when only the level changes the
// timer keeps counting", so raising the level is a pose on the held slot
// and the aura is resized by the placement of the next tick, which runs "on
// every `playing` tick, whatever the two hold" (The driver switches).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with Halo held at level 1
// and every driver switch off: placement is gated by no switch, so one tick
// creates the aura at 80, and with `weaponFire` off no pulse is due. Then
// the same slot is posed to level 2 and one more tick runs. No enemy is
// posed; what the resized aura hits is `pulse-hits-overlapping`'s point.
//
// THE TOLERANCE. `REAL_EPS` on each radius, a table value times a multiplier
// of 1; the rows differ by 10.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { theAura } from "./aura";

/** The level the aura is created at, and the level it rises to. */
const FROM = 1;
const TO = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 80 at level 1 and 90 on the tick after Halo rises to level 2", async () => {
  isolate(h);
  const slot = holdWeapon(h, "halo", FROM);

  const placed = await advanceTicks(h, 1);
  assertNear(
    theAura(placed).radius,
    HALO_LEVELS[FROM - 1].radius,
    REAL_EPS,
    `the aura's radius at level ${FROM} (specs/weapons.md, Halo)`,
  );

  h.debug.setWeapon(slot, "halo", TO);
  const risen = await advanceTicks(h, 1);
  captureStill(h, "resized");
  assertNear(
    theAura(risen).radius,
    HALO_LEVELS[TO - 1].radius,
    REAL_EPS,
    `the aura's radius on the tick after Halo rose to level ${TO} (specs/weapons.md, Halo)`,
  );
});
