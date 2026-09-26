// worm/dive-passes-through-node — a diving worm drives down its column through
// whatever stands in it.
//
// specs/worm.md, Diving: "While a worm is diving, each step advances the head
// one tile down its own column, to `(c, r + 1)`, whatever stands on the tile it
// enters. The tile's node or segment is left exactly as it was, and neither
// turns the worm nor is destroyed."
//
// WHAT IS READ, AND WHAT IS NOT. Where the head ended after each step of the
// dive, and only that. What becomes of the nodes it crosses is
// `nodes.dive-leaves-charge`'s requirement, so a build that dives correctly and
// mishandles their charge is docked once, for the thing it got wrong.
//
// THE COLUMN IS POSED WITH CHARGE-`2` NODES, and the value is load-bearing:
// `2` is the only charge from which a node charged on contact (`3`), a node
// replaced by a fresh one (`0`), a node eaten (the tile empty), and a node
// standing untouched all read as different numbers. It also keeps the crossed
// nodes clear of `CHARGE_MAX`, so nothing in the column could start a second
// dive or a detonation.
//
// THE DIVE IS POSED DIRECTLY, with `setWormDiving`, rather than started off a
// critical node. Starting it would put `worm.dive-enters`' requirement in front
// of this one, and a build that never enters a dive would then fail both points
// for one fault. The three crossed rows all sit above `BAND_TOP_ROW`, so the
// dive cannot end part-way through the drive (`worm.dive-ends-at-band`).

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** Where the head is posed, and how many rows of the dive are driven. */
const START_C = 10;
const START_R = 5;
const STEPS = 3;

/** The charge every node in the crossed column carries. */
const NODE_CHARGE = 2;

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

it("ends each diving step one row lower, on the node's own tile", async () => {
  // The drive is only the rule's if the dive runs the whole way to its end.
  assertLessThan(
    START_R + STEPS,
    BAND_TOP_ROW,
    "the last crossed row is above the band",
  );

  startPlaying(h);
  for (let step = 1; step <= STEPS; step += 1) {
    h.debug.setNode(START_C, START_R + step, NODE_CHARGE);
  }
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);
  h.debug.setWormDiving(id, true);

  /** The worm as each step of the dive left it. */
  const seen: (WormSnapshot | undefined)[] = [];
  for (let step = 1; step <= STEPS; step += 1) {
    const from = START_R + step - 1;
    const swept = await h.until((s) => wormOn(s, START_C, from) === undefined, {
      maxFrames: STEP_TIMEOUT,
      poll: 1,
    });
    seen.push(swept.hit ? wormById(swept.snapshot, id) : undefined);
    if (!swept.hit) break;
  }

  captureStill(h, "diving");

  for (let step = 1; step <= STEPS; step += 1) {
    const worm = seen[step - 1];
    assertEqual(
      worm !== undefined,
      true,
      `dive step ${step} taken within ${STEP_TIMEOUT} frames, and the worm still on the board`,
    );
    assertDeepEqual(
      worm?.segments,
      [{ c: START_C, r: START_R + step }],
      `after dive step ${step}: the head on the charge-${NODE_CHARGE} node's tile`,
    );
  }
});
