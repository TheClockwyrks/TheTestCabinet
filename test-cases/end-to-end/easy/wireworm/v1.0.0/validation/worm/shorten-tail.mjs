// Automated validation for worm.shorten-tail: a bolt into the tail shortens the
// worm by one segment, leaving a single worm.
//
// A straight worm on a low row is the precondition; the shorten is produced by the
// real hitWorm on the tail segment and read back (still one worm, one shorter).

import {
  actFireAndResolve,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "worm.shorten-tail",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(12, 15, 5, 1), 1, 1); // head at column 12, tail at 8
      await api.call("setCursor", tileCX(8), 688); // aimed at the tail
    },

    // The shot into the tail is the clip: the reviewer watches the worm lose exactly
    // one segment and carry on as one worm.
    async act(api) {
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
