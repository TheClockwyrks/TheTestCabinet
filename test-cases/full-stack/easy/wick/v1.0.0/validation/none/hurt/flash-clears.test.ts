// hurt/flash-clears — the hurt flash reaches 0 HURT_FLASH after the hit.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "a timer set to
// `s` seconds is due `round(s x TICK_HZ)` ticks after the tick it was set on",
// and "a count-down that would leave it below `TICK_DT / 2` leaves it at exactly
// `0`". `HURT_FLASH` is `0.3` and `TICK_HZ` is `60`, so `round(0.3 x 60)` is 18:
// the eighteenth tick after the one the hit armed it on is the tick it reads 0
// on. specs/world.md ("Contact damage") is what set it: "a timer that counts
// down with the contact cooldowns in phase 7 and is set to `HURT_FLASH` on every
// tick on which a contact hit lands".
//
// THE DRIVE. The category's isolated night with `enemyContact` on, a rat posed
// overlapping the lamplighter, and the one tick that arms the flash. The rat is
// then removed and the health it took restored, so no further hit lands over the
// eighteen ticks that follow and the timer runs down undisturbed. The ticks are
// run one at a time so the tick the timer reached 0 on is the tick that is read.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`): the specification holds a timer at
// exactly 0 once the count-down would take it below `TICK_DT / 2`, so a
// conformant build reads 0 outright and the allowance covers only a build that
// arrives there by arithmetic of its own. A build one tick short reads `0.0167`
// and one that never counts reads `0.3`, both far outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HURT_FLASH_TICKS, TIMER_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armAlone, flashOf, poseNight } from "./flash";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hurtFlash 0 eighteen ticks after the hit that armed it", async () => {
  await poseNight(h);
  await armAlone(h);

  const after = await h.step(HURT_FLASH_TICKS);

  // The view with the flash run out. Captured before the assertion, so a failing
  // build leaves the picture that shows why.
  await captureStill(h, "cleared");

  assertNear(
    flashOf(after),
    0,
    TIMER_TOL,
    `run.hurtFlash ${HURT_FLASH_TICKS} ticks after the hit that armed it`,
  );
});
