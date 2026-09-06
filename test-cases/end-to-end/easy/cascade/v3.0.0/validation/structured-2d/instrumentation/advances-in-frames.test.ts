// instrumentation/advances-in-frames — the simulation advances on elapsed time
// alone, and reads nothing from the renderer.
//
// THE RULE. specs/instrumentation.md, under A render-free core: "Game state
// advances from the elapsed time the game is handed, independent of a canvas,
// of the frame loop that measured it, and of wall-clock time. The dependency
// runs one way: the simulation reads nothing from the renderer. Every rate is
// per second and integrated against the delta the frame supplies, so an
// interval of game time covered as one frame and as sixty frames advances
// `simTime` by the same amount and carries a flyer the same distance along `x`
// at a constant `vx`."
//
// THE STEP IS THE THING UNDER TEST, so this is the one suite in the group that
// builds harnesses with clocks of its own: one whose every frame is worth a
// whole second, one whose frames are worth a sixtieth, and the same second
// covered on each — one frame against sixty.
//
// WHY A BUILD FAILS THIS. A build that counts frames rather than integrating
// seconds — `x += vx` per frame, `simTime += 1/60` per frame — reads sixty
// times the travel and sixty times the clock on the fine harness, so the two
// disagree by a factor of sixty rather than by a rounding error. A build that
// reads the frame's delta off the renderer, or off the wall clock, disagrees
// the same way.
//
// `y` AND `vy` ARE DELIBERATELY NOT COMPARED. specs/victory.md fixes a
// semi-implicit Euler integration — `vy += GRAVITY * dt` and then `y += vy * dt`
// — and a quantity under acceleration is NOT independent of how an interval was
// divided into frames: one second taken whole and one second taken in sixtieths
// leave a card in different places by arithmetic, not by any fault. A build
// whose `y` agreed across the two divisions would be one that had not
// implemented the stated integration. `x` is compared because `vx` is constant
// — nothing accelerates it, and a floor bounce leaves it alone — so the same
// elapsed time carries the card the same distance however it was divided.
//
// THE CARD IS POSED CLEAR OF THE FLOOR AND OF BOTH SIDE EDGES, at
// `(400, 300)`, and its `vx` carries it `120` units over the second, so it
// cannot cross a side edge and retire (specs/victory.md retires a card at a
// side edge and nowhere else) and its `x` is there to read at the end on both
// harnesses.
//
// LAUNCHING IS OFF, so the cascade adds no second card to the flight and no
// launch draw separates the two runs.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  KING,
  captureStill,
  card,
  createHarness,
  openTable,
  poseFlyer,
  type Harness,
} from "../harness";

/** The card in flight: clear of the floor at `y = 580`, and of both side edges. */
const FLYER = { spec: card("hearts", KING), x: 400, y: 300, vx: 120, vy: 0 };

/** The second covered, and the two ways of covering it. */
const SPAN_SECONDS = 1;
const COARSE_FRAMES = 1;
const FINE_FRAMES = 60;

/**
 * How far apart the two `x` readings may lie, in logical units.
 *
 * The item's figure, and a generous one: the two are the same sum of `vx * dt`
 * taken in one term and in sixty, which agree to floating-point noise, while a
 * build that counts frames instead of integrating seconds reads sixty times the
 * travel.
 */
const X_TOLERANCE = 0.5;

/**
 * How far apart the two `simTime` gains may lie, in seconds.
 *
 * Sixty additions of `1/60` in double precision land within a few parts in
 * `10^15` of `1.0`, so this is orders of magnitude wider than the arithmetic
 * and orders of magnitude narrower than any way of being wrong.
 */
const SIM_TIME_TOLERANCE = 1e-6;

/** What one harness's second of game time did to the clock and to the card. */
interface Covered {
  simTimeGain: number;
  x: number;
  flyers: number;
}

/** The harnesses an `it` built, disposed whatever its verdict. */
let built: Harness[] = [];

afterEach(() => {
  for (const harness of built) harness.dispose();
  built = [];
});

/** Cover `SPAN_SECONDS` as `frames` frames, and report what moved. */
async function cover(frames: number, outputId: string): Promise<Covered> {
  const harness = await createHarness({
    clock: new ConstantClock((SPAN_SECONDS * 1000) / frames),
  });
  built.push(harness);

  openTable(harness);
  harness.debug.setScreen("won");
  harness.debug.setLaunching(false);
  poseFlyer(harness, FLYER.spec, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);

  const before = harness.snapshot().simTime;
  await harness.advance(frames);
  const after = harness.snapshot();
  captureStill(harness, outputId);

  return {
    simTimeGain: after.simTime - before,
    x: after.flyers[0]?.x ?? Number.NaN,
    flyers: after.flyers.length,
  };
}

it("covers one second as one frame and as sixty with the same clock gain and the same travel", async () => {
  const coarse = await cover(COARSE_FRAMES, "one-frame");
  const fine = await cover(FINE_FRAMES, "sixty-frames");

  assertLessThanOrEqual(
    Math.abs(coarse.simTimeGain - SPAN_SECONDS),
    SIM_TIME_TOLERANCE,
    `seconds simTime gained over ${SPAN_SECONDS} s covered as ` +
      `${COARSE_FRAMES} frame: every rate is integrated against the delta the ` +
      "frame supplies (specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    Math.abs(fine.simTimeGain - SPAN_SECONDS),
    SIM_TIME_TOLERANCE,
    `seconds simTime gained over the same ${SPAN_SECONDS} s covered as ` +
      `${FINE_FRAMES} frames (specs/instrumentation.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(coarse.simTimeGain - fine.simTimeGain),
    SIM_TIME_TOLERANCE,
    "the difference between the two clock gains: the same second, however it " +
      "was divided into frames (specs/instrumentation.md)",
  );

  assertEqual(
    coarse.flyers,
    1,
    `cards in flight after the second covered as ${COARSE_FRAMES} frame, ` +
      "with launching off",
  );
  assertEqual(
    fine.flyers,
    1,
    `cards in flight after the second covered as ${FINE_FRAMES} frames, ` +
      "with launching off",
  );
  assertLessThanOrEqual(
    Math.abs(coarse.x - fine.x),
    X_TOLERANCE,
    `how far the card's x after ${COARSE_FRAMES} frame lies from its x after ` +
      `${FINE_FRAMES} frames, both covering ${SPAN_SECONDS} s at a constant ` +
      `vx of ${FLYER.vx}: the same elapsed time carries it the same distance ` +
      "however the frames divided it (specs/instrumentation.md)",
  );
});
