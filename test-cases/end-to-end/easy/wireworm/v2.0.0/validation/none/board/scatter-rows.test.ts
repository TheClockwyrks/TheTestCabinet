// Wireworm — board/scatter-rows: the starting scatter keeps out of the entry row
// and out of the player band.
//
// specs/nodes.md, The starting field: "No node is laid in row `0`, which the
// worm enters along, and none in the player band, rows `18` and `19`." Those are
// the two rows the rest of the game depends on being clear — specs/worm.md has
// the level's worm enter along row 0, and specs/board.md gives rows 18 and 19 to
// the cursor — so a scatter that reaches either changes the game rather than the
// picture.
//
// The run is opened the way a player opens one, through `DESCEND` on the title
// (specs/ui.md), because that is the path that lays the field. The board is read
// on the frame the run opens, while the level's banner is still up, so nothing
// has entered and nothing has spawned: every node standing is a node the scatter
// laid.
//
// Several runs, because the tiles are a draw: a build that clamps its row on one
// draw and not the next has a wrong rule, and each run opened afresh is one draw
// of the same rule. HOW MANY nodes are laid is
// board/scatter-density's requirement; the count is read here only far enough to
// know a scatter happened at all, since a run that laid nothing would satisfy
// every row rule by laying no rows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BAND_TOP_ROW, ENTRY_ROW, ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
} from "../harness";

/** The runs the scatter is read over. Each is one draw of the same rule. */
const RUNS = [1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it.each(RUNS)(
  "keeps the entry row and the band clear on run %i",
  async (run) => {
    await startRunFromTitle(h);
    await captureStill(h, "scatter");

    const { nodes } = await h.snapshot();
    assertGreaterThan(
      nodes.length,
      0,
      `a starting scatter to read, on run ${run} (specs/nodes.md)`,
    );

    const inEntryRow = nodes.filter((node) => node.r === ENTRY_ROW);
    assertEqual(
      inEntryRow.length,
      0,
      `nodes laid in the entry row, row ${ENTRY_ROW}, on run ${run}`,
    );

    const inBand = nodes.filter((node) => node.r >= BAND_TOP_ROW);
    assertEqual(
      inBand.length,
      0,
      `nodes laid in the player band, rows ${BAND_TOP_ROW}..${ROWS - 1}, ` +
        `on run ${run}`,
    );
  },
);
