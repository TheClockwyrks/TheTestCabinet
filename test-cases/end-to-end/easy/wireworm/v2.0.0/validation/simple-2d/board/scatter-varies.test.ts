// Wireworm — board/scatter-varies: the starting scatter is a draw, not a layout.
//
// specs/nodes.md: "Each node is laid on a tile drawn uniformly from the scatter
// rows' tiles not yet holding one, so a run's starting field is a fresh scatter
// rather than one fixed layout, and two runs lay different fields." The whole
// board is the level in Wireworm — one field, twelve levels played over it — so
// a build that shipped one hand-placed layout would ship one game, played the
// same way every time.
//
// The reading is the SYMMETRIC DIFFERENCE of the two fields' occupied tiles: the
// tiles one run laid a node on and the other did not, either way round. What is
// asked of it is what the file states and nothing more — two runs opened afresh
// lay DIFFERENT fields, so some tile is held by one and not the other. A build
// that laid the same layout twice measures `0`. HOW FAR two draws diverge is not
// a figure the file fixes, so no share of the tiles is asserted.
//
// THE READING IS A DRAW, AND THE DRAW CANNOT FAIL A CONFORMING BUILD. Two
// uniform draws of at least 68 tiles out of 680 land on the same set with a
// probability far below anything a run could ever see, so a build that draws as
// the file states never fails here on chance, and a build that lays one layout
// never passes. Several pairs, because a build could differ on one pair by
// accident and be fixed everywhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { occupied, openRun } from "./scatter";

/** The pairs of runs the comparison is read over. */
const PAIRS = [1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(PAIRS)(
  "lays different fields on two fresh runs, pair %i",
  async (pair) => {
    const before = occupied(await openRun(h));
    // The second run is the one the still shows, so it is opened last.
    const after = occupied(await openRun(h));
    captureStill(h, "scatter");

    assertGreaterThan(
      before.size,
      0,
      `the first run of pair ${pair} lays a starting scatter (specs/nodes.md)`,
    );
    assertGreaterThan(
      after.size,
      0,
      `the second run of pair ${pair} lays a starting scatter (specs/nodes.md)`,
    );

    const differing =
      [...before].filter((tile) => !after.has(tile)).length +
      [...after].filter((tile) => !before.has(tile)).length;
    assertGreaterThan(
      differing,
      0,
      `tiles occupied by one of the two scatters and not the other, over pair ` +
        `${pair} (specs/nodes.md: two runs lay different fields); the two runs ` +
        `occupied ${before.size} and ${after.size} tiles`,
    );
  },
);
