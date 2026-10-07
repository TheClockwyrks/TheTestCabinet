// Wireworm — board/scatter-varies: the starting scatter is not one fixed layout.
//
// specs/nodes.md, The starting field: "Each node is laid on a tile drawn
// uniformly from the scatter rows' tiles not yet holding one, so a run's
// starting field is a fresh scatter rather than one fixed layout, and two runs
// lay different fields." That is what makes a run its own board rather than a
// level to be memorised, and it is the one property a hard-coded layout cannot
// fake.
//
// So a small sample of runs is opened afresh, each the way a player opens one —
// `DESCEND` on the title (specs/ui.md) — and each field is read as a SET OF
// TILES. What is asked of them is what specs/nodes.md states and nothing more:
// the runs lay DIFFERENT fields, so at least two of the sampled scatters occupy
// different sets of tiles. A build with one fixed layout lays the same set
// every time and fails outright. HOW FAR two draws diverge is not a figure the
// file fixes, so no share of the tiles is asserted.
//
// THE READING IS A DRAW, AND THE DRAW CANNOT FAIL A CONFORMING BUILD. Three
// uniform draws of at least 68 tiles out of 680 all land on one set with a
// probability far below anything a run could ever see, so a build that draws as
// the file states never fails here on chance, and a build that lays one layout
// never passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The runs the scatter is read over. Each is one draw of the same rule. */
const RUNS = [1, 2, 3];

/** The distinct scatters the sample must hold: two, as the file states. */
const DISTINCT_SCATTERS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The tiles a scatter occupies, as `"c,r"` keys. */
function occupied(snapshot: WirewormSnapshot): Set<string> {
  return new Set(snapshot.nodes.map((node) => `${node.c},${node.r}`));
}

it("lays at least two distinct fields over three fresh runs", async () => {
  const layouts: string[] = [];
  for (const run of RUNS) {
    await startRun(h);
    // The last run is the one the still shows.
    captureStill(h, "scatter");
    const tiles = occupied(h.snapshot());
    assertGreaterThan(
      tiles.size,
      0,
      `a starting scatter to read, from run ${run} (specs/nodes.md)`,
    );
    layouts.push([...tiles].sort().join(" "));
  }

  assertGreaterThanOrEqual(
    new Set(layouts).size,
    DISTINCT_SCATTERS,
    `distinct sets of tiles occupied by the starting scatters of ` +
      `${RUNS.length} runs opened afresh (specs/nodes.md: two runs lay ` +
      `different fields)`,
  );
});
