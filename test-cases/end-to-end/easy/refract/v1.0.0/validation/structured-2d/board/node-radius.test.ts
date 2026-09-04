// Refract — board/node-radius: every node's silhouette fits inside NODE_R of
// its cell center.
//
// specs/board.md gives NODE_R (30) one job: "A node's silhouette is drawn
// inside this radius of its cell center", so neighboring nodes, a full
// CELL_PITCH (96) apart, never collide. Item 4 of "Presentation is yours"
// repeats that bound, grants the build everything a node draws AROUND the
// silhouette — "a halo, a backing, or a highlight" — out to CELL_PITCH / 2
// (48), and then says exactly how loud that may be: "everywhere outside NODE_R
// it stays faint: less than halfway from the background it is drawn on to the
// strongest color the silhouette shows against that background".
//
// THAT SENTENCE IS WHAT MAKES THIS ITEM DECIDABLE off rendered pixels, and it
// is read literally. The BODY MASK (board/pixels) binarizes a disc against the
// board's own ground at exactly that halfway line, so it is the specification's
// own words that say which pixels are silhouette and which are ornament. The
// reading is in two steps:
//
//   1. the SILHOUETTE's own disc, of radius NODE_R, gives the line — "the
//      strongest color the silhouette shows against that background", halved;
//   2. everything the node draws, out to CELL_PITCH / 2, is binarized at THAT
//      line, and nothing above it may sit farther from the center than NODE_R
//      and the tolerance the next paragraph derives.
//
// Taking the line off the inner disc rather than off the wide one is what makes
// step 2 mean anything: a build that drew a loud backing out at 40 would
// otherwise set the line with the backing itself, doubling it, and hide the
// very thing the clause forbids.
//
// THE TOLERANCE IS DERIVED FROM THE SPECIFICATION, NOT FROM THIS CASE'S BUILDS.
// What specs/board.md bounds at NODE_R is the SILHOUETTE — "the form that
// carries the node's kind and its channel" — and it leaves how that form is
// inked to the build. A shape whose path is drawn to the stated radius and then
// stroked puts half the stroke's width outside the radius before a single point
// of the form is misplaced, so the reading has to admit half a stroke.
//
// The specification bounds the stroke too, in item 2: "an emitter reads as
// outlined against a lens's fill". An outline wide enough to fill the form is
// not an outline any more. The three pinned silhouettes drawn to NODE_R all
// enclose the disc of radius NODE_R / 2 (15) — the incircle of the inscribed
// triangle, the smallest of the three interiors. That is the disc
// board/emitter-versus-lens reads fill against outline over, taken there on
// each node's OWN reach rather than on NODE_R, since the specification fixes no
// minimum size; a form drawn to the full radius, which is the widest stroke
// this bound has to admit, gives the same 15. Three stroke bands tangent to a
// disc of radius 15 cover half of it at a width of about 13 px, so a stroke at
// or past 13 px reads as a fill and breaks item 2. Half of that is 6.5 px, and
// the bound is taken at the whole number below it: NODE_R + 6. The binarized
// edge, about a pixel, sits inside that rounding.
//
// The same allowance is given to a crystal, whose form item 2 says nothing
// about, because specs/board.md gives one radius to all three kinds and no
// reason to read one of them more strictly than the others.
//
// A form genuinely drawn too large clears the bound anyway. What this reading
// catches is a path whose own corners sit past the radius, which no stroke
// width consistent with item 2 explains.
//
// One node of each kind is read, because the three kinds carry three different
// drawings — an outline, a fill, and a crystal's charge readout — and each has
// to stay inside the radius on its own. Each sits on a legal board
// (specs/board.md: every channel present has exactly two emitters) with the
// read node two full cells from its nearest neighbour, so the wide region
// reaches no neighbouring node's drawing, and each board carries an empty cell
// for the ground sample.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { CELL_PITCH, cellCenter, NODE_R } from "../notation";
import { bodyArea, bodyMask, bodyReach, groundSample } from "./pixels";

/** The three kinds, each posed on a legal board with an empty cell to read
 * the ground from, the read node — the leftmost, at (0, 0) — two full cells
 * from its nearest neighbour. */
const READ_NODES = [
  { name: "an emitter", notation: "T.T" },
  { name: "a lens", notation: "t.T.T" },
  { name: "a 3-charge crystal", notation: "3.T.T" },
];

/** The disc the silhouette's own reading is taken over: the bound
 * specs/board.md states for it, and no more. */
const SILHOUETTE_R = NODE_R;

/** The disc everything the node draws is read over: the whole of what
 * specs/board.md item 4 lets a node put around its silhouette. */
const REGION_R = CELL_PITCH / 2;

/** The bound the body may reach: the stated radius plus half the widest
 * stroke the specification's own outline-against-fill requirement allows. */
const REACH_MAX = NODE_R + 6;

/** The node the still is captured on: the kind whose drawing carries the most. */
const CAPTURED = "3.T.T";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it.each(READ_NODES)(
  "keeps $name inside NODE_R of its cell center",
  async ({ name, notation }) => {
    const board = await loadBoard(h, notation);
    if (notation === CAPTURED) captureStill(h, "node");

    const ground = groundSample(h, board);
    const center = cellCenter(0, 0, board.cols, board.rows);
    // The silhouette's own disc first: the strongest color it shows against the
    // ground is what specs/board.md measures faintness from, so it sets the
    // line the whole of the node's drawing is then binarized at.
    const silhouette = bodyMask(h, center.x, center.y, SILHOUETTE_R, ground);
    assertGreaterThan(
      bodyArea(silhouette),
      0,
      `precondition: ${name} draws a form about its cell center`,
    );
    const drawn = bodyMask(
      h,
      center.x,
      center.y,
      REGION_R,
      ground,
      silhouette.cut,
    );
    assertLessThanOrEqual(
      bodyReach(drawn),
      REACH_MAX,
      `${name}: the farthest pixel of its drawing that is not faint, from ` +
        `the cell center (${center.x}, ${center.y})`,
    );
  },
);
