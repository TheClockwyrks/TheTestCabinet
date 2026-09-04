// cursor/bolt-stops-at-node — a bolt is consumed by the FIRST node in its
// column and never reaches the second.
//
// specs/cursor.md: a climbing bolt "resolves against the first thing its center
// reaches, which is the lowest of the following that lies above it in its
// column", a node among them, and "a bolt resolves against exactly one thing and
// is removed from flight in the same update". specs/nodes.md fixes what that
// does to an inert node: charge `0` struck means "the node is removed and its
// tile is left empty".
//
// THE NODE FURTHER UP IS POSED AT CHARGE 2, NOT INERT, SO EVERY WRONG MODEL
// READS AS A DIFFERENT NUMBER. Untouched it reads 2. A bolt that passed through
// the first node and struck this one knocks it to 1 (specs/nodes.md). A bolt
// that clears whatever it passes leaves the tile empty. Each failure therefore
// names which wrong model the build implemented rather than merely that
// something was wrong.
//
// The board is empty but for the two nodes, so nothing else in the column can
// take the shot, and the bolt is posed with `addBolt` below both of them: what a
// fired bolt does before it climbs belongs to the firing points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the shot goes up. Any column will do; the board is empty. */
const COLUMN = 20;

/** The inert node the bolt is required to be consumed by. */
const TARGET_ROW = 10;

/**
 * The node further up the same column, and the charge it is posed at.
 *
 * Charge 2 is the distinguishing pose: it is neither the charge a struck node
 * would be left at (1) nor the empty tile an over-clearing build would leave.
 */
const WITNESS_ROW = 5;
const WITNESS_CHARGE = 2;

/** The row the bolt starts on, below both nodes. */
const START_ROW = 14;

/**
 * How long the sweep waits for the bolt to leave flight, in frames.
 *
 * Two seconds. At `BOLT_SPEED` (900) a bolt crosses the whole 640-unit board in
 * 0.71 s, so this is generous enough that a build whose bolt climbs slower than
 * the specified rate still resolves inside it — the rate is
 * `cursor.bolt-travels-up`'s requirement, not this one.
 */
const SWEEP_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the first node, leaves the one above it, and is gone", async () => {
  startPlaying(h);
  h.debug.setNode(COLUMN, TARGET_ROW, 0);
  h.debug.setNode(COLUMN, WITNESS_ROW, WITNESS_CHARGE);
  poseBoltAtTile(h, COLUMN, START_ROW);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: SWEEP_TICKS,
  });
  captureStill(h, "consumed");

  assertEqual(swept.hit, true, "the bolt leaves flight");
  assertNull(
    chargeAt(swept.snapshot, COLUMN, TARGET_ROW),
    `the inert node on (${COLUMN}, ${TARGET_ROW}) is removed`,
  );
  assertEqual(
    chargeAt(swept.snapshot, COLUMN, WITNESS_ROW),
    WITNESS_CHARGE,
    `the node on (${COLUMN}, ${WITNESS_ROW}) is untouched`,
  );
});
