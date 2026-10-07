// hurt/flash-counts-down — the hurt flash falls by TICK_DT a tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "On every tick a
// timer counts down by `TICK_DT` and is held at `0`", and ("Contact damage")
// the lamplighter's `hurtFlash` is "a timer that counts down with the contact
// cooldowns in phase 7". `HURT_FLASH` is `0.3` and `TICK_DT` is `1/60`, so ten
// ticks after the tick that armed it the timer reads `0.3 - 10/60`, which is
// `0.1333...` — well above the `TICK_DT / 2` the hold at `0` turns on, so the
// tenth tick is an ordinary count-down and nothing else.
//
// THE DRIVE. The category's isolated night with `enemyContact` on, a rat posed
// overlapping the lamplighter, and the one tick that arms the flash. The rat is
// then removed and the health it took restored, so the ten ticks that follow
// land no further hit and nothing but the count-down moves the timer. Removing
// the rat rather than waiting out `CONTACT_COOLDOWN` is also what makes the
// reading a reading of phase 7's count-down alone: specs/world.md counts the
// timer down on every tick, "while `enemyContact` is on" governing only the hit
// beside it, so the switch stays on with nothing left to hit.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`): ten subtractions of `1/60`, which is
// inexact in binary, drift by a few `1e-17`, and a build is free to count in
// ticks and convert back. The nearest wrong answer, a timer that ran nine ticks
// or eleven, is `0.0167` away, four orders outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HURT_FLASH, TICK_DT, TIMER_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armAlone, flashOf, poseNight } from "./flash";

/** Ticks run after the tick that armed the flash. */
const TICKS = 10;

/** What the timer reads then: `0.3 - 10 x (1/60)`. */
const EXPECTED = HURT_FLASH - TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hurtFlash 0.3 less ten ticks of TICK_DT, ten ticks after the hit", async () => {
  await poseNight(h);
  await armAlone(h);

  const after = await h.step(TICKS);

  // The view with the flash part way through. Captured before the assertion, so
  // a failing build leaves the picture that shows why.
  await captureStill(h, "counting");

  assertNear(
    flashOf(after),
    EXPECTED,
    TIMER_TOL,
    `run.hurtFlash ${TICKS} ticks after the hit that armed it`,
  );
});
