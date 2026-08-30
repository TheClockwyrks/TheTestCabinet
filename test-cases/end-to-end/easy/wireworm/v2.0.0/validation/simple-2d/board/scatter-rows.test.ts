// Wireworm — board/scatter-rows: the starting scatter keeps out of the entry row
// and out of the player band.
//
// specs/nodes.md states the rule and specs/board.md says why each end of it
// matters: "No node is laid in row `0`, which the worm enters along, and none in
// the player band, rows `18` and `19`." Row `0` is the entry row a level's worm
// arrives along, so a node laid there is something the worm is blocked by before
// it has taken a step; rows `18` and `19` are the band the cursor is confined to,
// so a node laid there stands inside the player.
//
// Every node of the field is held against the scatter rows, `SCATTER_TOP_ROW`
// (`1`) to `SCATTER_BOTTOM_ROW` (`17`) inclusive, which is exactly the board's
// twenty rows less the entry row and the two band rows. How many nodes there are
// is `board/scatter-density`'s requirement and is not read here; that a field was
// laid at all is, because a run that laid none could not be said to have kept out
// of anything.
//
// Read over three seeds, each its own case, so a failure names the draw that
// strayed.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_TOP_ROW,
  ROWS,
  SCATTER_BOTTOM_ROW,
  SCATTER_TOP_ROW,
} from "../../src/constants";
import { assertBetween, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SEEDS, openRun } from "./scatter";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SEEDS)(
  "lays no node in row 0 and none in the band on seed %i",
  async (seed) => {
    const snapshot = await openRun(h, seed);
    if (seed === SEEDS[0]) captureStill(h, "scatter");

    assertGreaterThan(
      snapshot.nodes.length,
      0,
      `a run opened on seed ${seed} lays a starting scatter (specs/nodes.md)`,
    );

    for (const node of snapshot.nodes) {
      assertBetween(
        node.r,
        SCATTER_TOP_ROW,
        SCATTER_BOTTOM_ROW,
        `the row of the scattered node on tile (${node.c}, ${node.r}), seed ` +
          `${seed} — the scatter rows are ${SCATTER_TOP_ROW}..` +
          `${SCATTER_BOTTOM_ROW}, never row 0, which the worm enters along, ` +
          `and never the band, rows ${BAND_TOP_ROW}..${ROWS - 1}`,
      );
    }
  },
);
