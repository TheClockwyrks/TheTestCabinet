// Automated validation for the Audio item `thrust`: a distinct synthesized cue plays while the
// ship thrusts. Audio is armed with one neutral key press first (the game must not autoplay),
// then the thrust key is held and the real sim stepped so the ship accelerates and the build
// starts its held thrust rumble. The audio log must grow across it, and the ship must actually
// speed up, so the cue is tied to real thrust rather than an idle key.

import { newGame, poseShip, armAudio, actHoldKey } from "../_helpers.mjs";

export default function item() {
  let before;
  let ship;
  let after;

  return {
    id: "audio.thrust",

    async arrange(api) {
      await newGame(api); // clears rocks and the saucer, so only the thrust can make a sound
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      await armAudio(api);
    },

    async act(api) {
      before = (await api.audio()).length;
      ship = await actHoldKey(api, "KeyW", 30); // hold thrust 0.25 s and run the real sim
      after = (await api.audio()).length;
    },

    async assert(api, check) {
      check.expectGt(
        "holding thrust actually accelerates the ship",
        ship.after.speed,
        ship.before.speed,
      );
      check.expectGt(
        "a cue plays while thrusting (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
