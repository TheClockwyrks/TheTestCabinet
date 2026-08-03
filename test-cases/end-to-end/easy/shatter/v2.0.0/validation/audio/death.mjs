// Automated validation for the Audio item `death`: a distinct synthesized cue plays when the
// ship is destroyed. Audio is armed with one neutral key press first (the game must not
// autoplay), the ship's post-respawn grace is cleared, and a rock is posed on top of the ship
// so the very next steps resolve a lethal collision. Nothing else makes a sound in the window,
// so the audio log growing across the loss of a life is the ship-destroyed cue.
//
// The loss is driven through `actUntilShipLost`, which measures the life count against the one
// this same drive read a moment earlier rather than against a fixed number. A sweep waiting on
// `lives < 3` would return on its very first sample whenever the scenario arrived with a life
// already spent — having advanced no time and destroyed nothing — and the cue would then be
// reported missing from an event that never happened. It also waits long enough for a build
// that pauses on the destruction before taking the life (see `_helpers.mjs`).
//
// Both ends of the audio comparison are read through `audioCount`, which settles a real frame
// first: a build may schedule its cues from the render loop, and the validate pass advances
// the clock instantly, so an unsettled read reports a silent build that is in fact playing.
// The baseline is taken at the end of `arrange`, not the top of `act`, because in the record
// pass the build is driving its own clock by then and the pause would be game time the
// scenario has not been watched through. See `_helpers.mjs`.

import {
  newGame,
  arrangeDoomedShip,
  actUntilShipLost,
  armAudio,
  audioCount,
} from "../_helpers.mjs";

const AT = { x: 300, y: 300 }; // where the ship is posed, with the rock on top of it

export default function item() {
  let before;
  let outcome;
  let after;

  return {
    id: "audio.death",

    async arrange(api) {
      await newGame(api);
      await arrangeDoomedShip(api, AT);
      await api.call("setInvuln", 0); // lethal collisions resume
      await armAudio(api);
      before = await audioCount(api);
    },

    async act(api) {
      outcome = await actUntilShipLost(api, { at: AT });
      after = await audioCount(api);
      await api.advance(60); // a tail so the clip shows the destruction
    },

    async assert(api, check) {
      check.expectOk(
        "the ship is destroyed (a life is lost)",
        outcome.lost.hit,
      );
      check.expectGt(
        "a cue plays when the ship is destroyed (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
