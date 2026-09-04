// Wireworm — board/scatter-density: a new run lays 10–15% of the scatter rows.
//
// specs/nodes.md, The starting field: a new run scatters nodes across rows
// `SCATTER_TOP_ROW` (1) through `SCATTER_BOTTOM_ROW` (17) inclusive, "which hold
// `680` tiles between them", and "the number of nodes laid is between
// `SCATTER_MIN_FRACTION` (`0.10`) and `SCATTER_MAX_FRACTION` (`0.15`) of those
// `680` tiles". Both fractions are exact figures the specification names, so the
// bounds below carry no tolerance of their own: 68 and 102 nodes, both ends in.
//
// The run is opened the way a player opens one, through `DESCEND` on the title
// (specs/ui.md), because that is the path that lays the field — there is no
// operation that starts a run, and the scatter is not something a pose can
// arrange. It is counted on the frame the run opens, while the level's banner is
// still up, so the level's worm has not entered and nothing has spawned.
//
// WHERE the nodes fall is board/scatter-rows' requirement and WHAT charge they
// carry is board/scatter-inert's, so this counts the nodes standing on the
// scatter rows and nothing else: a build that laid the right number in the wrong
// rows fails there, and passing here is the honest reading of its count.
//
// Several seeds, because the count is drawn from the generator: a build whose
// scatter is right on one draw and wrong on the next has a wrong rule, and the
// seeds exercise that one edge the one way.

import { afterEach, beforeEach, it } from "vitest";
import {
  COLS,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
} from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The tiles rows 1..17 hold between them: 17 rows of 40 columns, so 680. */
const SCATTER_TILES = (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1) * COLS;

/** The two ends specs/nodes.md fixes, in nodes: 68 and 102, both ends in. */
const FEWEST = SCATTER_MIN_FRACTION * SCATTER_TILES;
const MOST = SCATTER_MAX_FRACTION * SCATTER_TILES;

/** The seeds the count is read over. Each is one draw of the same rule. */
const SEEDS = [1, 2, 3, 7, 11];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SEEDS)(
  "lays 10-15%% of the scatter rows from seed %i",
  async (seed) => {
    await startRun(h, seed);
    await h.advance(1);
    captureStill(h, "scatter");

    const onScatterRows = h
      .snapshot()
      .nodes.filter(
        (node) => node.r >= SCATTER_TOP_ROW && node.r <= SCATTER_BOTTOM_ROW,
      );

    assertBetween(
      onScatterRows.length,
      FEWEST,
      MOST,
      `nodes on the ${SCATTER_TILES} tiles of rows ` +
        `${SCATTER_TOP_ROW}..${SCATTER_BOTTOM_ROW}, from seed ${seed}`,
    );
  },
);
