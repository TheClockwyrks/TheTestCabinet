// hurt/flash-rearms — a second hit while the flash runs sets it back to
// HURT_FLASH.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): the
// lamplighter's `hurtFlash` "is set to `HURT_FLASH` on every tick on which a
// contact hit lands, whatever the number of hits that tick", with "Seconds the
// hurt flash runs | `HURT_FLASH` | `0.3`". EVERY such tick, so a tick that hits
// while the timer is still running sets it to the full 0.3 rather than adding to
// it or leaving it alone.
//
// WHERE THE SECOND HIT IS PUT. specs/world.md ("Timers") counts the timer down
// by `TICK_DT` a tick, so twelve ticks after the arming tick it reads
// `0.3 - 12/60`, which is `0.1`: the figure this point poses the second hit
// against. The rat that landed the first hit had its `contactCooldown` "set to
// `CONTACT_COOLDOWN`" by it, so it is made due again through
// `setEnemyContactCooldown`, which "Sets enemy `id`'s `contactCooldown` to
// `seconds`" (specs/instrumentation.md); a timer at `0` "stays due on every tick
// until it is set again", so the next tick lands the second hit. The rat never
// moved, `enemyMotion` being held, so it is still overlapping.
//
// THE DRIVE. The category's isolated night with `enemyContact` on, the arming
// tick, twelve ticks of count-down, the rat's cooldown posed due, and one more
// tick. `run.hurtFlash` is read off that tick's snapshot. The reading taken
// before it is the scenario's own guard: it says the second hit landed on a
// timer that was running rather than on one that had already gone out.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`), as for every timer this suite reads: a
// figure a build may reach through twelve subtractions of `1/60` or through a
// tick count of its own. A build that left the running timer alone reads
// `0.0833` and one that added to it reads `0.3833`, both four orders outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HURT_FLASH, TICK_HZ, TIMER_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armFlash, flashOf, poseNight } from "./flash";

/** The seconds left of the flash the second hit is landed on. */
const REARM_AT = 0.1;

/** Ticks of count-down that leave the timer there: `round((0.3 - 0.1) x 60)`. */
const REARM_TICKS = Math.round((HURT_FLASH - REARM_AT) * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets hurtFlash back to 0.3 on a second hit landed while it read 0.1", async () => {
  await poseNight(h);
  const { rat } = await armFlash(h);

  const running = await h.step(REARM_TICKS);
  assertNear(
    flashOf(running),
    REARM_AT,
    TIMER_TOL,
    "run.hurtFlash the second hit is landed on",
  );

  await h.debug.setEnemyContactCooldown(rat.id, 0);
  const rearmed = await h.step(1);

  // The view with the flash back at full. Captured before the assertion, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "rearmed");

  assertNear(
    flashOf(rearmed),
    HURT_FLASH,
    TIMER_TOL,
    "run.hurtFlash on the tick a second contact hit landed",
  );
});
