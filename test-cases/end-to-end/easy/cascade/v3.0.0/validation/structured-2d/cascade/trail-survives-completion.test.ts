// cascade/trail-survives-completion — the painted table stays after the cascade.
//
// specs/victory.md: the painted layer "is cleared by a new deal ... and by nothing
// else", and at the end of the cascade "the painted table stays behind that
// message". So the buried table is what a player is left looking at, and a build
// that wipes the layer when the last card retires has thrown away the whole point
// of the ending.
//
// THE SAME POINTS ARE READ TWICE, ONCE NEAR THE END AND ONCE AFTER IT. The stage is
// sampled on a grid before a card has painted anything, again while the last cards
// are still in the air, and a third time once `cascadeDone` is true. A cell counts
// as painted when it has moved from its OWN bare reading, so a build whose felt
// carries a gradient or a texture — which specs/overview.md leaves it free to do —
// reads nothing painted until something paints. What the second reading found
// painted is the set the third is held against, so the table is compared with its
// own earlier self rather than with any coverage figure: the specification fixes
// none, and could not, because what a cascade covers depends on the launch
// velocities its launches drew.
//
// THE CARDS IN FLIGHT ARE TAKEN OUT of the second reading. A card is drawn at its
// position whether or not the build kept a layer at all, so a build that cleared
// the layer every frame would otherwise read its own flyers as paint that ought to
// have survived. By the third reading the flight is empty, so there is nothing to
// exclude.
//
// EVERY PAINTED POINT MUST SURVIVE, WITH NO SHARE AND NO FLOOR. A point the win
// message covers is still not bare felt and still counts: specs/screens.md puts
// `WIN_TEXT` over the painted table, and a message is drawn IN something. So the
// third reading admits no exception, and how far anything reads from anything is
// the reviewer's.
//
// AND `trailStamps` IS READ ALONGSIDE THE PIXELS. specs/state.md counts the stamps
// the layer holds since it was last cleared, and specs/instrumentation.md has only
// `clearTrail()` and `reset()` zero it, so a build that stopped drawing the layer
// while leaving the counter alone is caught by the pixels and a build that quietly
// cleared it is caught by the counter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CARD_H, CARD_W, DECK_SIZE, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  startCascade,
  type Harness,
  type Rgb,
} from "../harness";
import { createRunoutHarness, runoutFrames, sampleGrid } from "./flight";

/** How long the cascade is given to run out, in frames. */
const MAX_FRAMES = runoutFrames(20);

/** The grid the stage is sampled on: 960 cells, evenly spread. */
const GRID_COLS = 40;
const GRID_ROWS = 24;

/** The whole stage, which is the table the fraction is measured over. */
const TABLE = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/** How long the finished table is left standing before it is read again. */
const SETTLE_FRAMES = 60;

/** The middle of grid cell `at`, in logical units. */
function cellCentre(at: number): { x: number; y: number } {
  const row = Math.floor(at / GRID_COLS);
  const col = at % GRID_COLS;
  return {
    x: TABLE.x + (TABLE.w * (col + 0.5)) / GRID_COLS,
    y: TABLE.y + (TABLE.h * (row + 0.5)) / GRID_ROWS,
  };
}

/**
 * Which cells the PAINTED LAYER has covered: painted differently from what that
 * same cell held on the bare table, and not underneath a card in flight.
 *
 * There is no threshold. The case fixes no palette, so how far a stamp reads from
 * the felt is the reviewer's; each cell is compared
 * against itself, so any difference at all is paint.
 */
function paintedCells(
  bare: readonly Rgb[],
  now: readonly Rgb[],
  flyers: readonly { x: number; y: number }[],
): number[] {
  const found: number[] = [];
  for (let at = 0; at < now.length && at < bare.length; at += 1) {
    const point = cellCentre(at);
    const underFlyer = flyers.some(
      (flyer) =>
        point.x >= flyer.x &&
        point.x < flyer.x + CARD_W &&
        point.y >= flyer.y &&
        point.y < flyer.y + CARD_H,
    );
    if (underFlyer) continue;
    if (colorDistance(now[at], bare[at]) > 0) found.push(at);
  }
  return found;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createRunoutHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the table painted once the cascade is done", async () => {
  startCascade(harness);

  // One frame with the painting gated off, so the baseline is the table as the
  // cascade found it: the felt, the foundations, and the first card away. The gate
  // goes straight back on, and every stamp from the second frame onward is the
  // build's own.
  harness.debug.setTrailPainting(false);
  await harness.advance(1);
  const bare = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);
  harness.debug.setTrailPainting(true);

  // Near the end: every card launched and the last of them still in the air.
  const nearly = await harness.until(
    (seen) =>
      seen.cascadeDone ||
      (seen.launched >= DECK_SIZE && seen.flyers.length <= 2),
    { maxFrames: MAX_FRAMES },
  );
  assertEqual(
    nearly.hit,
    true,
    "the cascade to reach its last cards, so there is a painted table to read",
  );
  const flying = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);
  const before = paintedCells(bare, flying, harness.snapshot().flyers);
  assertGreaterThan(
    before.length,
    0,
    "cells of the felt painted by the time the cascade's last cards were in " +
      "the air, once the cards themselves are taken out — a build whose layer " +
      "keeps nothing reads none",
  );

  const finished = await harness.until((seen) => seen.cascadeDone, {
    maxFrames: MAX_FRAMES,
  });
  // Read only once there is a FINISHED table to read. Without this the sweep
  // would simply run out against a build whose cascade never ends, and the
  // reading would be taken somewhere in the middle of one — which is a table
  // this point says nothing about, and a pass this point never meant.
  assertEqual(
    finished.hit,
    true,
    "the cascade to finish, so there is a finished table to read",
  );

  const stamped = harness.snapshot().trailStamps;
  await harness.advance(SETTLE_FRAMES);
  const done = sampleGrid(harness, TABLE, GRID_COLS, GRID_ROWS);
  captureStill(harness, "painted");

  const lost = before.filter(
    (at) => colorDistance(done[at], bare[at]) === 0,
  ).length;
  assertEqual(
    lost,
    0,
    `cells of the ${String(before.length)} the cascade had painted that read ` +
      "as bare felt again once it was done (specs/victory.md: the painted " +
      "table stays behind the win message, and only a new deal clears the " +
      "layer)",
  );

  assertEqual(
    harness.snapshot().trailStamps,
    stamped,
    `snapshot().trailStamps over the ${String(SETTLE_FRAMES)} frames after ` +
      "cascadeDone became true — only clearTrail() and reset() zero it " +
      "(specs/instrumentation.md)",
  );
});
