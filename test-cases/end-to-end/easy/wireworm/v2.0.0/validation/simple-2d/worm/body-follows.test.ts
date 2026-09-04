// worm/body-follows — each segment moves into the tile the segment ahead of it
// held before the step.
//
// specs/worm.md, "The body follows": "Every step, once the head has moved, each
// remaining segment moves into the tile the segment ahead of it occupied before
// that step. The chain therefore travels the head's exact path, one tile behind
// the segment ahead of it."
//
// WHAT IS ASSERTED IS THE FOLLOW RELATION, NOT A PATH. The check reads the worm
// before each step and again after it, and holds every trailing segment against
// the tile its predecessor stood on going in. That is the rule as the spec writes
// it, and it says nothing about where the head went — which is
// `worm.winds-horizontal`'s requirement — so a build that winds correctly and
// drags its body wrongly fails here alone, and a build whose head goes somewhere
// unexpected is still graded on whether the chain followed it.
//
// THE WORLD IS ONE SIX-SEGMENT WORM ON A CLEAR ROW. `startPlaying` leaves the
// board empty and the three world gates shut, and the worm is posed along a clear
// row with its whole body behind it, columns `5` to `10`, so five steps carry the
// head to column `15` without meeting an edge, a node or another segment. Both
// faculties are left on, because the body's follow IS this requirement.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
  type UntilResult,
  type WormSnapshot,
} from "../harness";

/** Where the head is posed, with the body laid out behind it to column 5. */
const START_C = 10;
const START_R = 5;

/** Segments the worm carries. */
const LENGTH = 6;

/** Steps driven. Five carries the head to column 15, still clear of the edge. */
const STEPS = 5;

/** How long one step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves every segment into the tile the one ahead of it held", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, LENGTH, 1, 1);

  /** The worm going into each step, and what the board looked like after it. */
  const steps: { before: WormSnapshot; swept: UntilResult }[] = [];

  await captureReplay(h, "body", async () => {
    let before = wormOf(h.snapshot(), id);
    for (let step = 1; step <= STEPS; step += 1) {
      const from = before.segments[0];
      // Every step is swept for even after one has failed, so the record holds an
      // entry per step and the failure reported is the FIRST step that went wrong.
      const swept = await h.until(
        (s) => {
          const worm = s.worms.find((held) => held.id === id);
          if (worm === undefined) return false;
          const head = worm.segments[0];
          return head.c !== from.c || head.r !== from.r;
        },
        { maxFrames: STEP_TIMEOUT, poll: 1 },
      );
      steps.push({ before, swept });
      if (swept.hit) before = wormOf(swept.snapshot, id);
    }
  });

  for (let step = 1; step <= STEPS; step += 1) {
    const { before, swept } = steps[step - 1];
    assertEqual(
      swept.hit,
      true,
      `step ${step}: the head to leave its tile within ${STEP_TIMEOUT} frames`,
    );
    const after = wormOf(swept.snapshot, id);
    assertLength(
      after.segments,
      LENGTH,
      `after step ${step}: the worm's segments, none added and none lost`,
    );
    for (let i = 1; i < LENGTH; i += 1) {
      assertDeepEqual(
        after.segments[i],
        before.segments[i - 1],
        `after step ${step}: segment ${i} on the tile segment ${i - 1} held ` +
          "before the step",
      );
    }
  }
});
