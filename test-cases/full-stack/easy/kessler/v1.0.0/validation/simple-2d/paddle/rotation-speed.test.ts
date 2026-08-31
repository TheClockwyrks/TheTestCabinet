// paddle/rotation-speed — one second of game time under a held rotation key
// moves the deflector's center angle by exactly 270 degrees.
//
// specs/deflector-and-ball.md: "While `ArrowLeft` or `KeyA` is held, the
// center angle falls at `270` degrees per second; while `ArrowRight` or
// `KeyD` is held, it rises at `270` degrees per second." One second is 60
// ticks (specs/instrumentation.md fixes `TICK_HZ` at 60), so the hold is
// driven for exactly 60 ticks and the landing is read at the half-second mark
// too, which a rate that is only right modulo 360 cannot fake. "Exactly 270"
// justifies only float slack: half a thousandth of a degree over a second of
// accumulation.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod. The pose stands at 45 so neither mark wraps, keeping
// the wrap's own point (`paddle/angle-wraps`) out of this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { DEFLECTOR_TURN_DEG_PER_SEC, TICK_HZ } from "../constants";
import {
  captureReplay,
  hold,
  isolate,
  openHarness,
  type Harness,
} from "../harness";

/** Posed start angle: 45 + 270 = 315 keeps the whole second inside [0, 360). */
const START_DEG = 45;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns 270 degrees over one held second", async () => {
  isolate(h);
  h.debug.setPaddleAngle(START_DEG);

  const marks = await captureReplay(h, "one-second-turn", async () => {
    await hold(h, "ArrowRight", TICK_HZ / 2);
    const half = h.snapshot().paddle.angleDeg;
    await hold(h, "ArrowRight", TICK_HZ / 2);
    const full = h.snapshot().paddle.angleDeg;
    return { half, full };
  });

  assertCloseTo(
    marks.half,
    START_DEG + DEFLECTOR_TURN_DEG_PER_SEC / 2,
    3,
    "the center angle at the half-second mark",
  );
  assertCloseTo(
    marks.full,
    START_DEG + DEFLECTOR_TURN_DEG_PER_SEC,
    3,
    "the center angle after one held second",
  );
});
