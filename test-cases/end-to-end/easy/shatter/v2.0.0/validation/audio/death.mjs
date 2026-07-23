// Automated validation for the Audio item `death`: a distinct synthesized cue plays when the
// ship is destroyed. Audio is armed with one neutral key press first (the game must not
// autoplay), the ship's post-respawn grace is cleared, and a rock is posed on top of the ship
// so the very next steps resolve a lethal collision. Nothing else makes a sound in the window,
// so the audio log growing across the loss of a life is the ship-destroyed cue.
//
// 1 s = 120 ticks bounds the death sweep, polled a tick at a time so the life is seen the
// instant it is lost.

import { newGame, poseShip, armAudio, TICK } from "../_helpers.mjs";

export default function item() {
  let before;
  let result;
  let after;

  return {
    id: "audio.death",

    async arrange(api) {
      await newGame(api);
      await api.call("setInvuln", 0); // lethal collisions resume
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // on top of the ship
      await armAudio(api);
    },

    async act(api) {
      before = (await api.audio()).length;
      result = await api.until((s) => s.lives < 3, { max: 120, poll: TICK });
      after = (await api.audio()).length;
      await api.advance(30); // a short tail so the clip shows the destruction
    },

    async assert(api, check) {
      check.expectOk("the ship is destroyed (a life is lost)", result.hit);
      check.expectGt(
        "a cue plays when the ship is destroyed (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
