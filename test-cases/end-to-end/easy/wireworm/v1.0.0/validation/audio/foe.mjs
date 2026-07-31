// Automated validation for audio.foe: a distinct cue plays when a foe is killed.
//
// A glitch above the cursor is the precondition (it dies to a single bolt,
// specs/foes.md); the cue is confirmed by the Web Audio source log growing across
// the real resolveBolt -> hitFoe kill the shot triggers.

import {
  actAudioCount,
  actFireAndResolve,
  armAudio,
  foesOf,
  freshBoard,
  tileCY,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;
  let after;

  return {
    id: "audio.foe",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "glitch", { x: 640, y: tileCY(13), vx: 0 });
      await api.call("setCursor", 640, 688);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The bolt climbing to the glitch and killing it is the clip and the one
    // event this item drives.
    async act(api) {
      before = await actAudioCount(api);
      snap = await actFireAndResolve(api);
      after = await actAudioCount(api);
      // Every operand is captured; the sim runs on only so the kill is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "a single bolt kills the glitch",
        foesOf(snap, "glitch").length,
        0,
      );
      check.expectGt(
        "a cue plays on killing a foe (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
