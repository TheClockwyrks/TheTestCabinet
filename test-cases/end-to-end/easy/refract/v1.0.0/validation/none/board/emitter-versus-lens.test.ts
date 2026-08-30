// Refract — board/emitter-versus-lens: an emitter reads as outlined against a
// lens's fill.
//
// specs/board.md "Nodes": "An emitter and a lens of the same channel share one
// silhouette and differ only by outline against fill", so a player reads a
// node's channel and its role in the same glance. That sentence is the whole
// requirement, and it fixes nothing about what sits at the very center of
// either node. A build may lay an optical iris over a filled silhouette, or a
// lamp pip at an outlined emitter's light source, and both still read outline
// against fill, so the reading is of COVERAGE and not of the center pixel:
//
//   1. both nodes are DRAWN — the loudest pixel within NODE_R (30) of each cell
//      center stands more than 50 of 441 from the board's own ground;
//   2. the lens is FILLED — its body covers more than half of the inner disc of
//      radius NODE_R / 2 (15) about its center;
//   3. the emitter is OUTLINED — its body covers less than half of that same
//      disc, because a stroke only crosses the inner disc where a fill occupies
//      it.
//
// BOTH FIGURES COME FROM THE SPECIFICATION, not from this case's builds.
//
// The inner disc is NODE_R / 2 because that is the largest disc about a cell
// center that lies inside every one of the three silhouettes specs/board.md
// pins, each drawn to NODE_R: an equilateral triangle inscribed in a circle of
// radius R has an incircle of radius R / 2, and a square and a diamond
// inscribed in the same circle enclose more than that. So a FILLED silhouette
// of any channel covers the whole of that disc, and the reading never charges a
// build for the shape it was told to draw.
//
// The line is one half — the midpoint of "covers its interior, or does not".
// A fill covers the inner disc entirely. An outline covers only where its
// stroke crosses it: three bands tangent to a disc of radius 15, each of width
// w, cover less than half of it for every w below about 13 px, and a 13 px
// stroke on a form 60 px across is not an outline any more but a fill, which is
// the failure this item exists to catch in the first place. An iris, a center
// pip, a glow, or a socket adds to an emitter's coverage without carrying it
// over the half, and none of them is forbidden by the specification.
//
// The posed board "T.tT" carries an empty cell, so both readings compare
// against the board's OWN ground: specs/board.md lets an empty cell carry quiet
// background texture, and what a node sits on is that ground, not the bench off
// the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import { APART_MIN, bodyCoverage, bodyMask, groundSample } from "./sampling";

/**
 * Two triangle emitters, an empty cell, and a triangle lens: the outline, the
 * ground both are read against, and the fill, all on one legal board.
 */
const EMITTER_GROUND_LENS = "T.tT";

/** Where the read emitter and the read lens sit on that board. */
const EMITTER_COL = 0;
const LENS_COL = 2;

/** The inner disc a fill occupies and an outline only crosses: the incircle of
 * the triangle inscribed in NODE_R, the smallest interior of the three pinned
 * silhouettes. */
const INNER_R = NODE_R / 2;

/** The midpoint of "covers its interior, or does not". */
const FILLED_MIN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fills a lens and outlines an emitter of the same channel", async () => {
  const board = await loadBoard(h, EMITTER_GROUND_LENS);
  // An emitter and a lens of one channel.
  await captureStill(h, "pair");

  const ground = await groundSample(h, board);
  const emitterAt = cellCenter(EMITTER_COL, 0, board.cols, board.rows);
  const lensAt = cellCenter(LENS_COL, 0, board.cols, board.rows);
  const emitter = await bodyMask(h, emitterAt.x, emitterAt.y, NODE_R, ground);
  const lens = await bodyMask(h, lensAt.x, lensAt.y, NODE_R, ground);

  // Both are drawn at all: the loudest pixel of each form.
  assertGreaterThan(
    emitter.peak,
    APART_MIN,
    "the emitter's loudest pixel within NODE_R of its center (drawn)",
  );
  assertGreaterThan(
    lens.peak,
    APART_MIN,
    "the lens's loudest pixel within NODE_R of its center (drawn)",
  );

  // The fill occupies the inner disc; the outline only crosses it.
  assertGreaterThan(
    bodyCoverage(lens, INNER_R),
    FILLED_MIN,
    `the lens's body over the inner disc of radius ${INNER_R} (filled)`,
  );
  assertLessThan(
    bodyCoverage(emitter, INNER_R),
    FILLED_MIN,
    `the emitter's body over the inner disc of radius ${INNER_R} (outlined)`,
  );
});
