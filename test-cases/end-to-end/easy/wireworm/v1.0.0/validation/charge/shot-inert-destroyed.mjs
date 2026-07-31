// Automated validation for charge.shot-inert-destroyed: a bolt into an inert node
// removes it (and scores), never raising its charge.
//
// An inert node above the cursor is the precondition; the destruction is produced
// by the real resolveBolt -> hitNode path as the bolt travels up and is read back.
//
// Both halves of that outcome are pinned against a board that can be shown to have
// held still, because on their own each has a way of passing without a shot ever
// landing:
//
//   * "the tile is empty afterwards" is also true of a tile that was empty the whole
//     time, so the node is confirmed STANDING before the shot.
//   * "the score went up" is also true of any other scoring event, so the gain is
//     compared against the exact `+1` specs/progression.md fixes for an inert node
//     shot down, and the level is confirmed unchanged across the shot.
//
// That last one is not hypothetical. A build whose level-clear condition is an
// unguarded "no worm segments on the board" treats the worm-less board `enterPlay`
// is specified to produce (specs/instrumentation.md) as a cleared level on the very
// first tick: it banks `100 * level`, rebuilds the board, and deletes the bolt
// before it can travel. Read loosely, that reported a destroyed node that was never
// shot and a score that was never earned here.

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

const C = 20;
const R = 10;

// The score specs/progression.md fixes for an inert node destroyed by a bolt.
const INERT_NODE_SCORE = 1;

export default function item() {
  let before;
  let levelBefore;
  let chargeBefore;
  let snap;

  return {
    id: "charge.shot-inert-destroyed",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", C, R, 0);
      await api.call("setCursor", tileCX(C), 688);
    },

    // The bolt climbing the column and clearing the node is the clip. The whole
    // pre-shot reading is taken at the top of `act`, before any time is spent, so
    // every comparison below belongs to this shot alone.
    async act(api) {
      const start = await api.snapshot();
      before = start.score;
      levelBefore = start.level;
      chargeBefore = chargeAt(start, C, R);
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the cleared tile is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the inert node stands before the shot", chargeBefore, 0);
      check.expectEq(
        "the inert node is destroyed by the bolt",
        chargeAt(snap, C, R),
        -1,
      );
      check.expectEq(
        "the shot resolves inside the posed level",
        snap.level,
        levelBefore,
      );
      check.expectEq(
        "shooting an inert node scores +1",
        snap.score - before,
        INERT_NODE_SCORE,
      );
    },
  };
}
