// Wireworm — board/scatter-inert: every node a new run scatters starts inert.
//
// specs/nodes.md: "Every node of the scatter is laid at charge `0`." It is the
// premise the whole charge economy rests on — a run opens with a field that is
// entirely terrain and holds no stored energy, and every charge on the board from
// there was put there by play: the worm's head bumping a node, or a corruptor
// slamming one to critical. A run that opened with charged nodes would hand the
// player a discharge it never earned, and one that opened with a critical node
// would send the worm diving on its first pass down the board.
//
// Charge `0` is the whole reading, so nothing is tolerated around it: charge is a
// whole number in `0..CHARGE_MAX` (specs/nodes.md), and `1` is a different state
// with a different appearance and different consequences.
//
// That a field was laid at all is asserted first, because a run that laid no
// nodes has no charge to be wrong about. Where they were laid is
// `board/scatter-rows`'s; how many is a share of a generated world, which no
// point counts.
//
// Read over three runs, each its own case, so a failure names the draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { RUNS, openRun } from "./scatter";

/** The charge specs/nodes.md lays every scattered node at: inert. */
const SCATTER_CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(RUNS)("lays every scattered node inert on run %i", async (run) => {
  const snapshot = await openRun(h);
  if (run === RUNS[0]) captureStill(h, "scatter");

  assertGreaterThan(
    snapshot.nodes.length,
    0,
    `run ${run} lays a starting scatter (specs/nodes.md)`,
  );

  for (const node of snapshot.nodes) {
    assertEqual(
      node.charge,
      SCATTER_CHARGE,
      `the charge of the scattered node on tile (${node.c}, ${node.r}), run ` +
        `${run} (specs/nodes.md: every node of the scatter is laid at ` +
        "charge 0)",
    );
  }
});
