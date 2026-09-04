// evolutions/beacon-no-target-restarts — Beacon restarts its cooldown with no
// enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "Beacon
// needs at least one enemy to fire." `specs/weapons.md` ("Cooldown timers"): "A
// weapon that needs a target and finds no eligible target does not fire on
// that tick, and its timer is set to its current cooldown as though it had."
// `BEACON_STATS` gives cooldown 0.25, and with no Oil held `cooldownMul` is 1
// (`specs/passives.md`), so on the due tick with `enemies` empty no projectile
// is created and the slot's timer reads 0.25.
//
// WHY BOTH HALVES ARE READ. A build that fired at nothing fails on the
// projectile count; a build that declined to fire but left its timer at `0`
// would be due again on the very next tick, and fails on the timer. Together
// they are the one behavior the review item names.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run — `clearEnemies` among the
// clears, read back as an empty `enemies` before the firing, so the field is
// provably empty rather than assumed so — with Beacon armed, `weaponFire` the
// one switch on and `spawning` and `events` off, so no director spawn can put
// an enemy in the world between the read and the due tick.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a row figure set outright; the
// projectile count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BEACON_STATS, REAL_EPS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { fireFromPosed } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no bolt on Beacon's due tick with no enemy alive and sets the timer to 0.25", async () => {
  isolate(h);

  const firing = await fireFromPosed(h, "beacon");
  captureStill(h, "restart");

  assertEqual(
    firing.before.run.enemies.length,
    0,
    "enemies alive when Beacon's timer came due (specs/instrumentation.md, clearEnemies)",
  );
  assertEqual(
    firing.after.run.projectiles.length,
    0,
    "the projectiles standing after Beacon's due tick with no enemy alive (specs/evolutions.md, Beacon)",
  );
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? Number.NaN,
    BEACON_STATS.cooldown,
    REAL_EPS,
    "Beacon's timer after the due tick it found no target on (specs/weapons.md, Cooldown timers)",
  );
});
