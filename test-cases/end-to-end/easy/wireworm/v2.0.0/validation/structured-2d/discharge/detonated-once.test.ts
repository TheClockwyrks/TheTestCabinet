// discharge/detonated-once — a node is detonated at most once per discharge.
//
// specs/discharge.md, step 4, states it flatly: "A node is detonated at most once
// per discharge." The witness is the arc list, because step 2 makes a detonating
// node arc "to every node at charge `1` or above that is standing at that moment"
// within its reach: a node detonated a second time emits its links a second time,
// so an ordered `{ from, to }` pair appearing twice in the reported `arcs` is
// exactly the evidence of a double detonation. Nothing here reads the score, which
// is scoring.purge-node's own requirement.
//
// The board is the dense case the rule exists for, and it is deliberately DEEP as
// well as wide. A solid block of charged nodes seven columns across and eight rows
// deep sits above the critical node, so every node in it lies inside the `5 x 5`
// block of several of its neighbors, and the chain takes four waves to cross it.
// Depth is what makes the reading bite: a node several nodes of the wave before it
// all reached is detonated once for each of them on a build that does not hold to
// this rule, and each of those detonations arcs onward to the nodes still standing
// beyond it — the same ordered pairs, over again. A shallow cluster would let such
// a build off, because a node re-detonated once nothing is left beyond it emits no
// link the second time.
//
// The reading is on the pairs and not on their count: how many arcs a chain
// reports is discharge/arcs-reported's requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  startPlaying,
  type ArcSnapshot,
  type Harness,
} from "../harness";
import { detonate } from "./detonation";

/**
 * The dense cluster: every tile of a five-by-four block, all charged, so each node
 * stands within `DISCHARGE_RADIUS` (`2`) of most of the others and is reached by
 * several of them at once.
 */
const CLUSTER_COLUMNS = [9, 10, 11, 12, 13, 14, 15];
const CLUSTER_ROWS = [4, 5, 6, 7, 8, 9, 10, 11];

/** The charge each node of the cluster is posed at: the lowest the chain conducts to. */
const CLUSTER_CHARGE = 1;

/**
 * The critical node, one row below the block and centred under it, so the chain
 * enters the block along its bottom row and floods outward from there. The column
 * below it is empty, so the bolt reaches this node and no other.
 */
const STRUCK = { c: 12, r: 12 };

/** One arc as a comparable key: the ordered pair of tiles it names. */
function linkKey(arc: ArcSnapshot): string {
  return `${arc.from.c},${arc.from.r} -> ${arc.to.c},${arc.to.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no link twice across a dense cluster's chain", async () => {
  startPlaying(h);
  for (const r of CLUSTER_ROWS) {
    for (const c of CLUSTER_COLUMNS) h.debug.setNode(c, r, CLUSTER_CHARGE);
  }

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "cluster");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertGreaterThan(
    after.arcs.length,
    0,
    "precondition: the chain reported the links it conducted along",
  );

  const links = after.arcs.map(linkKey);
  assertEqual(
    new Set(links).size,
    links.length,
    "distinct { from, to } pairs among the arcs the discharge reported",
  );
});
