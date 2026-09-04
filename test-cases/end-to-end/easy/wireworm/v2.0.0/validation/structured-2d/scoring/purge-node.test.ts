// scoring/purge-node — a discharge pays SCORE_PURGE_NODE for EVERY node it removes.
//
// specs/scoring.md: "A discharge removes a node" pays SCORE_PURGE_NODE (5), and
// the figure is paid "for every node a discharge removes, the node the bolt
// detonated included". Six nodes are posed so that one discharge clears all six,
// which makes every wrong model read as a different number: paying only for the
// struck node reads 5, leaving the struck node out of the count reads 25, paying
// a flat figure per discharge reads 5, and paying nothing reads 0.
//
// All five conductors stand within DISCHARGE_RADIUS (2) tiles of the struck
// node, so the whole cluster goes in the first wave of the chain and this point
// rests on no propagation beyond it; how far a chain carries is
// discharge/chain-propagates' requirement. They are posed at charge 2 rather
// than at 1 or 3, so a build that detonates only critical nodes reads 5 and a
// build that detonates only what a bolt could reach reads 5 as well.
//
// No worm stands on the board. SCORE_FRY is the other figure a discharge pays
// (specs/scoring.md), and with no segment in reach the whole award is the purge.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  SCORE_PURGE_NODE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The critical node the bolt detonates. Row 10 is in the open middle of the
 * board, clear of the entry row 0 and of the player band, rows 18 and 19
 * (specs/board.md).
 */
const STRUCK_COL = 20;
const STRUCK_ROW = 10;

/**
 * The five conductors, each within DISCHARGE_RADIUS (2) tiles of the struck node
 * by the Chebyshev measure specs/discharge.md states, so each is detonated by
 * the struck node itself. None stands in the bolt's column below the struck
 * node, so the bolt resolves against the critical node and nothing else.
 */
const CHARGED_TILES = [
  { c: STRUCK_COL - 2, r: STRUCK_ROW },
  { c: STRUCK_COL - 1, r: STRUCK_ROW },
  { c: STRUCK_COL + 1, r: STRUCK_ROW },
  { c: STRUCK_COL + 2, r: STRUCK_ROW },
  { c: STRUCK_COL - 1, r: STRUCK_ROW - 1 },
] as const;

/**
 * The charge every conductor is posed at: charged, neither inert nor critical,
 * which is the value from which "conducts", "only critical nodes conduct" and
 * "nothing conducts" all read as different scores (specs/nodes.md).
 */
const CONDUCTOR_CHARGE = 2;

/** The six nodes the discharge clears: the struck one and its five conductors. */
const PURGED_NODES = CHARGED_TILES.length + 1;

/** What the discharge owes for the purge alone (specs/scoring.md). */
const EXPECTED_AWARD = SCORE_PURGE_NODE * PURGED_NODES;

/**
 * How long the bolt is given to leave flight.
 *
 * A bolt climbs at BOLT_SPEED (900 units per second) and the board is BOARD_H
 * (640 units) tall (specs/cursor.md, specs/board.md), so one crosses the whole
 * board in 0.71 s. Twice that is the honest ceiling: past it the bolt has struck
 * something or passed the top of the board and gone, and the reading below is
 * taken either way.
 */
const BOLT_LIMIT_FRAMES = 2 * ticksFor(BOARD_H / BOLT_SPEED);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("pays SCORE_PURGE_NODE once for each node the discharge clears", async () => {
  resetTo(harness);
  startPlaying(harness);

  harness.debug.setNode(STRUCK_COL, STRUCK_ROW, CHARGE_MAX);
  for (const tile of CHARGED_TILES) {
    harness.debug.setNode(tile.c, tile.r, CONDUCTOR_CHARGE);
  }

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, STRUCK_COL, STRUCK_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_PURGE_NODE} for each of the ${PURGED_NODES} nodes purged`,
  );
});
