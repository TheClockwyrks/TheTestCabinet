// instrumentation/set-effect-ticks-arms — a timer above zero puts the effect in
// force as a catch would, and scores nothing.
//
// specs/instrumentation.md, `setEffectTicks(kind, ticks)`: "A `ticks` above `0`
// puts the effect in force exactly as catching its pod would, with the same
// span change and the same mutual cancel between `widen` and `narrow`, and the
// timer at exactly `ticks`; the catch score is not added." The figures those
// clauses lean on are specs/pods.md's: widen's span is `72`, narrow's `30`, and
// "widen and narrow replace each other", while `pierce` "is independent of
// both, so it runs alongside either span effect".
//
// THE POSED TIMERS ARE DELIBERATELY NOT THE CATCH DURATIONS, so the timer read
// back can only be the argument. Pierce being in force is read the way
// `spawnBall` words it — "the ball is piercing exactly when `pierceTicks` is
// above `0` at the call" — rather than by the timer alone. That a ZERO ends an
// effect is `set-effect-ticks-clears`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { NARROW_SPAN, WIDEN_SPAN } from "../constants";
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

it("arms each kind with its span rule and adds no catch score", async () => {
  await isolate(h);

  const after = await captureReplay(h, "armed", async () => {
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
  assertEqual(after.score, 0, "the score across every pose");
});
