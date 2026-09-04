// worm/winds-horizontal — on a clear row the head advances one tile per step.
//
// specs/worm.md, Winding: each step the head attempts to move one tile
// horizontally, to `(c + dh, r)`. That step is blocked only by the board's
// edge, by a node, or by a worm segment; where none of those stands in the way
// "the head moves to that tile and the worm holds its row and both headings".
//
// THE WORLD THIS POSES. `startPlaying` leaves an empty, quiet board, and the
// only thing added to it is a worm of ONE segment. Nothing can block the step,
// there is no body to follow — that is `worm.body-follows`' requirement — and
// no other entity exists to interfere, so the head's tile after each step is
// decided by the winding rule and by nothing else.
//
// NOTHING HERE MEASURES THE RATE. Each step is WAITED FOR rather than timed:
// the drive runs frames until the head leaves the tile it stood on. A build
// whose interval is wrong is docked by `worm.step-cadence` and by
// `worm.step-quickens`, and this point still reads exactly what it is about —
// where the head went, and how far.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
  type Tile,
  type WormSnapshot,
} from "../harness";

/** Where the head is posed: a clear row, well inside both side edges. */
const START_C = 10;
const START_R = 5;

/** Steps driven. Four carries the head to column 14, far from either edge. */
const STEPS = 4;

/**
 * How long one step may take before the drive gives up, in frames.
 *
 * Level 1's interval is `WORM_STEP_L1` (`0.14` s, specs/worm.md), so four of
 * them is a bound no build stepping on the level's own interval comes near. It
 * is a timeout rather than a tolerance: reaching it means the worm never
 * stepped at all.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the head one tile per step along its heading", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  /** The worm as each step left it, or `undefined` where that step never came. */
  const seen: (WormSnapshot | undefined)[] = [];

  await captureReplay(h, "winding", async () => {
    let from: Tile = { c: START_C, r: START_R };
    for (let step = 1; step <= STEPS; step += 1) {
      const swept = await h.until(
        (s) => wormOn(s, from.c, from.r) === undefined,
        { maxFrames: STEP_TIMEOUT, poll: 1 },
      );
      seen.push(swept.hit ? wormById(swept.snapshot, id) : undefined);
      if (!swept.hit) break;
      from = { c: START_C + step, r: START_R };
    }
  });

  for (let step = 1; step <= STEPS; step += 1) {
    const worm = seen[step - 1];
    assertEqual(
      worm !== undefined,
      true,
      `step ${step} taken within ${STEP_TIMEOUT} frames, and the worm still on the board`,
    );
    assertDeepEqual(
      worm?.segments,
      [{ c: START_C + step, r: START_R }],
      `after step ${step}: the head one tile on, holding its row`,
    );
    assertEqual(worm?.dh, 1, `after step ${step}: dh`);
    assertEqual(worm?.dv, 1, `after step ${step}: dv`);
  }
});
