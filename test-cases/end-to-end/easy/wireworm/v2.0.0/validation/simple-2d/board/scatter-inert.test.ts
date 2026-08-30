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
// nodes has no charge to be wrong about. How many were laid and where is
// `board/scatter-density`'s and `board/scatter-rows`'s.
//
// Read over three seeds, each its own case, so a failure names the draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SEEDS, openRun } from "./scatter";

/** The charge specs/nodes.md lays every scattered node at: inert. */
const SCATTER_CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(SEEDS)("lays every scattered node inert on seed %i", async (seed) => {
  const snapshot = await openRun(h, seed);
  if (seed === SEEDS[0]) captureStill(h, "scatter");

  assertGreaterThan(
    snapshot.nodes.length,
    0,
    `a run opened on seed ${seed} lays a starting scatter (specs/nodes.md)`,
  );

  for (const node of snapshot.nodes) {
    assertEqual(
      node.charge,
      SCATTER_CHARGE,
      `the charge of the scattered node on tile (${node.c}, ${node.r}), seed ` +
        `${seed} (specs/nodes.md: every node of the scatter is laid at ` +
        "charge 0)",
    );
  }
});
