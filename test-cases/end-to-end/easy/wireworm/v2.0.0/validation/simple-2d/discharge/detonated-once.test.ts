// discharge/detonated-once — a node is detonated at most once per discharge.
//
// specs/discharge.md, rule 4 of the chain: "A node is detonated at most once per
// discharge."
//
// THE WITNESS IS THE ARC LIST. A node that detonates "arcs to every node at
// charge `1` or above ... within `DISCHARGE_RADIUS`", so a node detonated a
// second time re-emits its links and the same ordered `{ from, to }` pair appears
// twice. Reading the arcs is what makes this point the DISCHARGE's own surface
// rather than a second reading of the score, which is `scoring.purge-node`'s
// requirement.
//
// THE CLUSTER IS DENSE ON PURPOSE. A solid `CLUSTER_W x CLUSTER_H` block of
// charged nodes at a spacing of one tile puts every node inside the `5 x 5` block
// of several of its neighbours, so a build that pushes a node onto the wave front
// each time a neighbour reaches it — rather than marking it as it first joins —
// re-detonates almost every node of the cluster and emits duplicate links by the
// dozen. On a sparse cluster no node has two routes and the bug is invisible,
// which is why the item names a dense one.
//
// THE STRUCK NODE IS ON THE BLOCK'S BOTTOM EDGE, in the column the bolt climbs,
// because specs/cursor.md resolves a bolt against the FIRST node in its path: a
// critical node with cluster nodes below it in the same column would never be
// reached.
//
// THE READING IS UNIQUENESS AND NOTHING ELSE. How MANY links a chain reports is
// `arcs-reported`'s requirement and is not read here, so a build that reports a
// link set of the wrong size but with no duplicate in it is docked there and not
// twice. That some links were reported at all is the scenario's precondition —
// an empty arc list has no duplicates and would decide nothing.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, DISCHARGE_RADIUS } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  arcKeys,
  captureStill,
  createHarness,
  poseBolt,
  poseField,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The cluster's top-left tile: clear of the entry row, the band and the edges. */
const CLUSTER_C = 10;
const CLUSTER_R = 4;

/**
 * The cluster, `5` tiles by `5`, every node charged and one of them critical.
 *
 * At a spacing of one tile every node lies inside the `5 x 5` blast block of
 * several others, so all `25` are one connected charged cluster and each has many
 * routes into it. The `3` — `CHARGE_MAX`, critical — is on the BOTTOM row, in the
 * column the bolt climbs, so it is the first node the bolt meets.
 */
const CLUSTER = ["11111", "11111", "11111", "11111", "11311"];

/** The critical node's tile, read off the picture above. */
const STRUCK_C = CLUSTER_C + 2;
const STRUCK_R = CLUSTER_R + CLUSTER.length - 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no link twice when the chain floods a dense cluster", async () => {
  startPlaying(h);
  poseField(h, CLUSTER, CLUSTER_C, CLUSTER_R);
  await h.advance(1);
  captureStill(h, "cluster");

  poseBolt(h, STRUCK_C, STRUCK_R + 1);
  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  const links = arcKeys(swept.snapshot);
  assertGreaterThan(
    links.length,
    0,
    "the links the chain reported, which is the scenario's precondition: a " +
      "discharge has to have conducted for a repeat to be visible at all " +
      "(their number is graded by discharge.arcs-reported)",
  );

  // A node detonated a second time re-emits its links, so a duplicated ordered
  // pair is exactly the witness. Every node of the cluster lies inside the
  // DISCHARGE_RADIUS block of several others, so a build that re-detonates
  // duplicates many of them and the two numbers part company plainly.
  assertEqual(
    new Set(links).size,
    links.length,
    `the distinct links among the ${links.length} the chain reported across ` +
      `a ${CLUSTER[0].length} x ${CLUSTER.length} cluster at a reach of ` +
      `${DISCHARGE_RADIUS}`,
  );
});
