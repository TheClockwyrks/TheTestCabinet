// effects/catch-restarts-timer — catching a kind already in force restarts
// that kind's timer at its full duration rather than stacking or ignoring
// the catch.
//
// specs/pods.md: "Catching a kind already in force restarts its timer at the
// full duration." The in-force precondition is posed with setEffectTicks,
// which specs/instrumentation.md fixes as putting the effect in force
// "exactly as catching its pod would" with "the timer at exactly `ticks`".
// The restarted reading is held to a one-tick tolerance around the full
// duration (the catch tick's own count is the only latitude the timer words
// leave) — which separates a restart (≈600) from both a kept timer (120)
// and a stacked one (≈720).
//
// THE WORLD IS ONE RUNNING EFFECT AND ONE POD. The field is emptied and the
// switches are off, so the catch is the only event of the tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  open,
  PIERCE_DURATION,
  record,
  setEffect,
  snap,
  SPAN_WIDEN,
  WIDEN_DURATION,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("a widen catch during widen restarts the timer at its full 600", async () => {
  await world(h);
  await setEffect(h, "widen", 120);
  const posed = await snap(h);
  assertEqual(posed.effects.widenTicks, 120, "the posed running timer");
  assertEqual(posed.paddle.spanDeg, SPAN_WIDEN, "widen already in force");

  const after = await record(h, "timer-restart", () => dropPod(h, "widen"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.widenTicks,
    WIDEN_DURATION - 1,
    WIDEN_DURATION,
    "the timer restarts at the full duration — neither kept at 120 nor stacked to 720",
  );
  assertEqual(after.paddle.spanDeg, SPAN_WIDEN, "the span stays widened");
});

it("a pierce catch during pierce restarts the timer at its full 360", async () => {
  await world(h);
  await setEffect(h, "pierce", 50);
  assertEqual(
    (await snap(h)).effects.pierceTicks,
    50,
    "the posed running timer",
  );

  const after = await dropPod(h, "pierce");

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.pierceTicks,
    PIERCE_DURATION - 1,
    PIERCE_DURATION,
    "the timer restarts at the full duration — neither kept at 50 nor stacked to 410",
  );
});
