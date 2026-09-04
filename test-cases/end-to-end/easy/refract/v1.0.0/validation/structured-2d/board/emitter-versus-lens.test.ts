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
//   2. the lens is FILLED — its body covers more than half of its own inner
//      disc, the disc of half the reach the drawn form itself has;
//   3. the emitter is OUTLINED — its body covers less than half of its own
//      inner disc, because a stroke only crosses that disc where a fill
//      occupies it.
//
// BOTH FIGURES COME FROM THE SPECIFICATION, not from this case's builds.
//
// THE INNER DISC IS HALF THE NODE'S OWN REACH, not half of NODE_R.
// specs/board.md bounds a silhouette at NODE_R and nowhere says how much of
// that radius it has to use — item 4 anticipates a small crisp form with a
// faint halo around it — so a disc fixed at NODE_R / 2 would fail a build for
// drawing its nodes small, which the specification leaves open. Read against a
// form of reach r, the disc of radius r / 2 is the incircle of the equilateral
// triangle inscribed in that reach, and a square and a diamond inscribed in the
// same circle enclose more than it: it is the smallest interior of the three
// pinned silhouettes at whatever size the build chose. So a FILLED silhouette
// of any channel covers the whole of its own inner disc, and the reading
// charges a build neither for the shape nor for the size it drew. It is a
// no-op for a form drawn to the full radius, whose reach comes back at NODE_R.
//
// The line is one half — the midpoint of "covers its interior, or does not".
// A fill covers the inner disc entirely. An outline covers only where its
// stroke crosses it, and read this way that is a pure ratio of stroke width to
// form size: three bands tangent to a disc of radius r / 2, each of width w,
// cover less than half of it for every w below about 0.87 * r / 2, and a stroke
// that wide on a form 2 * r across is not an outline any more but a fill, which
// is the failure this item exists to catch in the first place. An iris, a
// center pip, a glow, or a socket adds to an emitter's coverage without
// carrying it over the half unless it grows to cover the form's own middle, and
// none of them is forbidden by the specification.
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
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import {
  APART_MIN,
  bodyCoverage,
  bodyMask,
  bodyReach,
  groundSample,
} from "./pixels";

/**
 * Two triangle emitters, an empty cell, and a triangle lens: the outline, the
 * ground both are read against, and the fill, all on one legal board.
 */
const EMITTER_GROUND_LENS = "T.tT";

/** Where the read emitter and the read lens sit on that board. */
const EMITTER_COL = 0;
const LENS_COL = 2;

/** The midpoint of "covers its interior, or does not". */
const FILLED_MIN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("fills a lens and outlines an emitter of the same channel", async () => {
  const board = await loadBoard(h, EMITTER_GROUND_LENS);
  // An emitter and a lens of one channel.
  captureStill(h, "pair");

  const ground = groundSample(h, board);
  const emitterAt = cellCenter(EMITTER_COL, 0, board.cols, board.rows);
  const lensAt = cellCenter(LENS_COL, 0, board.cols, board.rows);
  const emitter = bodyMask(h, emitterAt.x, emitterAt.y, NODE_R, ground);
  const lens = bodyMask(h, lensAt.x, lensAt.y, NODE_R, ground);

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

  // Each node's own inner disc: half the reach the form it drew actually has,
  // which is the incircle of the triangle inscribed in that reach.
  const lensInner = bodyReach(lens) / 2;
  const emitterInner = bodyReach(emitter) / 2;

  // The fill occupies its inner disc; the outline only crosses its own.
  assertGreaterThan(
    bodyCoverage(lens, lensInner),
    FILLED_MIN,
    `the lens's body over its own inner disc, of radius ${lensInner} — half ` +
      "the reach of the form it drew (filled)",
  );
  assertLessThan(
    bodyCoverage(emitter, emitterInner),
    FILLED_MIN,
    `the emitter's body over its own inner disc, of radius ${emitterInner} — ` +
      "half the reach of the form it drew (outlined)",
  );
});
