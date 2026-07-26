// Automated validation for audio.fire: a distinct cue plays when the cursor fires
// a bolt.
//
// A clean board is the precondition; the cue is confirmed by the Web Audio source
// log growing across a real fire (the debug `fire` control op, which routes
// through the same audio.play("fire") call as a held Space, specs/ui.md).

import { armAudio, audioCount, freshBoard, tileCX } from "../_helpers.mjs";

export default function item() {
  let boltsBefore;
  let boltsAfter;
  let before;
  let after;

  return {
    id: "audio.fire",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setCursor", tileCX(20), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    async act(api) {
      boltsBefore = (await api.snapshot()).bolts.length;
      before = await audioCount(api);
      await api.call("fire"); // the one event this item drives
      boltsAfter = (await api.snapshot()).bolts.length;
      after = await audioCount(api);
      // Every operand is captured; the sim runs on only so the bolt is visibly
      // climbing at the end of the clip.
      await api.advance(60); // 0.5s of visible flight
    },

    async assert(api, check) {
      check.expectGt("firing puts a bolt in flight", boltsAfter, boltsBefore);
      check.expectGt(
        "a cue plays on firing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
