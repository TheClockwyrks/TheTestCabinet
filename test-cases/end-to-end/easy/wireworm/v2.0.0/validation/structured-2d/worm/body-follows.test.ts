// worm/body-follows — every segment moves into the tile the segment ahead of it
// held.
//
// specs/worm.md, The body follows: "Every step, once the head has moved, each
// remaining segment moves into the tile the segment ahead of it occupied before
// that step. The chain therefore travels the head's exact path, one tile behind
// the segment ahead of it."
//
// WHAT IS ASSERTED. The rule itself, step by step, rather than a shape the
// scenario happens to produce: after each step, segment `i` stands exactly
// where segment `i - 1` stood BEFORE that step. Reading it as a relation
// between two consecutive snapshots is what makes it independent of where the
// head went — a build whose head winds correctly and whose body lags two tiles,
// or drags from the tail end, or leaves the chain in place, fails on the
// relation while a shape comparison against a straight line would not.
//
// THE WORLD THIS POSES. An empty, quiet board carrying one worm of six
// segments, laid along a clear row with room for five steps in front of it. The
// head is therefore never blocked, so the path the body follows is a simple one
// and any failure is the body's rather than the wind's
// (`worm.winds-horizontal`'s requirement).

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  type Harness,
  type Tile,
} from "../harness";

/** The worm posed: six segments, head at (10, 5), trailing to column 5. */
const LENGTH = 6;
const START_C = 10;
const START_R = 5;

/** Steps driven. Five carries the head to column 15, still clear of the edge. */
const STEPS = 5;

/**
 * How long one step may take before the drive gives up, in frames. Four of
 * level 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves each segment into the tile the segment ahead of it held", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, LENGTH, 1, 1);

  /** The chain as each step left it, the posed arrangement first. */
  const chain: (readonly Tile[] | undefined)[] = [
    wormById(h.snapshot(), id)?.segments,
  ];

  await captureReplay(h, "body", async () => {
    for (let step = 1; step <= STEPS; step += 1) {
      const before = chain[step - 1];
      const headC = before === undefined ? START_C : before[0].c;
      const headR = before === undefined ? START_R : before[0].r;
      const swept = await h.until(
        (s) => {
          const head = wormById(s, id)?.segments[0];
          return head !== undefined && !(head.c === headC && head.r === headR);
        },
        { maxFrames: STEP_TIMEOUT, poll: 1 },
      );
      chain.push(
        swept.hit ? wormById(swept.snapshot, id)?.segments : undefined,
      );
      if (!swept.hit) break;
    }
    // A settle, inside the bracket: two further steps' worth of frames, so a
    // reviewer watching this replay sees the worm travel ON rather than the
    // recording cutting to black on the frame the last step landed. Half an
    // interval past the second of them, which is the furthest point from a
    // step boundary. Every reading above was taken before it, so no verdict
    // moves.
    await h.advance(ticksFor(WORM_STEP_L1 * 2.5));
  });

  assertDeepEqual(
    chain[0]?.length,
    LENGTH,
    `the posed worm carries ${LENGTH} segments`,
  );
  for (let step = 1; step <= STEPS; step += 1) {
    const before = chain[step - 1];
    const after = chain[step];
    assertEqual(
      after !== undefined,
      true,
      `step ${step} taken within ${STEP_TIMEOUT} frames, and the worm still on the board`,
    );
    assertEqual(after?.length, LENGTH, `after step ${step}: segments carried`);
    for (let index = 1; index < LENGTH; index += 1) {
      assertDeepEqual(
        after?.[index],
        before?.[index - 1],
        `after step ${step}: segment ${index} stands where segment ${index - 1} stood`,
      );
    }
  }
});
