// effects/pierce-catch-leaves-span-in-force — catching pierce leaves a span
// effect in force.
//
// specs/pods.md: "`pierce` is independent of both, so it runs alongside either
// span effect." This point is the other direction from
// `span-catch-leaves-pierce-running`: a pierce catch arriving while widen runs
// must leave both widen's timer and widen's span alone.
//
// THE READING. A timer that kept running reads its posed figure less the ticks
// elapsed, to a one-tick tolerance (the catch tick's own fall at step 3 of
// specs/field.md's order is the only latitude); a cancelled timer would read 0,
// and a span returned to its baseline would read 48 instead of widen's 72.
//
// THE WORLD IS ONE RUNNING EFFECT AND ONE POD, so the catch is the only event of
// the tick.

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
  world,
  type Harness,
} from "./pose";

/** The running widen timer the pierce catch must not touch. */
const POSED_WIDEN = 300;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("keeps widen in force through a pierce catch", async () => {
  await world(h);
  await setEffect(h, "widen", POSED_WIDEN);
  const posed = await snap(h);
  assertEqual(posed.effects.widenTicks, POSED_WIDEN, "the posed widen");
  assertEqual(posed.paddle.spanDeg, SPAN_WIDEN, "widen in force");

  const after = await record(h, "span-kept", () => dropPod(h, "pierce"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.widenTicks,
    POSED_WIDEN - 2,
    POSED_WIDEN,
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
