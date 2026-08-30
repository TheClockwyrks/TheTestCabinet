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
// Several seeds, because the tiles are drawn from the generator: a build that
// clamps its row on one draw and not the next has a wrong rule, and the seeds
// exercise that one edge the one way. HOW MANY nodes are laid is
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

/** The seeds the scatter is read over. Each is one draw of the same rule. */
const SEEDS = [1, 2, 3, 7, 11];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it.each(SEEDS)(
  "keeps the entry row and the band clear from seed %i",
  async (seed) => {
    await startRunFromTitle(h, { seed });
    await captureStill(h, "scatter");

    const { nodes } = await h.snapshot();
    assertGreaterThan(
      nodes.length,
      0,
      `a starting scatter to read, from seed ${seed} (specs/nodes.md)`,
    );

    const inEntryRow = nodes.filter((node) => node.r === ENTRY_ROW);
    assertEqual(
      inEntryRow.length,
      0,
      `nodes laid in the entry row, row ${ENTRY_ROW}, from seed ${seed}`,
    );

    const inBand = nodes.filter((node) => node.r >= BAND_TOP_ROW);
    assertEqual(
      inBand.length,
      0,
      `nodes laid in the player band, rows ${BAND_TOP_ROW}..${ROWS - 1}, ` +
        `from seed ${seed}`,
    );
  },
);
