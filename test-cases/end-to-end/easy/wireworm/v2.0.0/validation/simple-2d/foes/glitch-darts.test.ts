// foes/glitch-darts — a glitch reverses its horizontal direction at each dart
// interval.
//
// specs/foes.md states the rule outright: "Its horizontal direction reverses at
// each GLITCH_DART_INTERVAL, so it darts back and forth as it descends. The dart
// clock starts when the glitch comes into existence and runs on the same
// accumulate-and-carry rule the worm's step clock uses." The rule is stated
// rather than left to a random re-pick precisely so a check can assert it
// without an unlucky draw failing a spec-honouring build.
//
// So the reading is a COUNT and a SET OF FRAMES rather than a boolean: over the
// span, the reported `vx` must reverse sign once per interval boundary and at
// each boundary, and the distance swept each way is carried into the failure so
// a wrong build is named by a number. The glitch's own snapshot `vx` is "what
// that center is changing by right now" (specs/instrumentation.md), so a
// reversal is a sign change in it.
//
// Both faculties are on: the dart is the mind's, and the sweep it produces needs
// the travel. The glitch is posed in the middle of the board, where a dart
// carries it at most GLITCH_H_SPEED * GLITCH_DART_INTERVAL (67.2 units) from
// where it started, so the side-edge reversal specs/foes.md also states never
// takes part, and high enough that it does not leave through the bottom.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_DART_INTERVAL, GLITCH_H_SPEED } from "../constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  foeOf,
  startPlaying,
  TICK_HZ,
  ticksFor,
  type Harness,
} from "../harness";
import { poseFoePoint, tileCenter } from "./harness";

/** The span the darting is watched over, as the review item states it. */
const SPAN_SECONDS = 3;
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/** Boundaries of a whole GLITCH_DART_INTERVAL inside the span: nine of them. */
const EXPECTED_REVERSALS = Math.floor(SPAN_SECONDS / GLITCH_DART_INTERVAL);

/**
 * The frame the `n`-th boundary falls on: the first frame whose accumulated
 * time has reached `n` whole intervals. The interval is not a whole number of
 * the suite's frames (0.32 s is 38.4 of them), so the boundary is crossed
 * INSIDE a frame and the reversal is read at the end of that frame.
 */
function boundaryFrame(n: number): number {
  return Math.ceil(n * GLITCH_DART_INTERVAL * TICK_HZ);
}

/**
 * How far a reversal may land from its boundary: one frame of the suite's own
 * clock, which is the finest the sweep can resolve.
 */
const FRAME_TOLERANCE = 1;

/** Where the glitch is posed: mid-board, clear of every edge for the span. */
const START = tileCenter(20, 3);

/** What the sweep read off the glitch, frame by frame. */
interface Darting {
  /** The frame each sign change of `vx` was read on. */
  reversals: number[];
  /** How far the center travelled right over the whole span, and left. */
  right: number;
  left: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reverses the glitch's horizontal direction at each dart interval", async () => {
  startPlaying(h);
  const id = poseFoePoint(h, "glitch", START.x, START.y);

  const darting = await captureReplay(
    h,
    "darts",
    async (): Promise<Darting> => {
      const reversals: number[] = [];
      let right = 0;
      let left = 0;
      let previous = foeOf(h.snapshot(), id);
      let sign = Math.sign(previous.vx);

      for (let frame = 1; frame <= SPAN_FRAMES; frame += 1) {
        await h.advance(1);
        const now = foeOf(h.snapshot(), id);
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
      `${SPAN_SECONDS} s, at GLITCH_H_SPEED ${GLITCH_H_SPEED}; ${swept}`,
  );

  for (const [index, frame] of darting.reversals.entries()) {
    const expected = boundaryFrame(index + 1);
    assertLessThanOrEqual(
      Math.abs(frame - expected),
      FRAME_TOLERANCE,
      `reversal ${index + 1} lands on its interval boundary, frame ` +
        `${expected} of the sweep; frames off the boundary`,
    );
  }
});
