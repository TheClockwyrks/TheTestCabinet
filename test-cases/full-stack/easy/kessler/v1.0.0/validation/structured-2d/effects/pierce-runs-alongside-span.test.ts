// effects/pierce-runs-alongside-span — pierce is independent of both span
// effects: catching a span kind during pierce leaves pierceTicks running, and
// catching pierce leaves the span effect in force.
//
// specs/pods.md: "`pierce` is independent of both, so it runs alongside
// either span effect." A timer that kept running reads its posed figure less
// the ticks elapsed, to a one-tick tolerance (the catch tick's own count is
// the only latitude the timer words leave); a cancelled timer would read 0.
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

it("catching widen during pierce leaves pierceTicks running", async () => {
  await world(h);
  await setEffect(h, "pierce", 300);
  assertEqual((await snap(h)).effects.pierceTicks, 300, "the posed pierce");

  const after = await record(h, "pierce-alongside", () => dropPod(h, "widen"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.pierceTicks,
    298,
    300,
    "pierce keeps running through the span catch — down by the elapsed tick, not ended",
  );
  assertBetween(
    after.effects.widenTicks,
    WIDEN_DURATION - 1,
    WIDEN_DURATION,
    "widen in force from the catch",
  );
  assertEqual(after.paddle.spanDeg, SPAN_WIDEN, "the span is widen's 72");
});

it("catching pierce leaves the span effect in force", async () => {
  await world(h);
  await setEffect(h, "widen", 300);
  const posed = await snap(h);
  assertEqual(posed.effects.widenTicks, 300, "the posed widen");
  assertEqual(posed.paddle.spanDeg, SPAN_WIDEN, "widen in force");

  const after = await dropPod(h, "pierce");

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.widenTicks,
    298,
    300,
    "widen keeps running through the pierce catch — down by the elapsed tick, not ended",
  );
  assertEqual(after.paddle.spanDeg, SPAN_WIDEN, "the span stays widen's 72");
  assertBetween(
    after.effects.pierceTicks,
    PIERCE_DURATION - 1,
    PIERCE_DURATION,
    "pierce in force from the catch",
  );
});
