// instrumentation/advances-in-frames — a second of game time is a second however
// it is divided: covered as one frame and as sixty, it adds the same second to
// `simTime` and carries a card in flight the same distance along `x`.
//
// THE RULE. `specs/instrumentation.md`, A render-free core: "Render-free core.
// Game state advances from the elapsed time the game is handed, independent of a
// canvas, of the frame loop that measured it, and of wall-clock time. The
// dependency runs one way: the simulation reads nothing from the renderer. Every
// rate is per second and integrated against the delta the frame supplies, so an
// interval of game time covered as one frame and as sixty frames advances
// `simTime` by the same amount and carries a flyer the same distance along `x` at
// a constant `vx`." The two divisions come from `advance`'s own row: it "runs
// `frames` whole frames covering `seconds` of game time, each worth
// `seconds / frames`".
//
// WHY IT IS THE POINT THE WHOLE SUITE RESTS ON. Every check in this project drives
// the game at two hundred and forty frames a second, and a player's machine draws
// at sixty or at a hundred and forty-four. A build that moved a card a fixed
// number of units per FRAME rather than per second reads correctly under one
// cadence and wrongly under every other, and it would pass this suite while
// playing at four times the speed on the reviewer's machine. So the same second is
// spent twice, at cadences sixty apart, and the two are required to agree.
//
// `x` IS THE QUANTITY, AND `y` IS DELIBERATELY NOT. Under the integration
// `specs/victory.md` fixes — `vy += GRAVITY * dt` and then `y += vy * dt` — a
// quantity under acceleration depends on how the interval was divided: one frame
// of a second and sixty of a sixtieth genuinely leave a falling card `885` units
// apart, and a build whose `y` agreed across the two would be one that had not
// implemented the stated integration. `vx` takes no acceleration at all and a
// floor bounce leaves it untouched, so `x` is the axis on which the specification
// makes its claim, and it is the axis this point reads.
//
// THE CARD MEETS THE FLOOR INSIDE THE SECOND, AND CANNOT BE POSED NOT TO. Those
// same `885` units are more than the `580` between the top of the stage and
// `FLOOR_Y`, so no pose keeps a card clear of the floor in both divisions and
// visible in both. What the pose can do, and does, is start it clear of the floor
// and of both side edges, with no downward speed of its own, and leave it clear of
// the side edges throughout — so nothing retires, and the only rule the bounce
// contributes to the reading is that it "keeps its horizontal drift"
// (`specs/victory.md`), which is what makes the two divisions' `x` comparable at
// all.
//
// NOTHING ELSE IS IN THE WORLD. The table is empty, the screen is the one the
// cascade runs on, and `setLaunching(false)` keeps the foundations — empty here
// anyway — from adding a second card to a reading about one. Each division is
// posed from a fresh `reset`, so the second run inherits nothing from the first,
// and `simTime` is read as the RISE across the span rather than as an absolute.
//
// THE SURFACE'S OWN `advance(seconds, frames)` IS CALLED DIRECTLY, both times,
// because the division of the interval is the subject: the harness's own drive
// runs one frame per call at a fixed cadence, which is the one thing this point
// may not let it do.
//
// WHAT THIS DOES NOT DECIDE. Where the card is, which is `cascade/advance-x`'s
// point, nor that `simTime` accumulates on every screen, which is
// `instrumentation/sim-time-accumulates`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import { CARD_W, FLOOR_Y, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseFlyer,
  requireFlyer,
  type Harness,
} from "../harness";

/** The span each division covers, in seconds of game time. */
const SPAN_SECONDS = 1;

/** The two divisions of that span, in frames. */
const ONE_FRAME = 1;
const SIXTY_FRAMES = 60;

/**
 * The card, and how fast it drifts, in logical units and units per second.
 *
 * Posed `480` units above `FLOOR_Y` (`580`) with no downward speed of its own, so
 * it starts clear of the floor, and `300` units of drift over the span leaves it
 * at `640` — `540` short of the `1180` at which its right edge would reach the
 * edge of the stage, and nowhere near the left — so it retires in neither
 * division (`specs/victory.md` retires a card at `x + CARD_W < 0` or
 * `x > STAGE_W`).
 */
const START = { x: 340, y: 100 };
const VX = 300;

/**
 * How far the two divisions' `x` may differ, in logical units.
 *
 * `0.5`, half a unit of the `300` the card covers. A conforming build integrates
 * `x += vx * dt` against deltas that sum to the same second either way, so the
 * only distance between the two readings is the floating-point difference between
 * one product and a sum of sixty — a part in `10^13` of the answer. A build moving
 * the card per frame rather than per second misses by a factor of sixty.
 */
const X_TOLERANCE = 0.5;

/**
 * How far a span's rise in `simTime` may sit from the second it was given, in
 * decimal digits for `assertCloseTo`.
 *
 * Nine, which is half a nanosecond. A conforming build accumulates exactly the
 * deltas it was handed, so the only distance from `1.0` is the sum of sixty
 * doubles; a build that counted frames instead misses by the whole second.
 */
const SIM_DIGITS = 9;

/** What one division of the span left behind. */
interface Division {
  /** The rise in `snapshot().simTime` across the span. */
  rise: number;
  /** Where the card ended, along the axis the specification makes a claim about. */
  x: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose one card in an empty world and cover the span in `frames` frames.
 *
 * The still is kept before anything is asserted, so a build that failed still
 * leaves the picture of what its division of the second did.
 */
async function cover(
  harness: Harness,
  frames: number,
  outputId: string,
): Promise<Division> {
  await openTable(harness);
  // The screen the cascade runs on, so the card is drawn (`specs/screens.md`),
  // with nothing on the table under it and nothing able to launch.
  await harness.debug.setScreen("won");
  await harness.debug.setLaunching(false);
  const id = await poseFlyer(harness, {
    x: START.x,
    y: START.y,
    vx: VX,
    vy: 0,
  });

  const before = await harness.snapshot();
  await harness.debug.advance(SPAN_SECONDS, frames);
  const after = await harness.snapshot();
  await captureStill(harness, outputId);

  return {
    rise: after.simTime - before.simTime,
    x: requireFlyer(
      after,
      id,
      `reading where ${SPAN_SECONDS} s covered as ${frames} frame(s) carried ` +
        `the card`,
    ).x,
  };
}

it("advances the same second whether it is one frame or sixty", async () => {
  if (
    START.y > FLOOR_Y ||
    START.x + VX * SPAN_SECONDS + CARD_W > STAGE_W ||
    START.x < 0
  ) {
    throw new RangeError(
      `cascade: a card posed at (${START.x}, ${START.y}) with vx ${VX} does ` +
        `not start clear of the floor and stay clear of both side edges over ` +
        `${SPAN_SECONDS} s`,
    );
  }

  const one = await cover(h, ONE_FRAME, "one-frame");
  const sixty = await cover(h, SIXTY_FRAMES, "sixty-frames");

  for (const [frames, division] of [
    [ONE_FRAME, one],
    [SIXTY_FRAMES, sixty],
  ] as const) {
    assertCloseTo(
      division.rise,
      SPAN_SECONDS,
      SIM_DIGITS,
      `the rise in snapshot().simTime over advance(${SPAN_SECONDS}, ` +
        `${frames}) — the interval is ${SPAN_SECONDS} s of game time however ` +
        `it is divided (specs/instrumentation.md)`,
    );
  }

  assertLessThanOrEqual(
    Math.abs(sixty.x - one.x),
    X_TOLERANCE,
    `how far the x the card reached over advance(${SPAN_SECONDS}, ` +
      `${SIXTY_FRAMES}) sits from the x it reached over advance(` +
      `${SPAN_SECONDS}, ${ONE_FRAME}), in logical units — the same interval ` +
      `carries a flyer the same distance along x at a constant vx, so the ` +
      `simulation reads nothing from the renderer ` +
      `(specs/instrumentation.md); one frame left it at ${one.x.toFixed(3)} ` +
      `and sixty at ${sixty.x.toFixed(3)}, from ${START.x}`,
  );
});
