// effects/span-catch-leaves-pierce-running — catching a span kind leaves pierce
// running.
//
// specs/pods.md: "`pierce` is independent of both, so it runs alongside either
// span effect." This point is one direction of that independence: a widen catch
// arriving while pierce runs must leave `pierceTicks` counting down rather than
// ending it. The other direction — a pierce catch leaving a span effect in force
// — is `pierce-catch-leaves-span-in-force`, and a build may hold one and not the
// other.
//
// THE READING. A timer that kept running reads its posed figure less the ticks
// elapsed, to a one-tick tolerance (the catch tick's own fall at step 3 of
// specs/field.md's order is the only latitude); a cancelled timer would read 0.
//
// THE WORLD IS ONE RUNNING EFFECT AND ONE POD, so the catch is the only event of
// the tick.

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

/** The running pierce timer the span catch must not touch. */
const POSED_PIERCE = 300;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("keeps pierce counting down through a widen catch", async () => {
  await world(h);
  await setEffect(h, "pierce", POSED_PIERCE);
  assertEqual(
    (await snap(h)).effects.pierceTicks,
    POSED_PIERCE,
    "the posed pierce",
  );

  const after = await record(h, "pierce-kept", () => dropPod(h, "widen"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertBetween(
    after.effects.pierceTicks,
    POSED_PIERCE - 2,
    POSED_PIERCE,
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
