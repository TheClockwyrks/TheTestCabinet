// nodes/dive-leaves-charge — a dive leaves every node it passes through as it was.
//
// specs/nodes.md: "a worm dropping or diving into a tile a node stands on leaves
// that node's charge exactly as it was." specs/worm.md states the same rule for
// the dive: "While a worm is diving, each step advances the head one tile down its
// own column, to `(c, r + 1)`, whatever stands on the tile it enters. The tile's
// node or segment is left exactly as it was, and neither turns the worm nor is
// destroyed."
//
// THE DIVE IS REACHED THROUGH THE RULE THAT STARTS ONE. specs/worm.md: "A block by
// a node at charge `3`, the critical charge, starts a dive when the head is above
// the player band." So one critical node sits one tile along the head's heading,
// and the head is posed high above row `BAND_TOP_ROW` (`18`). That node is the
// block, and what a block does to the node that caused it is `nodes.bump-caps`'s
// requirement; it is not read here.
//
// WHAT IS READ is a column of three nodes posed at charge `2`, starting two rows
// below the head, so the dive's own steps — not the row the dive-start step drops
// through, which is `nodes.drop-leaves-charge`'s — are what carries the head into
// them. Charge `2` is the value that separates the wrong models: "left alone" reads
// 2, "bumped" reads 3, "replaced by a fresh inert node" reads 0, and "cleared or
// detonated" reads absent.
//
// THE SPAN IS SIX STEPS, A FIXED COUNT RATHER THAN A SWEEP. Six carries a diving
// head from row 5 to row 11, two rows past the last node under test, and stops far
// short of the band where specs/worm.md ends the dive. It is fixed so that a build
// which never dives cannot wander into the column under test on some later step
// and charge a node there: turned rather than diving, such a head leaves along row
// 6 and is six tiles away when the drive stops. That build fails
// `worm.dive-enters` and `worm.dive-passes-through-node`; this point still reads
// the charges it was posed to read.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, wormStepInterval } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseField,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The worm's head, clear of every edge and well above the player band. */
const WORM_C = 11;
const WORM_R = 5;

/** The critical node the head is blocked by, one tile along its heading. */
const BLOCK_C = WORM_C + 1;

/**
 * The rows of the charged column the dive crosses, and the charge each is posed
 * and read at.
 *
 * They start two rows below the head: the dive-start step takes the head one row
 * down, and every row after that is a step of the dive proper.
 */
const DIVE_ROWS = [WORM_R + 2, WORM_R + 3, WORM_R + 4] as const;
const DIVE_CHARGE = 2;

/**
 * Frames covering exactly six worm steps at level 1.
 *
 * specs/worm.md clocks the worm on `wormStepInterval(level)`, which is `0.14` s at
 * level 1, so six steps are `0.84` s. Rounded up to whole frames of the 120 Hz
 * clock that is 101 frames (`0.8417` s): past six intervals, and well short of the
 * `0.98` s a seventh would need.
 */
const SIX_STEPS_TICKS = ticksFor(6 * wormStepInterval(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the charge-2 nodes a dive passes down through at charge 2", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCK_C, WORM_R, CHARGE_MAX);
  poseField(h, ["2", "2", "2"], WORM_C, DIVE_ROWS[0]);
  poseWorm(h, WORM_C, WORM_R, 1, 1, 1);

  await h.advance(SIX_STEPS_TICKS);
  captureStill(h, "dived");

  const after = h.snapshot();
  for (const r of DIVE_ROWS) {
    assertEqual(
      chargeAt(after, WORM_C, r),
      DIVE_CHARGE,
      `the charge on the node at (${WORM_C}, ${r}) the dive passed through`,
    );
  }
});
