// Automated validation for audio.game-over: the Game-over sting plays when the
// last life is lost.
//
// One life and a worm segment on the cursor's tile are the preconditions; the end
// is produced by the real loseLife path (lives -> 0 -> gameover) when the sim
// steps; the cue is confirmed by the Web Audio source log growing across reaching
// the Game-over screen.

import { actAudioCount, armAudio, freshBoard, setWorm } from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;
  let after;

  return {
    id: "audio.game-over",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1);
      await api.call("setCursor", 640, 688); // tile (20,19)
      await setWorm(api, [{ c: 20, r: 19 }], 1, 1);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The touch that ends the run is the clip and the one event this item drives.
    async act(api) {
      before = await actAudioCount(api);
      await api.advance(6); // 6 ticks = 0.05s — one sim beat, enough for the touch
      snap = await api.snapshot();
      after = await actAudioCount(api);
      // Every operand is captured; the sim runs on only so the clip holds on the
      // Game-over screen the assertions read.
      await api.advance(60); // 0.5s holding on the Game-over screen
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last life ends the game",
        snap.screen,
        "gameover",
      );
      check.expectGt(
        "the Game-over sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
