// states/pause-freezes-effect-timers — while paused, a running effect timer
// does not fall.
//
// specs/screens.md: "Pausing freezes the whole simulation: the ring orbits,
// the effect and interstitial timers, the falling pods, the balls in flight,
// and the ball sprite's animation all hold exactly as the pausing tick left
// them." A timer is whole ticks, so a frozen one is exactly equal.
//
// The world holds only the two timers the item is about, posed through the
// surface: widen and pierce can run together (widen and narrow cancel each
// other, so only one of that pair is posed). No pod and no catch is involved —
// setEffectTicks "puts the effect in force exactly as catching its pod would,
// with the timer at exactly ticks" — so a broken catch fails the pods points,
// not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  type Harness,
} from "../harness";
import { HELD_TICKS } from "./still";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a running effect timer while paused", async () => {
  await isolate(h);
  await h.debug.setEffectTicks("widen", 400);
  await h.debug.setEffectTicks("pierce", 240);

  await h.debug.setScreen("paused");
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the timers freeze on");
  assertEqual(
    paused.effects.widenTicks,
    400,
    "the widen timer the pause catches",
  );
  assertEqual(
    paused.effects.pierceTicks,
    240,
    "the pierce timer the pause catches",
  );

  await captureReplay(h, "frozen-timers", () => advanceTicks(h, HELD_TICKS));

  const after = await h.snapshot();
  assertEqual(
    after.effects.widenTicks,
    paused.effects.widenTicks,
    `the widen timer after ${HELD_TICKS} ticks of pause`,
  );
  assertEqual(
    after.effects.pierceTicks,
    paused.effects.pierceTicks,
    `the pierce timer after ${HELD_TICKS} ticks of pause`,
  );
});
