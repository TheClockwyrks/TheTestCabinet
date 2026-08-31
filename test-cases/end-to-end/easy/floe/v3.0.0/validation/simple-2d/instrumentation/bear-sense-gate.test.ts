// instrumentation/bear-sense-gate — `setBearSense(id, false)` gates that bear's
// reading of the critter's tile and nothing else, so it keeps hunting the tile its
// target already held.
//
// specs/instrumentation.md fixes the gate: "Gates that bear's reading of the
// critter's tile alone. Off, it stops refreshing its target and keeps hunting the
// tile the target holds; its routing and its travel run untouched." specs/hunter.md
// fixes what the faculty does when it is on: "A bear's target is the tile the
// critter is on, read afresh every tick."
//
// TWO BEARS, ONE READING EACH, SO THE GRADE IS PRECISE. The bear with its sense off
// must hold the target it was posed with; the bear beside it, with its sense on,
// must report the critter's NEW tile. A build that gates nothing fails on the
// first; a build that has no sense at all fails on the second; a build that gates
// every bear at once fails on the second too. Both are read on the same drive, so
// nothing but the gate separates them.
//
// THE THREE TILES ARE ALL DIFFERENT, WHICH IS WHAT NAMES THE WRONG MODEL. The
// posed target is a tile on the far side of the strait that neither bear stands on
// and the critter never occupies; the critter starts on one tile and is moved four
// tiles along the row to another. So a gated bear that snapped to the critter reads
// the critter's tile, a sensing bear that froze reads the critter's OLD tile, and a
// sensing bear that never sensed at all reads its own tile — three different
// failures, each naming itself.
//
// ONLY THE FACULTY UNDER TEST IS LEFT ON. Both bears are posed with their routing
// and their travel held off, so neither moves and neither chooses a step: what the
// drive changes is the critter's tile and what the reading takes is the target.
// The critter is moved with `setCritterTile` rather than hopped, because how it got
// there is `hopping/*`'s point and not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the critter starts, and the tile four columns along it is moved to. */
const CRITTER_COL = 20;
const CRITTER_ROW = 15;
const MOVED_COL = CRITTER_COL + 4;
const MOVED_ROW = CRITTER_ROW;

/** The two bears: one with its sense gated off, one with it on. */
const GATED_COL = 8;
const GATED_ROW = 15;
const SENSING_COL = 32;
const SENSING_ROW = 15;

/**
 * The tile the gated bear is posed hunting.
 *
 * Deliberately none of the tiles anything else in this scenario occupies — not
 * either bear's, not the critter's before the move and not after it — so a build
 * that refreshed the gated target reads a tile this check can name.
 */
const POSED_TARGET_COL = 5;
const POSED_TARGET_ROW = 4;

/**
 * Seconds of game time the two bears are given to read the moved critter.
 *
 * A quarter of a second is thirty ticks, and specs/hunter.md refreshes a target
 * "afresh every tick", so a build that refreshes at any rate at all has read the
 * new tile many times over by the end of it. Nothing is measured across the span:
 * it is a window, not a rate.
 */
const SETTLE_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated bear's target while the bear beside it follows the critter", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);

  // Neither bear routes and neither travels: the sense is the only faculty this
  // point exercises, and a bear that moved would be reporting another point's.
  const gated = poseBear(h, GATED_COL, GATED_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setBearTarget(gated, POSED_TARGET_COL, POSED_TARGET_ROW);
  const sensing = poseBear(h, SENSING_COL, SENSING_ROW, {
    routing: false,
    travel: false,
  });

  // A first span with the critter where it was posed, so the sensing bear has
  // genuinely read that tile before the move — which is what makes "it reports the
  // NEW tile" a reading of a refresh rather than of a first look.
  await h.advance(ticksFor(SETTLE_SECONDS));
  const settled = h.snapshot();
  assertEqual(
    `${bearOf(settled, sensing).target.col},${bearOf(settled, sensing).target.row}`,
    `${CRITTER_COL},${CRITTER_ROW}`,
    `the tile the sensing bear hunts while the critter stands on ` +
      `(${CRITTER_COL}, ${CRITTER_ROW}) — specs/hunter.md makes a bear's target ` +
      `the tile the critter is on`,
  );

  const moved = await captureReplay(h, "gate", async () => {
    h.debug.setCritterTile(MOVED_COL, MOVED_ROW);
    await h.advance(ticksFor(SETTLE_SECONDS));
    return h.snapshot();
  });

  const held = bearOf(moved, gated);
  assertEqual(
    `${held.target.col},${held.target.row}`,
    `${POSED_TARGET_COL},${POSED_TARGET_ROW}`,
    `the tile the bear with setBearSense(${gated}, false) hunts ` +
      `${SETTLE_SECONDS} s after the critter moved four tiles, against the tile ` +
      `it was posed hunting — with its sense off it "stops refreshing its target ` +
      `and keeps hunting the tile the target holds" (specs/instrumentation.md)`,
  );

  const following = bearOf(moved, sensing);
  assertEqual(
    `${following.target.col},${following.target.row}`,
    `${MOVED_COL},${MOVED_ROW}`,
    `the tile the bear with its sense ON hunts over the same span — the gate is ` +
      `one bear's alone, and specs/hunter.md reads the critter's tile afresh ` +
      `every tick`,
  );
});
