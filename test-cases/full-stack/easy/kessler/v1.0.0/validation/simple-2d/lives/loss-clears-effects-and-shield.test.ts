// lives/loss-clears-effects-and-shield — a life loss ends every timed effect,
// restores the span, and drops the shield.
//
// specs/field.md, in the life-loss check: "every timed effect, the shield, and
// every pod are cleared"; specs/pods.md states the same lifecycle with the
// span spelled out: "On a life loss and at the clearing event, every timed
// effect ends, the span returns to its baseline, the shield disappears" — the
// baseline being the 48 degrees of specs/field.md's deflector span. The world
// is posed with widen and pierce in force (they run together: "pierce is
// independent of both") and the shield raised, then the last ball burns.
//
// The doomed ball starts at radius 95, INSIDE the raised shield's contact
// radius 100 — the shield's one contact is that radius "crossed inward", so a
// ball that begins below it burns on the planet without ever meeting the
// shield, and the shield seen disappearing here disappears to the loss alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { START_LIVES } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  BASE_SPAN_DEG,
  PIERCE_POSE_TICKS,
  spawnDoomedBall,
  WIDEN_POSE_TICKS,
  WIDEN_SPAN_DEG,
} from "./loss";

/** Ticks that cover the short fall from inside the shield, with slack. */
const WATCH_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the effects, restores the span, and drops the shield on the loss", async () => {
  isolate(h);
  h.debug.setEffectTicks("widen", WIDEN_POSE_TICKS);
  h.debug.setEffectTicks("pierce", PIERCE_POSE_TICKS);
  h.debug.setShield(true);
  spawnDoomedBall(h, 95);

  const posed = h.snapshot();
  assertEqual(
    posed.effects.widenTicks,
    WIDEN_POSE_TICKS,
    "the widen timer posed in force",
  );
  assertEqual(
    posed.effects.pierceTicks,
    PIERCE_POSE_TICKS,
    "the pierce timer posed in force",
  );
  assertEqual(posed.effects.shieldActive, true, "the shield posed raised");
  assertCloseTo(
    posed.paddle.spanDeg,
    WIDEN_SPAN_DEG,
    3,
    "the widened span in force before the loss",
  );

  const run = await captureReplay(h, "loss", () =>
    h.until((s) => s.lives !== START_LIVES, { maxTicks: WATCH_TICKS }),
  );

  assertTrue(run.hit, "a life loss within the fall's ticks");
  const s = run.snapshot;
  assertEqual(s.effects.widenTicks, 0, "the widen timer on the loss tick");
  assertEqual(s.effects.narrowTicks, 0, "the narrow timer on the loss tick");
  assertEqual(s.effects.pierceTicks, 0, "the pierce timer on the loss tick");
  assertEqual(s.effects.shieldActive, false, "the shield after the loss");
  assertCloseTo(
    s.paddle.spanDeg,
    BASE_SPAN_DEG,
    3,
    "the span back at its 48-degree baseline",
  );
});
