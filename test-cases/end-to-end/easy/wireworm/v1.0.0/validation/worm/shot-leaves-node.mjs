// Automated validation for worm.shot-leaves-node: a worm segment killed by a bolt
// leaves a fresh inert node in the tile where it died, thickening the field.
//
// A straight worm on a low row (empty board) is the precondition; the node is left
// by the real hitWorm -> leaveNode path and read back at the killed segment's tile.

import {
  actFireAndResolve,
  actWormToColumn,
  chargeAt,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

// Row 17 keeps the bolt's flight (about 0.04 s from the muzzle) well inside the
// 0.14 s between worm tile steps, so the segment aimed at is still in the column
// when the bolt arrives.
const R = 17;
// The worm winds in and the shot is taken the instant its head lands on FIRE_AT_C,
// which puts the tail four tiles back, on the cursor. Posed on the firing mark it
// was shot on the clip's first frame; posed six tiles short it is filmed winding in
// first (see `actWormToColumn`).
const FIRE_AT_C = 12;
const START_C = FIRE_AT_C - 6;
const KILL_C = FIRE_AT_C - 4;

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.shot-leaves-node",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1);
      await api.call("setCursor", tileCX(KILL_C), 688);
    },

    // The approach, the shot and the node it leaves behind are the clip: the
    // reviewer watches the worm wind over the cursor, the segment die, and a fresh
    // node appear in its tile.
    async act(api) {
      await actWormToColumn(api, FIRE_AT_C); // ~0.84s of visible approach
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
