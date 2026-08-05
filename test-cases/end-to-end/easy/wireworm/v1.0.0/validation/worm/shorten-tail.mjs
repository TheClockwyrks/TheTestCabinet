// Automated validation for worm.shorten-tail: a bolt into the tail shortens the
// worm by one segment, leaving a single worm.
//
// A straight worm on a low row is the precondition; the shorten is produced by the
// real hitWorm on the tail segment and read back (still one worm, one shorter).

import {
  actFireAndResolve,
  actWormToColumn,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

// Row 17 keeps the bolt's flight (about 0.04 s from the muzzle) well inside the
// 0.14 s between worm tile steps, so the tail is still in the column when the bolt
// arrives.
const R = 17;
// The worm winds in and the shot is taken the instant its head lands on FIRE_AT_C,
// which puts the tail four tiles back, on the cursor. Posed on the firing mark it
// was shot on the clip's first frame; posed six tiles short it is filmed winding in
// first (see `actWormToColumn`).
const FIRE_AT_C = 12;
const START_C = FIRE_AT_C - 6;
const TAIL_C = FIRE_AT_C - 4;

export default function item() {
  let snap;

  return {
    id: "worm.shorten-tail",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1);
      await api.call("setCursor", tileCX(TAIL_C), 688); // where the tail will land
    },

    // The approach and the shot into the tail are the clip: the reviewer watches the
    // worm wind over the cursor, then lose exactly one segment and carry on as one
    // worm.
    async act(api) {
      await actWormToColumn(api, FIRE_AT_C); // ~0.84s of visible approach
      snap = await actFireAndResolve(api);
      // The snapshot is captured; the sim runs on only so the shortened worm is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "still a single worm after a tail hit",
        snap.worms.length,
        1,
      );
      check.expectEq(
        "the worm is one segment shorter",
        snap.worms[0].segments.length,
        4,
      );
    },
  };
}
