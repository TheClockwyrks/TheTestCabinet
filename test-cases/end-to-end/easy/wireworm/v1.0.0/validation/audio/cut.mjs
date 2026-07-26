// Automated validation for audio.cut: a distinct cue plays when a bolt cuts a worm
// segment.
//
// A single-segment worm just above the cursor is the precondition (so the one hit
// both clears the worm and leaves nothing else to charge or detonate) — placed low
// (row 17, specs/board.md), so the bolt reaches it within a tick or two, well
// before the worm's own step interval (about 0.14s at level 1) could wind it out of
// the firing column; the cue is confirmed by the Web Audio source log growing
// across the real hitWorm the shot triggers.

import {
  actFireAndResolve,
  armAudio,
  audioCount,
  freshBoard,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let wormsBefore;
  let before;
  let snap;
  let after;

  return {
    id: "audio.cut",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, [{ c: 20, r: 17 }], 1, 1); // a lone segment, nothing else on the board
      await api.call("setCursor", tileCX(20), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The shot that cuts the segment is the clip and the one event this item
    // drives.
    async act(api) {
      wormsBefore = (await api.snapshot()).worms.length;
      before = await audioCount(api);
      snap = await actFireAndResolve(api);
      after = await audioCount(api);
      // Every operand is captured; the sim runs on only so the cut is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("one segment before the shot", wormsBefore, 1);
      check.expectEq(
        "the shot cuts the segment (the worm is gone)",
        snap.worms.length,
        0,
      );
      check.expectGt(
        "a cue plays on cutting a segment (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
