// foes/glitch-darts — a glitch reverses its horizontal direction at each dart
// interval.
//
// `specs/foes.md` states the rule outright: "Its horizontal direction reverses
// at each GLITCH_DART_INTERVAL, so it darts back and forth as it descends. The
// dart clock starts when the glitch comes into existence and runs on the same
// accumulate-and-carry rule the worm's step clock uses." The rule is STATED
// rather than left to a random re-pick precisely so this point can assert it: a
// check that assumed randomness would fail a spec-honouring build on an unlucky
// seed.
//
// WHAT IS READ. `specs/instrumentation.md` makes a foe's reported `vx` "what its
// position is changing by right now, including any dart", so a reversal is a
// sign change in it. The sweep therefore counts sign changes and records the
// frame each landed on: over the span there must be one per whole interval, and
// each must land on its interval's boundary. The distance swept each way is
// carried into every failure message, so a build that reverses too rarely or
// never is named by a number rather than by a boolean.
//
// BOTH FACULTIES ARE ON, because the dart is the mind's and the sweep it makes
// is the travel's, and this rule is about the two together. The glitch is posed
// on a middle column, where one interval carries it at most
// GLITCH_H_SPEED * GLITCH_DART_INTERVAL (67.2 units) from where it started, so
// the side-edge reversal `specs/foes.md` also states never takes part; and high
// enough that three seconds of descent leaves it well above the bottom edge.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_DART_INTERVAL, GLITCH_H_SPEED } from "../constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The span the darting is watched over, as the review item states it. */
const SPAN_SECONDS = 3;
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/** Whole GLITCH_DART_INTERVALs inside that span, and so reversals: nine. */
const EXPECTED_REVERSALS = Math.floor(SPAN_SECONDS / GLITCH_DART_INTERVAL);

/**
 * The frame the `n`-th interval boundary falls on: the first frame whose
 * accumulated time has reached `n` whole intervals.
 */
function boundaryFrame(n: number): number {
  return Math.ceil(n * GLITCH_DART_INTERVAL * TICK_HZ);
}

/**
 * How far a reversal may land from its boundary: one frame of the suite's own
 * clock.
 *
 * Not a slackening of the rule but the resolution of the reading. A boundary at
 * a whole number of frames is reached by an accumulator adding a hundred
 * floating-point deltas together, which can land a whisker either side of it, so
 * the reversal is read at the end of the frame the boundary fell in or the one
 * after. Anything looser would stop separating nine reversals from eight.
 */
const FRAME_TOLERANCE = 1;

/** Where the glitch is posed: a middle column, clear of every edge for the span. */
const START_C = 20;
const START_R = 3;

/** What the sweep read off the glitch, frame by frame. */
interface Darting {
  /** The frame of the sweep each sign change of `vx` was read on. */
  reversals: number[];
  /** How far the center travelled right over the whole span, and left. */
  right: number;
  left: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reverses the glitch's horizontal direction at each dart interval", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "glitch", START_C, START_R);

  const darting = await captureReplay(
    h,
    "darts",
    async (): Promise<Darting> => {
      const reversals: number[] = [];
      let right = 0;
      let left = 0;
      let previous = requireFoe(
        await h.snapshot(),
        id,
        "the glitch posed to dart",
      );
      let sign = Math.sign(previous.vx);

      for (let frame = 1; frame <= SPAN_FRAMES; frame += 1) {
        await h.advance(1);
        const now = requireFoe(
          await h.snapshot(),
          id,
          "the glitch that was darting",
        );
        const step = now.x - previous.x;
        if (step > 0) right += step;
        else left -= step;
        const next = Math.sign(now.vx);
        if (next !== 0) {
          if (sign !== 0 && next !== sign) reversals.push(frame);
          sign = next;
        }
        previous = now;
      }
      return { reversals, right, left };
    },
  );

  const swept =
    `swept ${darting.right.toFixed(1)} right and ` +
    `${darting.left.toFixed(1)} left`;

  assertLength(
    darting.reversals,
    EXPECTED_REVERSALS,
    `one reversal per GLITCH_DART_INTERVAL (${GLITCH_DART_INTERVAL} s) over ` +
      `${SPAN_SECONDS} s at GLITCH_H_SPEED ${GLITCH_H_SPEED}; the glitch ` +
      `${swept}`,
  );

  for (const [index, frame] of darting.reversals.entries()) {
    const expected = boundaryFrame(index + 1);
    assertLessThanOrEqual(
      Math.abs(frame - expected),
      FRAME_TOLERANCE,
      `reversal ${index + 1} lands on its interval boundary, frame ` +
        `${expected} of the sweep; frames off that boundary`,
    );
  }
});
