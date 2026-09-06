// Wireworm — board/scatter-varies: the starting scatter is not one fixed layout.
//
// specs/nodes.md, The starting field: "Each node is laid on a tile drawn
// uniformly from the scatter rows' tiles not yet holding one, so a run's
// starting field is a fresh scatter rather than one fixed layout, and two runs
// lay different fields." That is what makes a run its own board rather than a
// level to be memorised, and it is the one property a hard-coded layout cannot
// fake.
//
// So two runs are opened afresh, each the way a player opens one — `DESCEND` on
// the title (specs/ui.md) — and the two fields are compared as SETS OF TILES.
// What is asked of them is what specs/nodes.md states and nothing more: the two
// runs lay DIFFERENT fields, so some tile is occupied by one scatter and not the
// other. A build with one fixed layout lays the same set twice and fails
// outright. HOW FAR the two draws diverge is not a figure the file fixes, so no
// share of the tiles is asserted.
//
// THE READING IS A DRAW, AND THE DRAW CANNOT FAIL A CONFORMING BUILD. Two
// uniform draws of at least 68 tiles out of 680 land on the same set with a
// probability far below anything a run could ever see, so a build that draws as
// the file states never fails here on chance, and a build that lays one layout
// never passes. Several pairs, because a build could differ on one pair by
// accident and be fixed everywhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The pairs of runs the comparison is read over. */
const PAIRS = [1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** The tiles a scatter occupies, as `"c,r"` keys. */
function occupied(snapshot: WirewormSnapshot): Set<string> {
  return new Set(snapshot.nodes.map((node) => `${node.c},${node.r}`));
}

/** A fresh run, and the field it opened with. */
async function scatterOfFreshRun(): Promise<Set<string>> {
  await startRunFromTitle(h);
  await captureStill(h, "scatter");
  return occupied(await h.snapshot());
}

it.each(PAIRS)(
  "lays different fields on two fresh runs, pair %i",
  async (pair) => {
    // The second run is the one the still shows, so it is opened last.
    const before = await scatterOfFreshRun();
    const after = await scatterOfFreshRun();

    assertGreaterThan(
      before.size,
      0,
      `a starting scatter to read, from the first run of pair ${pair} ` +
        `(specs/nodes.md)`,
    );
    assertGreaterThan(
      after.size,
      0,
      `a starting scatter to read, from the second run of pair ${pair} ` +
        `(specs/nodes.md)`,
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
