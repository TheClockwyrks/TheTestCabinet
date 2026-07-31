// Automated validation for the Audio item `death`: a distinct synthesized cue plays when the
// ship is destroyed. Audio is armed with one neutral key press first (the game must not
// autoplay), the ship's post-respawn grace is cleared, and a rock is posed on top of the ship
// so the very next steps resolve a lethal collision. Nothing else makes a sound in the window,
// so the audio log growing across the loss of a life is the ship-destroyed cue.
//
// The loss is driven through `actUntilShipLost`, which measures the life count against the one
// this same drive read a moment earlier. The fixed `lives < 3` it replaces was not a
// measurement at all against this case's spec: `specs/instrumentation.md` calls the snapshot
// field "ships in reserve" while `specs/gameplay.md` counts three ships in total, so a
// conformant build can open a game reporting 2 — and the sweep then returned on its very first
// sample, having advanced no time and destroyed nothing, leaving the cue to be reported
// missing from an event that never happened. It also waits long enough for a build that pauses
// on the destruction before taking the life (see `_helpers.mjs`).

import {
  newGame,
  arrangeDoomedShip,
  actUntilShipLost,
  armAudio,
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
    },

    async act(api) {
      before = (await api.audio()).length;
      outcome = await actUntilShipLost(api, { at: AT });
      after = (await api.audio()).length;
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
