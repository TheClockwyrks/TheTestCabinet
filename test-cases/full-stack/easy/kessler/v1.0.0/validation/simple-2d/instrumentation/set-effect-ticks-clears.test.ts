// instrumentation/set-effect-ticks-clears — a zero ends the effect and restores
// the baseline.
//
// specs/instrumentation.md, `setEffectTicks(kind, ticks)`: "A `ticks` of `0`
// ends the effect and restores the baseline exactly as its expiry does."
// specs/pods.md fixes what expiry restores: "an ended span effect returns the
// span to its baseline, and an ended `pierce` returns every ball to ordinary
// contacts", and specs/field.md fixes that baseline at `48` degrees.
//
// BOTH KINDS OF ENDING ARE READ. A span effect is posed and zeroed, and the
// span must be back at its baseline; pierce is posed, a ball spawned under it,
// and after the zero a ball spawned afterwards must no longer be piercing —
// which is `spawnBall`'s own wording, "piercing exactly when `pierceTicks` is
// above `0` at the call". That a timer above zero ARMS an effect is
// `set-effect-ticks-arms`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEFLECTOR_BASE_SPAN_DEG } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";

/** Distinctive posed timers — not the catch durations, deliberately. */
const WIDEN_POSED = 120;
const PIERCE_POSED = 50;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the baseline span and ordinary contacts on a zero", async () => {
  isolate(h);

  const ended = await captureReplay(h, "cleared", async () => {
    h.debug.setEffectTicks("widen", WIDEN_POSED);
    h.debug.setEffectTicks("pierce", PIERCE_POSED);
    await h.tick(1);

    h.debug.setEffectTicks("widen", 0);
    h.debug.setEffectTicks("pierce", 0);
    spawnBallPolar(h, 250, 200, 0, 0);
    return h.tick(1);
  });

  assertEqual(ended.effects.widenTicks, 0, "the widen timer after the zero");
  assertEqual(ended.effects.pierceTicks, 0, "the pierce timer after the zero");
  assertEqual(
    ended.paddle.spanDeg,
    DEFLECTOR_BASE_SPAN_DEG,
    "the span restored to its baseline",
  );
  assertEqual(
    ended.balls[0].piercing,
    false,
    "a ball spawned after pierce ended",
  );
  assertEqual(ended.score, 0, "the score across every pose");
});
