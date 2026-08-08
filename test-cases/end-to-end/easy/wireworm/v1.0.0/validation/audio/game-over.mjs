// Automated validation for audio.game-over: the Game-over sting plays when the
// last life is lost.
//
// One life and a worm walking the floor row into the cursor are the preconditions;
// the end is produced by the real loseLife path (lives -> 0 -> gameover) when the
// segment reaches the cursor; the cue is confirmed by the Web Audio source log
// growing across reaching the Game-over screen.
//
// The worm WALKS into the cursor rather than being posed on top of it — see
// `arrangeWormIntoCursor` for why a posed overlap left this deciding on a build's
// choice of when to test for contact rather than on whether the sting plays.

import {
  actAudioCount,
  actWormReachesCursor,
  armAudio,
  arrangeWormIntoCursor,
  freshBoard,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;
  let after;

  return {
    id: "audio.game-over",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1);
      await arrangeWormIntoCursor(api);
      // Arm audio LAST: a genuine gesture is what unlocks a conformant build's
      // AudioContext, so it must land right before the driven event.
      await armAudio(api);
    },

    // The approach and the touch that ends the run are the clip, and the touch is
    // the one event this item drives.
    async act(api) {
      before = await actAudioCount(api);
      snap = await actWormReachesCursor(api);
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
