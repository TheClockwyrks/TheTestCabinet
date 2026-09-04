// Wireworm — board/scatter-density: a new run scatters a tenth to a seventh of
// the scatter rows.
//
// specs/nodes.md fixes the figure and the tiles it is a fraction of: the scatter
// covers rows `SCATTER_TOP_ROW` (`1`) through `SCATTER_BOTTOM_ROW` (`17`)
// inclusive, "which hold `680` tiles between them", and "The number of nodes laid
// is between `SCATTER_MIN_FRACTION` (`0.10`) and `SCATTER_MAX_FRACTION` (`0.15`)
// of those `680` tiles". That is the density the whole game is balanced on: too
// sparse and the worm winds unimpeded and the dropper is drawn in at once; too
// dense and the first discharge takes the board.
//
// The count read is the number of TILES the field occupies, over the whole board
// rather than over the scatter rows alone, because that is what "lays nodes on
// between 10% and 15% of the tiles" counts. Where the run put them is
// `board/scatter-rows`'s requirement, so a build that laid the right number in
// the wrong rows is named by that point and not docked twice here.
//
// Read over three seeds, each its own case, so a failure names the draw that
// missed rather than a build that happened to land on the first one.

import { afterEach, beforeEach, it } from "vitest";
import {
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
} from "../constants";
import { assertBetween } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SCATTER_TILES, SEEDS, occupied, openRun } from "./scatter";

/**
 * The bounds, straight off specs/nodes.md's two fractions and the `680` tiles
 * the scatter rows hold: `0.10 * 680` = `68` and `0.15 * 680` = `102`.
 *
 * Both ends are stated figures, so neither carries slack: a build laying `68`
 * nodes and one laying `102` are both exactly inside the rule, and one laying
 * `67` or `103` is outside it.
 */
const MIN_NODES = SCATTER_MIN_FRACTION * SCATTER_TILES;
const MAX_NODES = SCATTER_MAX_FRACTION * SCATTER_TILES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SEEDS)(
  "scatters 10–15%% of the scatter rows on seed %i",
  async (seed) => {
    const snapshot = await openRun(h, seed);
    if (seed === SEEDS[0]) captureStill(h, "scatter");

    assertBetween(
      occupied(snapshot).size,
      MIN_NODES,
      MAX_NODES,
      `tiles occupied by the starting scatter on seed ${seed}, out of the ` +
        `${SCATTER_TILES} tiles rows ${SCATTER_TOP_ROW}..${SCATTER_BOTTOM_ROW} ` +
        `hold (specs/nodes.md: ` +
        `SCATTER_MIN_FRACTION ${SCATTER_MIN_FRACTION} to SCATTER_MAX_FRACTION ` +
        `${SCATTER_MAX_FRACTION})`,
    );
  },
);
