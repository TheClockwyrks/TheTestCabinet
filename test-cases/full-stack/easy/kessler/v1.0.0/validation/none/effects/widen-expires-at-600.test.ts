// effects/widen-expires-at-600 — widen runs 600 ticks, and when its timer
// reaches 0 the span returns to its 48-degree baseline.
//
// specs/pods.md: widen's duration is "600 ticks", and "when a timer reaches
// `0` the effect ends: an ended span effect returns the span to its
// baseline". The catch tick's own reading is EXACT: specs/field.md's tick
// order runs "every running effect timer falls by one tick" as step 3 and
// resolves catches at step 4, so the catch tick ends at the full 600 — a
// timer that started at 599, or one counted down on the catch tick itself,
// reads one short and fails here (a one-tick tolerance on this reading let a
// 599-tick build through: every later reading is relative to this one). From
// it the run to 0 is exact, one fall per tick, and the restore at 0 is the
// exact 48 of specs/field.md's baseline span.
//
// THE WORLD IS ONE TIMER AND THE DEFLECTOR. The field is emptied and the
// switches are off, so nothing but expiry can end the effect.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  open,
  record,
  SPAN_BASE,
  SPAN_WIDEN,
  ticks,
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

it("runs 600 ticks and restores the 48-degree span at 0", async () => {
  await world(h);
  const caught = await dropPod(h, "widen");
  assertLength(caught.pods, 0, "the pod after the catch tick");
  assertEqual(caught.paddle.spanDeg, SPAN_WIDEN, "the span while widen runs");
  assertEqual(
    caught.effects.widenTicks,
    WIDEN_DURATION,
    "the 600-tick timer as the catch tick leaves it: timers fall at step 3, the catch applies at step 4",
  );

  const start = caught.effects.widenTicks;
  const nearEnd = await ticks(h, start - 30);
  assertEqual(
    nearEnd.effects.widenTicks,
    30,
    "the timer falls one per tick across the run",
  );
  assertEqual(
    nearEnd.paddle.spanDeg,
    SPAN_WIDEN,
    "the span holds while the timer runs",
  );

  const out = await record(h, "widen-expiry", async () => {
    const atOne = await ticks(h, 29);
    const atZero = await ticks(h, 1);
    return { atOne, atZero };
  });

  assertEqual(out.atOne.effects.widenTicks, 1, "the timer's last running tick");
  assertEqual(
    out.atOne.paddle.spanDeg,
    SPAN_WIDEN,
    "the span still widened at timer 1",
  );
  assertEqual(out.atZero.effects.widenTicks, 0, "the timer reaches 0");
  assertEqual(
    out.atZero.paddle.spanDeg,
    SPAN_BASE,
    "the span returns to its 48-degree baseline when the timer reaches 0",
  );
});
