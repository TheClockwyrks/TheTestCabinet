// Automated validation for worm.blocked-by-segment: blocked by a worm segment
// (rather than a node) the worm turns like any block, but charges nothing.
//
// The worm is posed so its own body lies across the row it is winding along, a few
// tiles ahead of the head; the head running into that segment routes through the
// real stepWorm segment-block path (segmentAt), which turns the worm without
// charging anything. The board stays empty of nodes.
//
// The pose is a real winding path, and the tile the turn drops into is EMPTY. Both
// matter, and the previous pose had neither:
//
//   * It curled the worm into a six-tile spiral with its TAIL parked directly ahead
//     of the head. No sequence of legal steps produces that shape — a worm drops one
//     row per turn and only flips its vertical heading at the top or the floor
//     (specs/worm.md), so a body that doubles back over itself inside two adjacent
//     rows cannot have been wound there. The clip showed a scenario the game cannot
//     reach, which is exactly why it was hard to read.
//   * Worse, the tile the head dropped INTO was occupied by the worm's own body, and
//     the body shift then moved another segment onto that same tile: the reference
//     came out of the turn with two segments stacked on one tile. Nothing in the
//     specs says what a worm does when its drop tile is occupied, so the old pose
//     was reading a build's answer to a question this case never asks.
//
// This pose is instead a plain climb-and-flip: the worm climbed to the top row,
// flipped its vertical heading there (specs/worm.md — a drop that would leave the
// board flips it instead), dropped back into row 1 and reversed, so it is now
// winding back across the stretch of row 1 it crossed on the way up. That is how a
// worm meets its own body in ordinary play; the drop tile below is clear; and the
// blocker is a MID-BODY segment rather than the tail, so a build that (defensibly)
// lets a vacating tail be stepped through is not caught out by this item.

import {
  actWormStep,
  actWormToColumn,
  freshBoard,
  head,
  setWorm,
} from "../_helpers.mjs";

// The head walks right along row 1 from column 5 and is blocked at column 11 by the
// segment its earlier pass left there — five tiles of visible run-up.
const HEAD_C = 5;
const BLOCK_C = 11;

// One continuous winding path, head first. Read tail-to-head it is: right along row
// 2, up at column 11, right along row 1 to column 14, up at column 14, left along
// row 0 back to column 5, and down at column 5 (the vertical flip at the top row) —
// after which the head heads right again, into its own row-1 trail.
const SEGMENTS = [
  { c: HEAD_C, r: 1 },
  { c: HEAD_C, r: 0 },
  { c: 6, r: 0 },
  { c: 7, r: 0 },
  { c: 8, r: 0 },
  { c: 9, r: 0 },
  { c: 10, r: 0 },
  { c: 11, r: 0 },
  { c: 12, r: 0 },
  { c: 13, r: 0 },
  { c: 14, r: 0 },
  { c: 14, r: 1 },
  { c: 13, r: 1 },
  { c: 12, r: 1 },
  { c: BLOCK_C, r: 1 },
  { c: 11, r: 2 },
  { c: 12, r: 2 },
  { c: 13, r: 2 },
  { c: 14, r: 2 },
  { c: 15, r: 2 },
  { c: 16, r: 2 },
  { c: 17, r: 2 },
];

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.blocked-by-segment",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, SEGMENTS, 1, 1); // heading right, descending
    },

    // The run-up and the tile-step into the worm's own body are the clip: the
    // reviewer watches the head close on its own trail and then the turn the
    // assertions read.
    async act(api) {
      await actWormToColumn(api, BLOCK_C - 1); // ~0.7s of visible approach
      before = (await api.snapshot()).worms[0];
      snap = await actWormStep(api);
      // Every operand is captured; the sim runs on only so the clip shows the worm
      // unwinding after the turn rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm starts heading right", before.dh, 1);
      check.expectEq(
        "blocked by a segment, the worm reverses its heading",
        snap.worms[0].dh,
        -1,
      );
      check.expectEq(
        "blocked by a segment, the worm drops one row",
        head(snap).r,
        2,
      );
      check.expectEq(
        "the worm holds its column through the drop",
        head(snap).c,
        BLOCK_C - 1,
      );
      check.expectEq(
        "turning at a segment charges nothing (no node created)",
        snap.nodes.length,
        0,
      );
      // The consequence of NOT turning, stated directly. specs/worm.md builds a worm
      // from segments "each occupying one tile", so a head that steps onto its own
      // body puts two segments on one tile — and because the body then shifts along
      // behind it, the stack persists rather than resolving on the next step. This is
      // the visible symptom (a worm that appears to pass through itself) of the same
      // failure the heading assertion above catches, and it is worth naming: a build
      // that reads "blocked by another worm segment" as meaning only OTHER worms'
      // segments produces exactly this.
      const tiles = snap.worms.flatMap((w) =>
        w.segments.map((s) => `${s.c},${s.r}`),
      );
      check.expectEq(
        "no two segments end up stacked on one tile",
        new Set(tiles).size,
        tiles.length,
      );
    },
  };
}
