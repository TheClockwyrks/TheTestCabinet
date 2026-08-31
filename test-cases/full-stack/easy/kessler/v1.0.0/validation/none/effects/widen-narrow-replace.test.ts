// effects/widen-narrow-replace — catching widen while narrow is in force, or
// the reverse, ends the other kind on the spot and puts the caught kind in
// force with a full timer.
//
// specs/pods.md: "`widen` and `narrow` replace each other. Catching one while
// the other is in force ends the other on the spot and puts the caught kind
// in force with a full timer." An ended timer reads 0 (specs/instrumentation:
// "0 is not in force") and the caught kind's timer is held to a one-tick
// tolerance around its full 600; the span figures 72 and 30 are the exact
// stated degrees of the kind in force.
//
// THE WORLD IS ONE RUNNING SPAN EFFECT AND ONE POD. The field is emptied and
// the switches are off, so the catch is the only event of the tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  NARROW_DURATION,
  open,
  record,
  setEffect,
  snap,
  SPAN_NARROW,
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

it("catching widen during narrow ends narrow and puts widen in force", async () => {
  await world(h);
  await setEffect(h, "narrow", 300);
  const posed = await snap(h);
  assertEqual(posed.effects.narrowTicks, 300, "the posed running narrow");
  assertEqual(posed.paddle.spanDeg, SPAN_NARROW, "narrow in force");

  const after = await record(h, "span-swap", () => dropPod(h, "widen"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertEqual(after.effects.narrowTicks, 0, "narrow ends on the spot");
  assertBetween(
    after.effects.widenTicks,
    WIDEN_DURATION - 1,
    WIDEN_DURATION,
    "widen in force with a full timer",
  );
  assertEqual(after.paddle.spanDeg, SPAN_WIDEN, "the span is widen's 72");
});

it("catching narrow during widen ends widen and puts narrow in force", async () => {
  await world(h);
  await setEffect(h, "widen", 300);
  const posed = await snap(h);
  assertEqual(posed.effects.widenTicks, 300, "the posed running widen");
  assertEqual(posed.paddle.spanDeg, SPAN_WIDEN, "widen in force");

  const after = await dropPod(h, "narrow");

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertEqual(after.effects.widenTicks, 0, "widen ends on the spot");
  assertBetween(
    after.effects.narrowTicks,
    NARROW_DURATION - 1,
    NARROW_DURATION,
    "narrow in force with a full timer",
  );
  assertEqual(after.paddle.spanDeg, SPAN_NARROW, "the span is narrow's 30");
});
