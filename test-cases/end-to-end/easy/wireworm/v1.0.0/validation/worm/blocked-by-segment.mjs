// Automated validation for worm.blocked-by-segment: blocked by a worm segment
// (rather than a node) the worm turns like any block, but charges nothing.
//
// The worm is posed in an L so a trailing segment sits directly ahead of its head;
// the head running into that segment routes through the real stepWorm segment-block
// path (segmentAt), which turns the worm without charging anything. The board stays
// empty of nodes.

import { actWormStep, freshBoard, setWorm } from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.blocked-by-segment",

    async arrange(api) {
      await freshBoard(api);
      // Head at (10,5) heading right; a trailing segment occupies (11,5) directly ahead.
      await setWorm(
        api,
        [
          { c: 10, r: 5 },
          { c: 9, r: 5 },
          { c: 9, r: 6 },
          { c: 10, r: 6 },
          { c: 11, r: 6 },
          { c: 11, r: 5 },
        ],
        1,
        1,
      );
    },

    // The one tile-step into the worm's own body is the clip: the reviewer watches
    // the turn the assertions read.
    async act(api) {
      before = (await api.snapshot()).worms[0];
      snap = await actWormStep(api);
      // Both operands are captured; the sim runs on only so the clip shows the worm
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
        "turning at a segment charges nothing (no node created)",
        snap.nodes.length,
        0,
      );
    },
  };
}
