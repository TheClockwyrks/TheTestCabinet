// Wireworm — board/scatter-varies: the starting scatter is a draw, not a layout.
//
// specs/nodes.md: "Each node is laid on a tile drawn uniformly from the scatter
// rows' tiles not yet holding one, so a run's starting field is a fresh scatter
// rather than one fixed layout, and two runs lay different fields." The whole
// board is the level in Wireworm — one field, twelve levels played over it — so
// a build that shipped one hand-placed layout would ship one game, played the
// same way every time.
//
// THE READING IS THE SET OF TILES EACH RUN OCCUPIES, over a small sample of
// runs opened afresh. What is asked of it is what the file states and nothing
// more: the runs lay DIFFERENT fields, so at least two of the sampled scatters
// occupy different sets of tiles. A build that laid the same layout every time
// measures one distinct set. HOW FAR two draws diverge is not a figure the file
// fixes, so no share of the tiles is asserted.
//
// THE READING IS A DRAW, AND THE DRAW CANNOT FAIL A CONFORMING BUILD. Three
// uniform draws of at least 68 tiles out of 680 all land on one set with a
// probability far below anything a run could ever see, so a build that draws as
// the file states never fails here on chance, and a build that lays one layout
// never passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { RUNS, occupied, openRun } from "./scatter";

/** The distinct scatters the sample must hold: two, as the file states. */
const DISTINCT_SCATTERS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays at least two distinct fields over three fresh runs", async () => {
  const layouts: string[] = [];
  for (const run of RUNS) {
    const tiles = occupied(await openRun(h));
    assertGreaterThan(
      tiles.size,
      0,
      `run ${run} lays a starting scatter (specs/nodes.md)`,
    );
    layouts.push([...tiles].sort().join(" "));
  }
  // The last run is the one the still shows.
  captureStill(h, "scatter");

  assertGreaterThanOrEqual(
    new Set(layouts).size,
    DISTINCT_SCATTERS,
    `distinct sets of tiles occupied by the starting scatters of ` +
      `${RUNS.length} runs opened afresh (specs/nodes.md: two runs lay ` +
      `different fields)`,
  );
});
