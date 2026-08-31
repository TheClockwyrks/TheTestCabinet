// instrumentation/set-effect-ticks — the pose puts the effect in force as a
// catch would, scoreless, and a zero ends it as expiry would.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `setEffectTicks`
// as: "a `ticks` above `0` puts the effect in force exactly as catching its pod
// would, with the same span change and the same mutual cancel between `widen`
// and `narrow`, and the timer at exactly `ticks`; the catch score is not added.
// A `ticks` of `0` ends the effect and restores the baseline exactly as its
// expiry does." The figures those clauses lean on are specs/pods.md's: widen's
// span is `72`, narrow's `30`, the baseline `48`, and "widen and narrow replace
// each other".
//
// THE READS WALK THE SENTENCE. Widen posed at 120 reads back a 120 timer, a 72
// span, and an unmoved score; narrow posed on top of it reads back its own
// timer with widen's at 0 and the span at 30 (the mutual cancel); pierce posed
// beside it leaves the span alone (independent), and a ball spawned while it
// runs is piercing — spawnBall's own wording, "the ball is piercing exactly
// when `pierceTicks` is above `0` at the call", makes that the in-force read.
// Then narrow posed to 0 ends it: timer 0, span back to 48, score still
// unmoved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { NARROW_SPAN, PADDLE_SPAN_BASE, WIDEN_SPAN } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";

/** Distinctive posed timers — not the catch durations, deliberately. */
const WIDEN_POSED = 120;
const NARROW_POSED = 90;
const PIERCE_POSED = 50;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses each timer with its span rules and ends on zero", async () => {
  await isolate(h);

  const after = await captureReplay(h, "posed", async () => {
    await h.debug.setEffectTicks("widen", WIDEN_POSED);
    const widened = await h.snapshot();
    assertEqual(widened.effects.widenTicks, WIDEN_POSED, "the widen timer");
    assertEqual(widened.paddle.spanDeg, WIDEN_SPAN, "the widened span");
    assertEqual(widened.score, 0, "the score after posing widen");
    await h.tick(1);

    await h.debug.setEffectTicks("narrow", NARROW_POSED);
    const narrowed = await h.snapshot();
    assertEqual(narrowed.effects.narrowTicks, NARROW_POSED, "the narrow timer");
    assertEqual(
      narrowed.effects.widenTicks,
      0,
      "the widen timer after narrow replaced it",
    );
    assertEqual(narrowed.paddle.spanDeg, NARROW_SPAN, "the narrowed span");
    await h.tick(1);

    await h.debug.setEffectTicks("pierce", PIERCE_POSED);
    const pierced = await h.snapshot();
    assertEqual(pierced.effects.pierceTicks, PIERCE_POSED, "the pierce timer");
    assertEqual(pierced.paddle.spanDeg, NARROW_SPAN, "the span beside pierce");
    await spawnBallPolar(h, 250, 200, 0, 0);
    assertEqual(
      (await h.snapshot()).balls[0].piercing,
      true,
      "a ball spawned while pierce is in force",
    );
    return h.tick(1);
  });
  // Two ticks ran since narrow was posed at 90: the timer counts from there.
  assertEqual(
    after.effects.narrowTicks,
    NARROW_POSED - 2,
    "the narrow timer counting from the posed figure",
  );

  await h.debug.setEffectTicks("narrow", 0);
  const ended = await h.snapshot();
  assertEqual(ended.effects.narrowTicks, 0, "the narrow timer after the zero");
  assertEqual(
    ended.paddle.spanDeg,
    PADDLE_SPAN_BASE,
    "the span restored to its baseline",
  );
  assertEqual(ended.score, 0, "the score across every pose");
});
