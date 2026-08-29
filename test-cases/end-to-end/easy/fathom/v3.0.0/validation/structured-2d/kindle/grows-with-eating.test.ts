// kindle/grows-with-eating — the circle grows as you eat.
//
// specs/sensing.md: "Its radius is `R = KINDLE_VISION_MIN + KINDLE_VISION_GAIN *
// G`, with `KINDLE_VISION_MIN` (`192`) and `KINDLE_VISION_GAIN` (`128`) in
// logical units, so `R` is `192` (6 tiles) at `G = 0` and `320` (10 tiles) at
// `G = 1`", and "`V` is smaller than `R` at every brightness". specs/state.md has
// `windowRadius` "derived from `brightness` by the formula in specs/sensing.md
// rather than held independently".
//
// So the reading is the whole curve, not its ends: `R` is read at five posed
// brightnesses across `[0, 1]`, each against the formula, and against the `V` the
// same snapshot reports. Reading only `0` and `1` would pass a build that
// interpolated on some other curve between them, and reading only `R` would pass
// one that had quietly made the two circles the same size.
//
// BRIGHTNESS IS POSED, NOT EARNED. `setBrightness(g)` sets `G` and "everything
// derived from brightness recomputes from it", and it "arms the `BRIGHT_HOLD`
// (`1.0 s`) brightness hold ... so the value it poses is steady for that full
// second" (specs/instrumentation.md). Every reading below is taken a couple of
// ticks after the pose and well inside that second, so `G` is exactly what was
// asked for. What eating does to `G` is `brightness/from-eating`'s point; what
// `G` does to the circle is this one's.
//
// A BEAT AFTER THE POSE, NOT ON IT. A build is free to recompute the radius at
// the top of the next step rather than inside the call, and both honour the page,
// so each radius is read two ticks after the brightness that produced it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { KINDLE_VISION_GAIN, KINDLE_VISION_MIN, windowRadius } from "./circle";
import { BRIGHT_HOLD } from "../../src/constants";

/** The board: a three-tile corridor the forager is parked on, and nothing else. */
const ART = ["H.."] as const;

/**
 * The brightnesses `R` is read at.
 *
 * The two ends the review item names, and three points between them, so a build
 * that reaches `192` and `320` by some other curve fails here rather than passing
 * on its endpoints.
 */
const POSED = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * How far the reported radius may sit from the formula, in logical units.
 *
 * The review item's own bound: "192 at G 0 and 320 at G 1, within 1 unit". A
 * radius is derived rather than integrated, so the only slack it needs is a
 * build's floating-point arithmetic.
 */
const RADIUS_TOLERANCE = 1;

/** Ticks between posing a brightness and reading what it derived. */
const SETTLE_TICKS = 2;

/** Ticks each posed brightness is held for, so the clip shows the circle at rest. */
const HOLD_TICKS = 20;

/** `R` at brightness `g`, as specs/sensing.md gives it. */
function expected(g: number): number {
  return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * g;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The circle grows as you eat", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  // Parked facing rock with its own pellet eaten, so nothing the forager does can
  // move `G` under the readings.
  await parkForager(h, board.mark("H"));
  const guard = await sceneGuard(h);

  const readings = await captureReplay(h, "grow", async () => {
    const taken: { g: number; radius: number; vision: number }[] = [];
    for (const g of POSED) {
      h.debug.setBrightness(g);
      h.debug.setBrightHold(BRIGHT_HOLD);
      await h.advance(SETTLE_TICKS);
      const snapshot = h.snapshot();
      taken.push({
        g,
        radius: windowRadius(snapshot),
        vision: snapshot.visionRadius,
      });
      // The rest of the second the hold runs for, so the recording shows the
      // circle standing at each width rather than flicking through them.
      await h.advance(HOLD_TICKS - SETTLE_TICKS);
    }
    return taken;
  });

  requireSceneHeld(h.snapshot(), guard);

  for (const reading of readings) {
    assertLessThanOrEqual(
      Math.abs(reading.radius - expected(reading.g)),
      RADIUS_TOLERANCE,
      `|windowRadius - ${expected(reading.g)}| at the posed G of ${reading.g}, ` +
        `where specs/sensing.md gives R = ${KINDLE_VISION_MIN} + ` +
        `${KINDLE_VISION_GAIN} * G`,
    );
    assertGreaterThan(
      reading.radius,
      reading.vision,
      `the vision circle R against the light pocket V at the posed G of ` +
        `${reading.g}: V is smaller than R at every brightness`,
    );
  }
});
