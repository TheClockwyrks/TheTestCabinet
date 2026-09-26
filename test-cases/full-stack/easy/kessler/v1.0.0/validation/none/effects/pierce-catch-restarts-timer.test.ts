// effects/pierce-catch-restarts-timer — catching pierce while pierce runs
// restarts its timer at the full duration.
//
// specs/pods.md: "Catching a kind already in force restarts its timer at the
// full duration." The in-force precondition is posed with `setEffectTicks`,
// which specs/instrumentation.md fixes as putting the effect in force "exactly
// as catching its pod would" with "the timer at exactly `ticks`".
//
// THE READING SEPARATES THREE DESIGNS. A restart reads about 360, a kept timer
// reads the posed 50, and a stacked one reads about 410; the one-tick tolerance
// is the only latitude the timer words leave, because the catch tick's own fall
// at step 3 of specs/field.md's order may or may not have run first.
//
// THE WORLD IS ONE RUNNING EFFECT AND ONE POD, so the catch is the only event of
// the tick. Widen's restart is its own point, because a build may hold one and
// not the other.

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
  world,
  type Harness,
} from "./pose";

/** A running timer far from the duration, so a restart is unmistakable. */
const POSED = 50;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("restarts the pierce timer at its full 360", async () => {
  await world(h);
  await setEffect(h, "pierce", POSED);
  assertEqual(
    (await snap(h)).effects.pierceTicks,
    POSED,
    "the posed running timer",
  );

  const after = await record(h, "pierce-restart", () => dropPod(h, "pierce"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.pierceTicks,
    PIERCE_DURATION - 1,
    PIERCE_DURATION,
    "the timer restarts at the full duration — neither kept at 50 nor stacked to 410",
  );
});
