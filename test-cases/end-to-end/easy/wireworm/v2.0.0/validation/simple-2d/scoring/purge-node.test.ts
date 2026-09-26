// scoring/purge-node — a discharge pays SCORE_PURGE_NODE for EVERY node it removes.
//
// specs/scoring.md: "A discharge removes a node" pays `SCORE_PURGE_NODE` (`5`),
// and the figure is paid "for every node a discharge removes, the node the bolt
// detonated included". Six nodes are posed so that one discharge clears all six,
// which makes every wrong model read as a different number: paying only for the
// struck node reads `5`, leaving the struck node out of the count reads `25`,
// paying a flat figure per discharge reads `5`, and paying nothing reads `0`.
//
// THE WHOLE CLUSTER GOES IN THE FIRST WAVE. All five conductors stand within
// `DISCHARGE_RADIUS` (`2`) tiles of the struck node by the Chebyshev measure
// specs/discharge.md states, so each is detonated by the struck node itself and
// this point rests on no propagation beyond that; how far a chain carries is
// `discharge.chain-propagates`'s requirement.
//
// THE CONDUCTORS ARE POSED CHARGED. Charge `2` is the one value from which
// "conducts", "only critical nodes conduct" and "nothing conducts" all read as
// different scores: a build that detonates only critical nodes reads `5`, and one
// that only ever removes what a bolt could reach reads `5` as well.
//
// NO WORM STANDS ON THE BOARD. `SCORE_FRY` is the other figure a discharge pays
// (specs/scoring.md), and with no segment in reach the whole award is the purge.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CHARGE_MAX, SCORE_PURGE_NODE, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The critical node the bolt detonates.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * cluster alone.
 */
const STRUCK_C = 20;
const STRUCK_R = 10;

/**
 * The five conductors, each within `DISCHARGE_RADIUS` (`2`) tiles of the struck
 * node by the Chebyshev measure specs/discharge.md states.
 *
 * None stands in the bolt's column BELOW the struck node, so specs/cursor.md
 * leaves the critical node as the first thing the bolt's centre reaches.
 */
const CONDUCTOR_TILES = [
  { c: STRUCK_C - 2, r: STRUCK_R },
  { c: STRUCK_C - 1, r: STRUCK_R },
  { c: STRUCK_C + 1, r: STRUCK_R },
  { c: STRUCK_C + 2, r: STRUCK_R },
  { c: STRUCK_C - 1, r: STRUCK_R - 1 },
] as const;

/**
 * The charge each conductor is posed at: charged, neither inert nor critical,
 * which specs/nodes.md makes the value a discharge conducts through and a bolt
 * would only de-energize.
 */
const CONDUCTOR_CHARGE = 2;

/** The six nodes the discharge clears: the struck one and its five conductors. */
const PURGED_NODES = CONDUCTOR_TILES.length + 1;

/** What the discharge owes for the purge alone (specs/scoring.md). */
const EXPECTED_AWARD = SCORE_PURGE_NODE * PURGED_NODES;

/** How far below the critical node the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the node, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the node's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays SCORE_PURGE_NODE once for each node the discharge clears", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  for (const tile of CONDUCTOR_TILES) {
    h.debug.setNode(tile.c, tile.r, CONDUCTOR_CHARGE);
  }

  const before = h.snapshot().score;
  poseBolt(h, STRUCK_C, STRUCK_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_PURGE_NODE} for each of the ${PURGED_NODES} nodes purged`,
  );
});
