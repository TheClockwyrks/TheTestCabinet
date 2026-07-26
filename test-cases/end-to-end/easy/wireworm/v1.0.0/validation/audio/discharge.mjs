// Automated validation for audio.discharge: a distinct cue plays when a chain-arc
// discharge goes off.
//
// An isolated critical node above the cursor is the precondition (specs/charge.md);
// the cue is confirmed by the Web Audio source log growing across the real
// resolveBolt -> hitNode -> detonate path the shot triggers.

import {
  actFireAndResolve,
  armAudio,
  audioCount,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

const C = 20;
const R = 10;

export default function item() {
  let before;
  let snap;
  let after;

  return {
    id: "audio.discharge",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", C, R, 3); // an isolated critical node
      await api.call("setCursor", tileCX(C), 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The shot and the detonation it triggers are one scenario, and this is the
    // one event this item drives.
    async act(api) {
      before = await audioCount(api);
      snap = await actFireAndResolve(api);
      after = await audioCount(api);
      // Every operand is captured; the sim runs on only so the discharge is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "the critical node detonates (removed, not de-energized)",
        chargeAt(snap, C, R),
        -1,
      );
      check.expectGt(
        "a cue plays on a chain-arc discharge (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
