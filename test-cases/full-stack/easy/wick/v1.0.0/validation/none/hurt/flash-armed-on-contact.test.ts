// hurt/flash-armed-on-contact — the tick a contact hit lands arms the flash.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "The
// lamplighter carries `hurtFlash`, a timer that counts down with the contact
// cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on which a
// contact hit lands", with "Seconds the hurt flash runs | `HURT_FLASH` | `0.3`".
// The snapshot reports it as "Seconds left of the lamplighter's hurt flash"
// (specs/instrumentation.md), so the hit's own tick reads 0.3.
//
// WHY 0.3 AND NOT LESS. Phase 7 of specs/world.md ("One tick") counts the timers
// down BEFORE the hit is decided: "Every live enemy's `contactCooldown` and the
// lamplighter's `hurtFlash` count down, and, while `enemyContact` is on, an
// overlapping enemy whose cooldown is due hits". The set to `HURT_FLASH` is the
// last thing the phase does, so the reading on the hit's tick is the full 0.3
// and the first count-down against it lands on the next tick.
//
// THE DRIVE. The category's isolated night with `enemyContact` on, a rat 20
// units from the lamplighter's center — inside its radius 12 plus
// `PLAYER_RADIUS` 12 — and one tick. `run.hurtFlash` is read off that tick's
// snapshot, and the hit itself is read off the health the rat took, which is
// what says the tick landed one at all.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`): a timer set to a stated figure reads that
// figure exactly, and the allowance is for a build that stores it in ticks and
// converts back. A build that never arms it reads 0, and one that counts it down
// on the same tick reads 0.2833, both four orders outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HURT_FLASH, TIMER_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armFlash, flashOf, poseNight } from "./flash";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hurtFlash 0.3 on the tick a rat's contact hit lands", async () => {
  await poseNight(h);

  const { armed } = await armFlash(h);

  // The view with the hit landed and the cast over it. Captured before the
  // assertion, so a failing build leaves the picture that shows why.
  await captureStill(h, "armed");

  assertNear(
    flashOf(armed),
    HURT_FLASH,
    TIMER_TOL,
    "run.hurtFlash on the tick a contact hit landed",
  );
});
