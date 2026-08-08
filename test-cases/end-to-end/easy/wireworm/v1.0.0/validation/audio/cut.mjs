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
  actAudioCount,
  actFireAndResolve,
  armAudio,
  freshBoard,
  segmentAt,
  setWorm,
  tileCX,
} from "../_helpers.mjs";

// The lone segment's tile. Row 17 is low enough that the bolt reaches it within a
// tick or two, and — being nowhere near row 0 — it is a tile the NEXT level's worm
// cannot be standing in, which is what makes the "it is gone" read below safe.
const C = 20;
const R = 17;

export default function item() {
  let wormsBefore;
  let before;
  let snap;
  let after;

  return {
    id: "audio.cut",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, [{ c: C, r: R }], 1, 1); // a lone segment, nothing else on the board
      await api.call("setCursor", tileCX(C), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The shot that cuts the segment is the clip and the one event this item
    // drives.
    async act(api) {
      wormsBefore = (await api.snapshot()).worms.length;
      before = await actAudioCount(api);
      snap = await actFireAndResolve(api);
      after = await actAudioCount(api);
      // Every operand is captured; the sim runs on only so the cut is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("one segment before the shot", wormsBefore, 1);
      // Read as "the posed segment is gone from its tile", NOT as "the board holds
      // no worms". Cutting the last segment on the board IS a cleared level
      // (specs/worm.md), and clearing advances to the next one — which enters its
      // own worm along the top row (specs/worm.md). Whether that next worm is
      // already standing by the end of the tick the cut lands in, or only after the
      // level banner, is a free choice no spec fixes, so `worms.length` here reads
      // the NEXT level's worm on a perfectly conformant build and never sees 0.
      check.expectOk(
        "the shot cuts the segment (it is gone from its tile)",
        !segmentAt(snap, C, R),
      );
      check.expectGt(
        "a cue plays on cutting a segment (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
