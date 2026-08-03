// Automated validation for the Audio item `thrust`: a distinct synthesized cue plays while the
// ship thrusts. Audio is armed with one neutral key press first (the game must not autoplay),
// then the thrust key is held and the real sim stepped so the ship accelerates and the build
// starts its thrust sound. The audio log must grow across it, and the ship must actually speed
// up, so the cue is tied to real thrust rather than an idle key.
//
// Thrust is held TWICE, with the key released in between, because a build is free to shape a
// thrust sound in more than one way and the probe only sees Web Audio sources being started
// (`api.audio`). One long hold sees a build that starts a rumble for the duration; a second
// hold after a release also sees one that restarts its sound per burst, and the sustained
// holds see one that puffs a source per exhaust tick. Widening what can be observed cannot
// make a silent build pass — the log still has to grow — it only stops the item failing a
// build whose sound is real but shaped differently.
//
// Both ends of the audio comparison are read through `audioCount`, which settles a real frame
// first: a build may schedule its cues from the render loop, and the validate pass advances
// the clock instantly, so an unsettled read reports a silent build that is in fact playing.
// The baseline is taken at the end of `arrange`, not the top of `act`, because in the record
// pass the build is driving its own clock by then and the pause would be game time the
// scenario has not been watched through. See `_helpers.mjs`.

import {
  newGame,
  poseShip,
  armAudio,
  actHoldKey,
  audioCount,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let ship;
  let again;
  let after;

  return {
    id: "audio.thrust",

    async arrange(api) {
      await newGame(api); // clears rocks and the saucer, so only the thrust can make a sound
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      await armAudio(api);
      before = await audioCount(api);
    },

    async act(api) {
      ship = await actHoldKey(api, "KeyW", 60); // hold thrust 0.5 s and run the real sim
      await api.advance(24); // 0.2 s coasting, key released
      again = await actHoldKey(api, "KeyW", 60); // and a second burst
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectGt(
        "holding thrust actually accelerates the ship",
        ship.after.speed,
        ship.before.speed,
      );
      check.expectGt(
        "the second burst thrusts too",
        again.after.speed,
        again.before.speed,
      );
      check.expectGt(
        "a cue plays while thrusting (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
