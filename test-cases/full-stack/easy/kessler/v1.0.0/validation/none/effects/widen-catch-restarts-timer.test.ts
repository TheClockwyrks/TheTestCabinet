// effects/widen-catch-restarts-timer — catching widen while widen runs restarts
// its timer at the full duration.
//
// specs/pods.md: "Catching a kind already in force restarts its timer at the
// full duration." The in-force precondition is posed with `setEffectTicks`,
// which specs/instrumentation.md fixes as putting the effect in force "exactly
// as catching its pod would" with "the timer at exactly `ticks`".
//
// THE READING SEPARATES THREE DESIGNS. A restart reads about 600, a kept timer
// reads the posed 120, and a stacked one reads about 720; the one-tick tolerance
// is the only latitude the timer words leave, because the catch tick's own fall
// at step 3 of specs/field.md's order may or may not have run first.
//
// THE WORLD IS ONE RUNNING EFFECT AND ONE POD, so the catch is the only event of
// the tick. Pierce's restart is its own point, because a build may hold one and
// not the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  open,
  record,
  setEffect,
  snap,
  SPAN_WIDEN,
  WIDEN_DURATION,
  world,
  type Harness,
} from "./pose";

/** A running timer far from the duration, so a restart is unmistakable. */
const POSED = 120;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("restarts the widen timer at its full 600", async () => {
  await world(h);
  await setEffect(h, "widen", POSED);
  const posed = await snap(h);
  assertEqual(posed.effects.widenTicks, POSED, "the posed running timer");
  assertEqual(posed.paddle.spanDeg, SPAN_WIDEN, "widen already in force");

  const after = await record(h, "widen-restart", () => dropPod(h, "widen"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.widenTicks,
    WIDEN_DURATION - 1,
    WIDEN_DURATION,
    "the timer restarts at the full duration — neither kept at 120 nor stacked to 720",
  );
  assertEqual(after.paddle.spanDeg, SPAN_WIDEN, "the span stays widened");
});
