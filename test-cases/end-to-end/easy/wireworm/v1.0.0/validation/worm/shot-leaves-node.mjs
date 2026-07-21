// Automated validation for worm.shot-leaves-node: a worm segment killed by a bolt
// leaves a fresh inert node in the tile where it died, thickening the field.
//
// A straight worm on a low row (empty board) is the precondition; the node is left
// by the real hitWorm -> leaveNode path and read back at the killed segment's tile.

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

const KILL_C = 8;
const R = 15;

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.shot-leaves-node",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(12, R, 5, 1), 1, 1); // tail at column 8, row 15
      await api.call("setCursor", tileCX(KILL_C), 688);
    },

    // The shot and the node it leaves behind are the clip: the reviewer watches the
    // segment die and a fresh node appear in its tile.
    async act(api) {
      before = chargeAt(await api.snapshot(), KILL_C, R);
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the new node is legible
      // at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the tile is empty before the shot", before, -1);
      check.expectEq(
        "a shot-killed segment leaves a fresh inert node",
        chargeAt(snap, KILL_C, R),
        0,
      );
    },
  };
}
