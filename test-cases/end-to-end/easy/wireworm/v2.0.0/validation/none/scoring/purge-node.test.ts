// scoring/purge-node — a discharge pays 5 for every node it clears.
//
// `specs/scoring.md`'s table: "A discharge removes a node" pays
// `SCORE_PURGE_NODE` (`5`), and the paragraph under it: the figure is paid "for
// every node a discharge removes, the node the bolt detonated included". Six
// nodes therefore pay `30`, which is what this point reads.
//
// THE BOARD CARRIES NO WORM AT ALL, which is what makes the reading the purge
// figure and nothing else. `SCORE_FRY` is paid per segment a discharge destroys
// (`scoring.fried-segment`), and a board with no segments on it can pay none of
// it, so the whole of the score's movement here is the purge. Nothing else is on
// the board either: no foe, and no seventh node.
//
// EVERY NODE OF THE CLUSTER IS A NEIGHBOUR OF THE STRUCK ONE, AND EVERY ONE IS
// CRITICAL. Both are deliberate, and both are about keeping this point's verdict
// on the FIGURE rather than on the chain rule that carries the discharge from one
// node to the next:
//
//   - The five stand at a Chebyshev distance of `1` from the struck node, well
//     inside `DISCHARGE_RADIUS` (`2`), so the whole cluster is reached in the
//     chain's first wave and a build whose reach is short still clears all six.
//   - Each is at `CHARGE_MAX`, so a build that conducts only through critical
//     nodes rather than through every node "at charge `1` or above"
//     (`specs/discharge.md`) still clears all six.
//
// What `discharge.chain-reaches` and `discharge.chain-propagates` grade is graded
// there; a build that fails them can still pay correctly here, and should.
//
// The tile directly below the struck node is left empty, because that is where
// the bolt starts its climb.
//
// WHAT EVERY WRONG MODEL READS. A build that pays the figure once per discharge
// rather than once per node reads `5`; one that pays for every node but the
// struck one reads `25`; one that pays the inert-node figure reads `6`; one that
// pays nothing reads `0`. Each is a different number from `30`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHARGE_MAX, SCORE_PURGE_NODE } from "../constants";
import {
  captureStill,
  createHarness,
  poseNodes,
  startPlaying,
  type Harness,
} from "../harness";
import { detonateAt } from "./payment";

/** The critical node the bolt is fired into, which detonates the cluster. */
const STRUCK = { c: 10, r: 8 };

/**
 * The five nodes around it, every one a Chebyshev neighbour of the struck tile.
 *
 * The tile directly below the struck one, `(10, 9)`, is deliberately not among
 * them: it is where the bolt is posed, and a node standing there would be the one
 * the shot resolved against.
 */
const CLUSTER: readonly (readonly [number, number, number])[] = [
  [9, 7, CHARGE_MAX],
  [10, 7, CHARGE_MAX],
  [11, 7, CHARGE_MAX],
  [9, 8, CHARGE_MAX],
  [11, 8, CHARGE_MAX],
];

/** The nodes the discharge clears: the five above, and the struck one. */
const PURGED = CLUSTER.length + 1;

/**
 * What the discharge must pay, to the point: `5` for each of the six nodes.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = PURGED * SCORE_PURGE_NODE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 5 for each of the six nodes a discharge clears", async () => {
  await startPlaying(h);
  await poseNodes(h, CLUSTER);

  const before = (await h.snapshot()).score;
  await detonateAt(h, STRUCK.c, STRUCK.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points a discharge clearing six nodes paid",
  );
});
