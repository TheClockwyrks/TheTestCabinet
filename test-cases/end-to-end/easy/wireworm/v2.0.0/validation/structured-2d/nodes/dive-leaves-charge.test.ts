// Wireworm — nodes/dive-leaves-charge: a dive leaves the nodes it passes through
// exactly as they were.
//
// specs/worm.md, "Diving": "While a worm is diving, each step advances the head
// one tile down its own column, to `(c, r + 1)`, whatever stands on the tile it
// enters. The tile's node or segment is left exactly as it was." specs/nodes.md
// says the same from the field's side: "a worm dropping or diving into a tile a
// node stands on leaves that node's charge exactly as it was."
//
// The dive is posed directly, with `setWormDiving`, rather than reached by
// charging a node to critical and blocking into it: what STARTS a dive is
// `worm.dive-starts-on-critical`'s requirement, and posing the flag reaches this
// requirement without passing through that one.
//
// Every node is posed at charge `2`, which is the one value from which each wrong
// model reads as a different number: left alone reads `2`, charged as though the
// dive were a block reads `3`, replaced by a fresh inert node reads `0`, cleared
// or detonated reads absent.
//
// One node is posed BESIDE the head as well as beneath it, on the tile the
// worm's horizontal heading points at. A build that ignores `diving` and winds
// instead is blocked by that node and charges it to `3`, so this point reaches a
// real verdict against that build rather than passing on three tiles its worm
// never went near.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, wormStepInterval } from "../constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The column the dive runs down, and the row the head starts on. */
const COL = 10;
const START_R = 8;

/** How many steps the dive is run for, one tile each. */
const STEPS = 3;

/** The rows the head passes into, one per step, all of them above the band. */
const PASSED = [START_R + 1, START_R + 2, START_R + 3];

/** The tile beside the head, which a worm that wound instead would be blocked by. */
const BESIDE_C = COL + 1;

/** Charged: the one value from which every wrong answer reads differently. */
const POSED = 2;

/**
 * Seconds run, so exactly `STEPS` steps happen and no further one does. At level
 * 1 the interval is `WORM_STEP_L1` (`0.14` s, specs/worm.md), so three and a half
 * of it is past the third step and short of the fourth.
 */
const THREE_STEPS = wormStepInterval(1) * (STEPS + 0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every charge-2 node the dive passed through at charge 2", async () => {
  // The dive ends at the end of the step in which the head reaches the band
  // (specs/worm.md), so every row it is run across is above it.
  assertLessThan(
    PASSED[PASSED.length - 1],
    BAND_TOP_ROW,
    "the dive runs above the player band",
  );

  startPlaying(h);
  for (const r of PASSED) h.debug.setNode(COL, r, POSED);
  h.debug.setNode(BESIDE_C, START_R, POSED);

  const worm = poseWorm(h, COL, START_R, 1, 1, 1);
  h.debug.setWormDiving(worm, true);

  await h.advanceSeconds(THREE_STEPS);
  captureStill(h, "dived");

  const after = h.snapshot();
  for (const r of PASSED) {
    assertEqual(
      chargeAt(after, COL, r),
      POSED,
      `the charge on tile (${COL}, ${r}), which the dive passed down through`,
    );
  }
  assertEqual(
    chargeAt(after, BESIDE_C, START_R),
    POSED,
    `the charge on tile (${BESIDE_C}, ${START_R}), which the dive went past`,
  );
});
