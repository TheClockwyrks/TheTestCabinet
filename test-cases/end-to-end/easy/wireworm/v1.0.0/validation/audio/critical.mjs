// Automated validation for audio.critical: a distinct cue plays when a node reaches
// critical.
//
// A charge-2 node ahead of the worm is the precondition; the cue is confirmed by
// the Web Audio source log growing across the real stepWorm -> chargeNode bump
// that raises it to critical (charge 3, specs/charge.md).

import {
  actAudioCount,
  actWormStep,
  armAudio,
  chargeAt,
  freshBoard,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let chargeBefore;
  let before;
  let snap;
  let after;

  return {
    id: "audio.critical",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 20, 5, 2); // one bump from critical
      await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1); // heading right into it
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The one tile-step that bumps the node to critical is the clip and the one
    // event this item drives.
    async act(api) {
      chargeBefore = chargeAt(await api.snapshot(), 20, 5);
      before = await actAudioCount(api);
      snap = await actWormStep(api);
      after = await actAudioCount(api);
      // Every operand is captured; the sim runs on only so the worm diving the
      // freshly-critical node is legible at the end of the clip.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the node starts at charge 2", chargeBefore, 2);
      check.expectEq(
        "the bump raises the node to critical (3)",
        chargeAt(snap, 20, 5),
        3,
      );
      check.expectGt(
        "a cue plays on reaching critical (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
